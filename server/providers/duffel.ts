// Live provider using the Duffel Flights API (https://duffel.com/docs/api).
// Enabled when DUFFEL_ACCESS_TOKEN is set. Use a "duffel_test_..." token for sandbox data.

import type { CabinClass, FlightOffer, SearchQuery } from '../../shared/types.ts';
import type { FlightProvider } from './types.ts';

function isoDurationToMinutes(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export function createDuffelProvider(token: string): FlightProvider {
  return {
    name: 'duffel',
    isDemo: token.startsWith('duffel_test_'),
    async search(q: SearchQuery): Promise<FlightOffer[]> {
      const res = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=20000', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Duffel-Version': 'v2',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          data: {
            slices: [{ origin: q.origin, destination: q.destination, departure_date: q.date }],
            passengers: Array.from({ length: q.adults }, () => ({ type: 'adult' })),
            cabin_class: q.cabin,
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`Duffel API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const json = (await res.json()) as { data: { offers: any[] } };

      return json.data.offers.map((o): FlightOffer => {
        const slice = o.slices[0];
        const segments = slice.segments.map((s: any) => {
          const carrier = s.marketing_carrier ?? s.operating_carrier;
          return {
            flightNumber: `${carrier.iata_code} ${s.marketing_carrier_flight_number}`,
            carrierCode: carrier.iata_code,
            carrierName: carrier.name,
            origin: s.origin.iata_code,
            destination: s.destination.iata_code,
            departAt: s.departing_at,
            arriveAt: s.arriving_at,
            durationMinutes: isoDurationToMinutes(s.duration),
            aircraft: s.aircraft?.name,
          };
        });
        const total = Number(o.total_amount);
        const tax = Number(o.tax_amount ?? 0);
        return {
          id: o.id,
          airlineCode: o.owner.iata_code,
          airlineName: o.owner.name,
          segments,
          durationMinutes: isoDurationToMinutes(slice.duration),
          stops: segments.length - 1,
          cabin: q.cabin as CabinClass,
          fare: { baseFare: Number(o.base_amount ?? total - tax), taxesAndFees: tax, total, currency: o.total_currency },
          refundable: o.conditions?.refund_before_departure?.allowed ?? undefined,
        };
      });
    },
  };
}
