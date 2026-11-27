// POST /api/fare-reports: after booking, a traveller or agent can tell AirRex what the airline actually charged
// (final total, fare type, bag cost, fees). Used to check and improve AirRex's prices, fee and baggage rules.
// Open to everyone (logged-in agents are linked); no IP address or personal data is stored.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { exec, migrate } from './db.ts';
import { clientIp, currentAgent } from './auth.ts';
import { findAirport } from '../shared/airports.ts';

const PER_HOUR = 20;
const recent = new Map<string, number[]>();

function rateLimited(ip: string) {
  const now = Date.now();
  const list = (recent.get(ip) ?? []).filter((t) => now - t < 3600_000);
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return list.length > PER_HOUR;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage) {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return null;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 8_000) return null;
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof v === 'object' && v && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const amount = (v: unknown, max = 5_000_000) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : NaN;
};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const capturesRecent = new Map<string, number[]>();
const CAPTURES_PER_HOUR = 300;

async function readJsonLimited(req: IncomingMessage, max: number) {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return null;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) return null;
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof v === 'object' && v && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** POST /api/page-captures: prices/fees the AirRex Helper extension saw on an airline page. */
async function handleCapture(req: IncomingMessage, res: ServerResponse) {
  const ip = clientIp(req);
  const now = Date.now();
  const recentList = (capturesRecent.get(ip) ?? []).filter((t) => now - t < 3600_000);
  recentList.push(now);
  capturesRecent.set(ip, recentList);
  if (capturesRecent.size > 5000) capturesRecent.clear();
  if (recentList.length > CAPTURES_PER_HOUR) return send(res, 429, { error: 'Too many captures' });

  const b = await readJsonLimited(req, 64_000);
  const trip = (b?.trip ?? null) as Record<string, unknown> | null;
  const page = (b?.page ?? null) as Record<string, unknown> | null;
  if (!trip || !page) return send(res, 400, { error: 'Invalid capture' });

  const origin = text(trip.origin, 3).toUpperCase();
  const destination = text(trip.destination, 3).toUpperCase();
  const date = text(trip.date, 10);
  const adults = Math.round(Number(trip.adults));
  const airlineCode = text(trip.airlineCode, 2).toUpperCase();
  const shownTotal = amount(trip.shownTotal);
  const host = text(page.host, 100).toLowerCase();
  const rawLines = Array.isArray(page.lines) ? page.lines.slice(0, 200) : null;
  if (
    !findAirport(origin) || !findAirport(destination) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(adults >= 1 && adults <= 9) ||
    !/^[A-Z0-9]{2}$/.test(airlineCode) || !shownTotal || !/^[a-z0-9.-]+(:\d+)?$/.test(host) || !rawLines
  ) {
    return send(res, 400, { error: 'Invalid capture' });
  }
  const lines = rawLines
    .filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
    .map((l) => ({ text: text(l.text, 200), amount: amount(l.amount) }))
    .filter((l) => l.text && !Number.isNaN(l.amount));
  if (!lines.length) return send(res, 400, { error: 'No price lines' });

  try {
    await migrate();
    await exec(
      `INSERT INTO page_captures (origin, destination, travel_date, adults, airline_code, flight_numbers, shown_total,
         host, path, title, heading, lines, helper_version, payment_page)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)`,
      [
        origin, destination, date, adults, airlineCode, text(trip.flightNumbers, 60), shownTotal,
        host, text(page.path, 200), text(page.title, 120), text(page.heading, 120), JSON.stringify(lines), text(b?.helperVersion, 20),
        page.paymentPage === true,
      ],
    );
    send(res, 201, { ok: true });
  } catch (err) {
    console.error('page capture:', err instanceof Error ? err.message : err);
    send(res, 503, { error: 'Could not save right now' });
  }
}

export async function handleReportsApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname === '/api/page-captures') {
    if (req.method !== 'POST') send(res, 405, { error: 'POST only' });
    else await handleCapture(req, res);
    return true;
  }
  if (url.pathname !== '/api/fare-reports') return false;
  if (req.method !== 'POST') {
    send(res, 405, { error: 'POST only' });
    return true;
  }
  if (rateLimited(clientIp(req))) {
    send(res, 429, { error: 'Too many reports. Please try again later.' });
    return true;
  }
  const b = await readJson(req);
  if (!b) {
    send(res, 400, { error: 'Invalid report' });
    return true;
  }
  const origin = text(b.origin, 3).toUpperCase();
  const destination = text(b.destination, 3).toUpperCase();
  const date = text(b.date, 10);
  const adults = Math.round(Number(b.adults));
  const shownTotal = amount(b.shownTotal);
  const paidTotal = amount(b.paidTotal);
  const fareType = ['cheapest', 'with-bag', 'flexi', 'other'].includes(text(b.fareType, 20)) ? text(b.fareType, 20) : 'other';
  const extras = [amount(b.bagKg, 100), amount(b.bagCost), amount(b.airlineFee), amount(b.otherFees)];

  if (
    !findAirport(origin) ||
    !findAirport(destination) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !(adults >= 1 && adults <= 9) ||
    !shownTotal ||
    !paidTotal ||
    extras.some((x) => Number.isNaN(x)) ||
    !/^[A-Z0-9]{2}$/.test(text(b.airlineCode, 2).toUpperCase())
  ) {
    send(res, 400, { error: 'Please check the amounts and try again.' });
    return true;
  }

  try {
    await migrate();
    const agent = await currentAgent(req).catch(() => null);
    await exec(
      `INSERT INTO fare_reports (agent_id, origin, destination, travel_date, adults, airline_code, flight_numbers,
         shown_total, paid_total, fare_type, bag_kg, bag_cost, airline_fee, other_fees, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        agent?.id ?? null,
        origin,
        destination,
        date,
        adults,
        text(b.airlineCode, 2).toUpperCase(),
        text(b.flightNumbers, 60),
        shownTotal,
        paidTotal,
        fareType,
        ...extras,
        text(b.notes, 500),
      ],
    );
    send(res, 201, { ok: true });
  } catch (err) {
    console.error('fare report:', err instanceof Error ? err.message : err);
    send(res, 503, { error: 'Could not save right now. Please try again later.' });
  }
  return true;
}
