// AirRex API server. Plain node:http so it runs with `node server/index.ts` (Node 22.18+ strips TS types).
//   GET /api/airports?q=del
//   GET /api/search?origin=DEL&destination=BOM&date=2026-12-01&adults=1&cabin=economy
//   GET /api/booking-options?token=...&origin=DEL&destination=BOM&date=...&adults=1&cabin=economy
// In production it also serves the built web app from ./dist.
//
// Flight data source, first match wins:
//   SERPAPI_API_KEY      -> Google Flights via SerpApi (live prices)
//   DUFFEL_ACCESS_TOKEN  -> Duffel
//   (none)               -> demo fares

import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { AIRPORTS } from '../shared/airports.ts';
import { processingFeeFor, processingFeeTotal } from '../shared/airlineFees.ts';
import { typicalBaggage } from '../shared/baggagePolicy.ts';
import type {
  BookingOption,
  CabinClass,
  CalendarDay,
  CalendarResponse,
  FlightOffer,
  SearchQuery,
  SearchResponse,
} from '../shared/types.ts';
import { fetchMonthEstimates, type DayEstimate } from './providers/travelpayouts.ts';
import { mockProvider } from './providers/mock.ts';
import { createDuffelProvider } from './providers/duffel.ts';
import { createSerpApiProvider, SerpApiError } from './providers/serpapi.ts';
import type { FlightProvider } from './providers/types.ts';
import { createCache } from './cache.ts';
import { handleAgentApi } from './agentApi.ts';
import { migrate } from './db.ts';
import { startSessionCleanup } from './auth.ts';

// In dev (`--dev`) the API always uses API_PORT/8787, because PORT belongs to the Vite web server there.
const PORT = Number(process.argv.includes('--dev') ? (process.env.API_PORT ?? 8787) : (process.env.PORT ?? 8787));
const DIST = join(import.meta.dirname, '..', 'dist');
const env = process.env;

const serpapi = env.SERPAPI_API_KEY ? createSerpApiProvider(env.SERPAPI_API_KEY) : undefined;
const provider: FlightProvider =
  serpapi ?? (env.DUFFEL_ACCESS_TOKEN ? createDuffelProvider(env.DUFFEL_ACCESS_TOKEN) : mockProvider);

/** Show demo fares (clearly labelled) when the live source fails. Off by default: fake prices shouldn't reach real users. */
const FALLBACK_TO_DEMO = env.FALLBACK_TO_DEMO === 'true';

// Paid searches are reused for 12 hours to save quota. The results page shows "Prices checked X hrs ago".
const cacheMinutes = Number(env.SEARCH_CACHE_MINUTES ?? (provider === mockProvider ? 5 : 720));
const searchCache = createCache<SearchResponse>('search', cacheMinutes * 60_000);
// Booking links cost one SerpApi search per flight, so they are only fetched when the user asks, and kept 3 hours.
const bookingCache = createCache<BookingOption[]>('booking', 3 * 60 * 60_000);

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function parseQuery(params: URLSearchParams): SearchQuery | string {
  const origin = (params.get('origin') ?? '').toUpperCase();
  const destination = (params.get('destination') ?? '').toUpperCase();
  const date = params.get('date') ?? '';
  const adults = Number(params.get('adults') ?? 1);
  // Economy only: one cabin keeps results simple and saves paid searches (no separate cache entries per cabin).
  const cabin: CabinClass = 'economy';

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return 'origin and destination must be 3-letter airport codes';
  if (origin === destination) return 'origin and destination must differ';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return 'date must be YYYY-MM-DD';
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return 'date cannot be in the past';
  if (!Number.isInteger(adults) || adults < 1 || adults > 9) return 'adults must be 1-9';
  return { origin, destination, date, adults, cabin };
}

/**
 * Always search for ONE adult, then multiply for the group. A 2- or 3-adult search then reuses the
 * 1-adult result instead of spending another paid search. Group totals are an estimate: the airline
 * may price the group higher if only one seat is left in the cheapest fare.
 */
function oneAdult(query: SearchQuery): SearchQuery {
  return { ...query, adults: 1 };
}

/**
 * Scale a 1-adult offer to the group and add any processing/convenience fee the airline charges on its
 * payment page (Scoot: per booking; Air India Express: per passenger per flight).
 */
function scaleOffer(offer: FlightOffer, passengers: number, origin: string, destination: string): FlightOffer {
  const f = offer.fare;
  const rule = processingFeeFor(offer.airlineCode, origin);
  const fee = rule ? processingFeeTotal(rule, { passengers, segments: offer.segments.length, origin, destination }) : 0;
  const total = f.total * passengers + fee;
  return {
    ...offer,
    // Google Flights search results carry no baggage details: fall back to the airline's usual allowance.
    baggage: offer.baggage ?? typicalBaggage(offer.airlineCode, origin, destination),
    fare: {
      ...f,
      baseFare: f.baseFare !== undefined ? f.baseFare * passengers : undefined,
      taxesAndFees: f.taxesAndFees !== undefined ? f.taxesAndFees * passengers + fee : undefined,
      total,
      perPerson: Math.round(total / passengers),
      passengers,
      ...(rule ? { processingFee: fee, processingFeeLabel: rule.label } : {}),
    },
  };
}

/** Make a 1-adult search response fit the requested group size. */
function forGroup(base: SearchResponse, query: SearchQuery): SearchResponse {
  const offers = base.offers
    .filter((o) => o.seatsLeft === undefined || o.seatsLeft >= query.adults) // not enough seats for the group
    .map((o) => scaleOffer(o, query.adults, query.origin, query.destination))
    .sort((a, b) => a.fare.total - b.fare.total); // processing fees can change the order
  return { ...base, query, offers };
}

/** Fetch 1-adult results from the live source (or demo fallback). */
async function runSearch(base: SearchQuery): Promise<SearchResponse> {
  try {
    const offers = await provider.search(base);
    offers.sort((a, b) => a.fare.total - b.fare.total);
    return { query: base, provider: provider.name, isDemoData: provider.isDemo, offers, fetchedAt: new Date().toISOString() };
  } catch (err) {
    if (!FALLBACK_TO_DEMO || provider === mockProvider) throw err;
    console.warn('live search failed, showing demo fares:', err instanceof Error ? err.message : err);
    const offers = await mockProvider.search(base);
    offers.sort((a, b) => a.fare.total - b.fare.total);
    return {
      query: base,
      provider: mockProvider.name,
      isDemoData: true,
      offers,
      fetchedAt: new Date().toISOString(),
      notice: 'Live prices are unavailable right now, so demo fares are shown.',
    };
  }
}

function searchKey(base: SearchQuery) {
  return `${provider.name}|${JSON.stringify(base)}`;
}

// ---- Cheapest-date calendar --------------------------------------------------------------
// Uses NO paid searches. Each day's price comes from, in order:
//   1. a live search the app already saved (exact when checked)
//   2. Travelpayouts recent-search prices (approximate), if TRAVELPAYOUTS_TOKEN is set
//   3. demo fares, when running without a live source

const MAX_CALENDAR_DAYS = 62;
const estimateCache = createCache<Record<string, DayEstimate>>('estimates', 6 * 60 * 60_000);

function dateRange(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  while (out.length <= MAX_CALENDAR_DAYS) {
    const ymd = d.toISOString().slice(0, 10);
    if (ymd > to) break;
    out.push(ymd);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function monthEstimates(origin: string, destination: string, month: string) {
  const token = env.TRAVELPAYOUTS_TOKEN;
  if (!token) return {};
  const key = `${origin}-${destination}-${month}`;
  const cached = estimateCache.get(key);
  if (cached) return cached;
  try {
    const data = await fetchMonthEstimates(token, origin, destination, month);
    estimateCache.set(key, data);
    return data;
  } catch (err) {
    console.warn(err instanceof Error ? err.message : err);
    return {};
  }
}

async function buildCalendar(origin: string, destination: string, dates: string[]): Promise<CalendarResponse> {
  const isDemo = provider === mockProvider;
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const estimates = Object.assign({}, ...(await Promise.all(months.map((m) => monthEstimates(origin, destination, m)))));

  const days: CalendarDay[] = [];
  for (const date of dates) {
    const base: SearchQuery = { origin, destination, date, adults: 1, cabin: 'economy' };
    let saved = searchCache.get(searchKey(base));
    if (!saved && isDemo) saved = await runSearch(base); // demo fares are free to generate
    const cheapest = (saved ? forGroup(saved, base).offers : []).reduce<FlightOffer | undefined>((m, o) => (!m || o.fare.total < m.fare.total ? o : m), undefined);

    if (cheapest) {
      days.push({
        date,
        price: cheapest.fare.total,
        airlineCode: cheapest.airlineCode,
        stops: cheapest.stops,
        source: saved!.isDemoData ? 'demo' : 'live',
        checkedAt: saved!.fetchedAt,
      });
    } else if (estimates[date]) {
      days.push({ date, ...estimates[date], source: 'estimate' });
    } else {
      days.push({ date, source: 'none' });
    }
  }

  const priced = days.filter((d) => d.price !== undefined);
  const cheapestDay = priced.reduce<CalendarDay | undefined>((m, d) => (!m || d.price! < m.price! ? d : m), undefined);
  return { origin, destination, currency: 'INR', days, cheapestDate: cheapestDay?.date, isDemoData: isDemo };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (await handleAgentApi(req, res, url)) return;

    if (url.pathname === '/api/airports') {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const list = q ? AIRPORTS.filter((a) => `${a.code} ${a.city} ${a.name} ${a.aliases?.join(' ') ?? ''}`.toLowerCase().includes(q)) : AIRPORTS;
      return json(res, 200, list.slice(0, 20));
    }

    if (url.pathname === '/api/search') {
      const query = parseQuery(url.searchParams);
      if (typeof query === 'string') return json(res, 400, { error: query });
      // Cache key ignores the number of adults: 1, 2 or 9 adults all share one paid search.
      const base = oneAdult(query);
      const key = searchKey(base);
      let body = searchCache.get(key);
      if (!body) {
        body = await runSearch(base);
        if (!body.notice) searchCache.set(key, body); // don't cache fallback results
      }
      return json(res, 200, forGroup(body, query));
    }

    if (url.pathname === '/api/booking-options') {
      const token = url.searchParams.get('token') ?? '';
      const query = parseQuery(url.searchParams);
      if (!serpapi) return json(res, 404, { error: 'booking options need SERPAPI_API_KEY' });
      if (!token || token.length > 4000) return json(res, 400, { error: 'missing token' });
      if (typeof query === 'string') return json(res, 400, { error: query });
      // The token comes from a 1-adult search, so links and prices are per person; multiply for the group.
      let options = bookingCache.get(token);
      // cachedOnly=1: answer from the cache without spending a search (the pop-up asks this first).
      if (!options && url.searchParams.get('cachedOnly') === '1') return json(res, 200, null);
      if (!options) {
        options = await serpapi.bookingOptions(token, oneAdult(query));
        bookingCache.set(token, options);
      }
      return json(
        res,
        200,
        options.map((o) => ({ ...o, perPerson: o.price, price: o.price !== undefined ? o.price * query.adults : undefined })),
      );
    }

    if (url.pathname === '/api/calendar') {
      const origin = (url.searchParams.get('origin') ?? '').toUpperCase();
      const destination = (url.searchParams.get('destination') ?? '').toUpperCase();
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      const check = parseQuery(new URLSearchParams({ origin, destination, date: from }));
      if (typeof check === 'string') return json(res, 400, { error: check });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return json(res, 400, { error: 'to must be a date on or after from' });
      const days = dateRange(from, to);
      if (days.length > MAX_CALENDAR_DAYS) return json(res, 400, { error: `choose at most ${MAX_CALENDAR_DAYS} days` });
      return json(res, 200, await buildCalendar(origin, destination, days));
    }

    if (url.pathname === '/api/health') return json(res, 200, { ok: true, provider: provider.name });
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });

    // Static hosting of the built app (production).
    if (existsSync(DIST)) {
      const safe = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      let file = join(DIST, safe);
      if (!file.startsWith(DIST) || !existsSync(file) || !extname(file)) file = join(DIST, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      return res.end(data);
    }
    json(res, 404, { error: 'not found (run `npm run build` to serve the web app from this server)' });
  } catch (err) {
    console.error(err);
    const message =
      err instanceof SerpApiError && err.quotaOrAuth
        ? 'Live prices are temporarily unavailable. Please try again later.'
        : err instanceof Error
          ? err.message
          : 'upstream error';
    json(res, 502, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(
    `AirRex API on http://localhost:${PORT}  (data: ${provider.name}${provider.isDemo ? ', demo/test' : ''}; cache ${cacheMinutes} min${FALLBACK_TO_DEMO ? '; demo fallback on' : ''})`,
  );
});

// PostgreSQL (agent accounts and quotes). Flight search works without it; agent pages answer 503 until it is up.
migrate()
  .then(() => console.log('PostgreSQL ready'))
  .catch((err) => console.error(`PostgreSQL not reachable yet (${err.message}); agent pages will retry on each request`));
startSessionCleanup();
