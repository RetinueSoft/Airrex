// Live prices from Google Flights via SerpApi (https://serpapi.com/google-flights-api).
// Enabled when SERPAPI_API_KEY is set. Every uncached call uses one search from your SerpApi plan.

import type { BookingOption, CabinClass, FlightOffer, SearchQuery, Segment } from '../../shared/types.ts';
import type { FlightProvider } from './types.ts';
import { parseBaggage } from '../../shared/baggage.ts';

const ENDPOINT = 'https://serpapi.com/search.json';
const TRAVEL_CLASS: Record<CabinClass, string> = { economy: '1', premium_economy: '2', business: '3', first: '4' };
const CURRENCY = process.env.SERPAPI_CURRENCY ?? 'INR';

interface SerpAirport { name?: string; id: string; time: string }
interface SerpSegment {
  departure_airport: SerpAirport;
  arrival_airport: SerpAirport;
  duration: number;
  airplane?: string;
  airline: string;
  airline_logo?: string;
  flight_number: string;
  travel_class?: string;
  extensions?: string[];
}
interface SerpItinerary {
  flights: SerpSegment[];
  layovers?: { duration: number; id: string; name?: string }[];
  total_duration: number;
  price?: number;
  type?: string;
  airline_logo?: string;
  extensions?: string[];
  booking_token?: string;
}
interface SerpSearchResult {
  error?: string;
  best_flights?: SerpItinerary[];
  other_flights?: SerpItinerary[];
}

export class SerpApiError extends Error {
  /** True when the account is out of searches or the key is rejected. */
  quotaOrAuth: boolean;
  constructor(message: string, quotaOrAuth: boolean) {
    super(message);
    this.quotaOrAuth = quotaOrAuth;
  }
}

async function callSerpApi(params: Record<string, string>, apiKey: string) {
  const url = `${ENDPOINT}?${new URLSearchParams({ engine: 'google_flights', hl: 'en', gl: 'in', currency: CURRENCY, ...params, api_key: apiKey })}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => ({}))) as SerpSearchResult & Record<string, unknown>;
  if (body.error) {
    // "no results" comes back as an error string; treat it as an empty result.
    if (/hasn't returned any results|no results/i.test(body.error)) return { ...body, error: undefined };
    const quotaOrAuth = res.status === 401 || res.status === 429 || /run out of searches|invalid api key|plan|limit/i.test(body.error);
    throw new SerpApiError(`SerpApi: ${body.error}`, quotaOrAuth);
  }
  if (!res.ok) throw new SerpApiError(`SerpApi HTTP ${res.status}`, res.status === 401 || res.status === 429);
  return body;
}

/** "2026-12-05 06:15" -> "2026-12-05T06:15:00" (airport-local time). */
function toIso(t: string) {
  return `${t.replace(' ', 'T')}:00`;
}

function carrierCode(flightNumber: string) {
  return flightNumber.trim().split(/\s+/)[0] ?? '';
}

function mapItinerary(it: SerpItinerary, q: SearchQuery, index: number): FlightOffer | null {
  if (!it.flights?.length || typeof it.price !== 'number') return null; // no price = can't compare
  const segments: Segment[] = it.flights.map((s) => ({
    flightNumber: s.flight_number,
    carrierCode: carrierCode(s.flight_number),
    carrierName: s.airline,
    origin: s.departure_airport.id,
    destination: s.arrival_airport.id,
    departAt: toIso(s.departure_airport.time),
    arriveAt: toIso(s.arrival_airport.time),
    durationMinutes: s.duration,
    aircraft: s.airplane,
  }));
  const first = it.flights[0];
  const carriers = new Set(segments.map((s) => s.carrierCode));
  return {
    id: `serp-${q.date}-${index}-${segments.map((s) => s.flightNumber.replace(/\s/g, '')).join('-')}`,
    airlineCode: carrierCode(first.flight_number),
    airlineName: carriers.size > 1 ? [...new Set(it.flights.map((s) => s.airline))].join(' + ') : first.airline,
    airlineLogo: it.airline_logo ?? first.airline_logo,
    segments,
    durationMinutes: it.total_duration,
    stops: segments.length - 1,
    cabin: q.cabin,
    // The server always searches for 1 adult, so this is the price per person; it multiplies for groups.
    fare: { total: it.price, currency: CURRENCY },
    // Google Flights adds notes such as "Checked baggage for a fee" to the itinerary and its segments.
    baggage: parseBaggage([...(it.extensions ?? []), ...it.flights.flatMap((s) => s.extensions ?? [])]),
    bookingToken: it.booking_token,
  };
}

export function createSerpApiProvider(apiKey: string): FlightProvider & {
  bookingOptions(token: string, q: SearchQuery): Promise<BookingOption[]>;
} {
  return {
    name: 'google-flights',
    isDemo: false,

    async search(q: SearchQuery): Promise<FlightOffer[]> {
      const body = await callSerpApi(
        {
          departure_id: q.origin,
          arrival_id: q.destination,
          outbound_date: q.date,
          type: '2', // one way
          travel_class: TRAVEL_CLASS[q.cabin],
          adults: String(q.adults),
        },
        apiKey,
      );
      const all = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
      return all.map((it, i) => mapItinerary(it, q, i)).filter((o): o is FlightOffer => o !== null);
    },

    async bookingOptions(token: string, q: SearchQuery): Promise<BookingOption[]> {
      const body = (await callSerpApi(
        {
          booking_token: token,
          departure_id: q.origin,
          arrival_id: q.destination,
          outbound_date: q.date,
          type: '2',
          travel_class: TRAVEL_CLASS[q.cabin],
          adults: String(q.adults),
        },
        apiKey,
      )) as { booking_options?: any[] };

      const options: BookingOption[] = [];
      for (const opt of body.booking_options ?? []) {
        // Separate tickets have departing/returning parts; one-way searches normally return "together".
        const part = opt.together ?? opt.departing;
        if (!part) continue;
        options.push({
          bookWith: part.book_with ?? 'Unknown seller',
          isAirline: part.airline === true,
          price: typeof part.price === 'number' ? part.price : undefined,
          currency: CURRENCY,
          optionTitle: part.option_title,
          extensions: Array.isArray(part.extensions) ? part.extensions : undefined,
          baggage: parseBaggage([...(part.extensions ?? []), ...(Array.isArray(part.baggage_prices) ? part.baggage_prices : [])]),
          url: part.booking_request?.url,
          postData: part.booking_request?.post_data,
          phone: part.booking_phone,
        });
      }
      // Airline's own website first, then cheapest.
      return options.sort((a, b) => Number(b.isAirline) - Number(a.isAirline) || (a.price ?? Infinity) - (b.price ?? Infinity));
    },
  };
}
