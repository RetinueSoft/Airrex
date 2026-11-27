// Demo provider: generates realistic-looking, deterministic fares so the app works with no API key.
// The same route + date always returns the same flights.

import type { FlightOffer, SearchQuery, Segment } from '../../shared/types.ts';
import { AIRLINES } from '../../shared/airlines.ts';
import type { FlightProvider } from './types.ts';

function seededRandom(seedText: string) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const DOMESTIC = ['6E', 'AI', 'IX', 'QP', 'SG'];
const HUBS = ['DEL', 'BOM', 'BLR', 'HYD'];
const CABIN_MULTIPLIER = { economy: 1, premium_economy: 1.8, business: 3.6, first: 6 } as const;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function addMinutes(date: string, minutesFromMidnight: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutesFromMidnight);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

export const mockProvider: FlightProvider = {
  name: 'demo',
  isDemo: true,
  async search(q: SearchQuery): Promise<FlightOffer[]> {
    const rand = seededRandom(`${q.origin}-${q.destination}-${q.date}`);
    const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

    const baseDuration = 75 + Math.floor(rand() * 110); // 1h15 .. 3h05 nonstop
    const count = 14 + Math.floor(rand() * 10);
    const offers: FlightOffer[] = [];

    for (let i = 0; i < count; i++) {
      const code = DOMESTIC[i % DOMESTIC.length];
      const airline = AIRLINES[code];
      const departMin = 5 * 60 + Math.floor(rand() * 17 * 12) * 5; // 05:00 .. 22:00
      const oneStop = rand() < 0.25;
      const segments: Segment[] = [];

      if (!oneStop) {
        const dur = baseDuration + Math.floor(rand() * 20) - 10;
        segments.push({
          flightNumber: `${code} ${100 + Math.floor(rand() * 2800)}`,
          carrierCode: code,
          carrierName: airline.name,
          origin: q.origin,
          destination: q.destination,
          departAt: addMinutes(q.date, departMin),
          arriveAt: addMinutes(q.date, departMin + dur),
          durationMinutes: dur,
          aircraft: pick(['A320neo', 'A321neo', 'B737-8', 'ATR 72', 'A350-900', 'B787-8']),
        });
      } else {
        const via = pick(HUBS.filter((h) => h !== q.origin && h !== q.destination));
        const leg1 = Math.round(baseDuration * 0.6) + Math.floor(rand() * 20);
        const layover = 55 + Math.floor(rand() * 150);
        const leg2 = Math.round(baseDuration * 0.6) + Math.floor(rand() * 20);
        segments.push(
          {
            flightNumber: `${code} ${100 + Math.floor(rand() * 2800)}`,
            carrierCode: code,
            carrierName: airline.name,
            origin: q.origin,
            destination: via,
            departAt: addMinutes(q.date, departMin),
            arriveAt: addMinutes(q.date, departMin + leg1),
            durationMinutes: leg1,
            aircraft: 'A320neo',
          },
          {
            flightNumber: `${code} ${100 + Math.floor(rand() * 2800)}`,
            carrierCode: code,
            carrierName: airline.name,
            origin: via,
            destination: q.destination,
            departAt: addMinutes(q.date, departMin + leg1 + layover),
            arriveAt: addMinutes(q.date, departMin + leg1 + layover + leg2),
            durationMinutes: leg2,
            aircraft: 'A321neo',
          },
        );
      }

      const first = segments[0];
      const last = segments[segments.length - 1];
      const totalDuration =
        (new Date(last.arriveAt + 'Z').getTime() - new Date(first.departAt + 'Z').getTime()) / 60000;

      const carrierFactor = code === 'AI' ? 1.15 : code === 'IX' || code === 'QP' ? 0.95 : 1;
      const perPaxBase =
        Math.round((2400 + baseDuration * 22 + rand() * 3500) * carrierFactor * CABIN_MULTIPLIER[q.cabin] / 10) * 10;
      const perPaxTax = Math.round(perPaxBase * 0.12 + 650 + rand() * 300);
      // Low-cost airlines also sell cheaper "cabin bag only" fares (no check-in bag).
      const cabinOnly = code !== 'AI' && rand() < 0.3;
      const cabinOnlyDiscount = cabinOnly ? 250 + Math.floor(rand() * 400) : 0;

      offers.push({
        id: `demo-${q.date}-${i}`,
        airlineCode: code,
        airlineName: airline.name,
        segments,
        durationMinutes: totalDuration,
        stops: segments.length - 1,
        cabin: q.cabin,
        fare: {
          baseFare: (perPaxBase - cabinOnlyDiscount) * q.adults,
          taxesAndFees: perPaxTax * q.adults,
          total: (perPaxBase - cabinOnlyDiscount + perPaxTax) * q.adults,
          currency: 'INR',
        },
        baggage: cabinOnly
          ? { cabinIncluded: true, cabinKg: 7, checkedIncluded: false, checkedForFee: true, notes: ['Cabin bag only fare', 'Checked baggage for a fee'] }
          : { cabinIncluded: true, cabinKg: 7, checkedIncluded: true, checkInKg: 15 },
        refundable: rand() < 0.3,
        seatsLeft: rand() < 0.35 ? 1 + Math.floor(rand() * 6) : undefined,
      });
    }
    return offers;
  },
};
