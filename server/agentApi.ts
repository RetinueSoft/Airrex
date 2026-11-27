// Agent API:
//   POST   /api/agent/signup        { email, password, agencyName, contactName, phone }
//   POST   /api/agent/login         { email, password }
//   POST   /api/agent/logout
//   GET    /api/agent/me
//   PUT    /api/agent/profile       { ...AgentProfile editable fields, logo as data: URL }
//   POST   /api/agent/password      { currentPassword, newPassword }
//   GET    /api/agent/quotes
//   POST   /api/agent/quotes        { customerName, customerPhone, data, status }
//   PUT    /api/agent/quotes/:id    { customerName, customerPhone, data, status }
//   DELETE /api/agent/quotes/:id
// Writes require Content-Type: application/json. Combined with SameSite=Lax cookies this blocks
// cross-site form posts (CSRF).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { exec, migrate, one, many, tx, type AgentRow, type PassengerRow, type QuoteRow } from './db.ts';
import { decryptJson, encryptJson, passengerStorageEnabled } from './crypto.ts';
import {
  clientIp,
  createSession,
  currentAgent,
  destroySession,
  hashPassword,
  recordFailure,
  subscriptionActive,
  tooManyFailures,
  TRIAL_DAYS,
  verifyPassword,
} from './auth.ts';
import type { AgentProfile, PassengerDetails, SavedPassenger, SavedQuote } from '../shared/types.ts';

/** Quotes kept per agency. Saving a new quote removes the oldest beyond this. */
export const MAX_QUOTES = Math.max(1, Number(process.env.MAX_QUOTES_PER_AGENT ?? 20));
const MAX_BODY = 1_500_000; // logo upload is the biggest thing we accept
const MAX_LOGO = 400_000; // characters of data: URL (~290 KB image)

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Expected JSON');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large (logo must be under ~300 KB)');
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function str(v: unknown, max: number, field: string): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`);
  const s = v.trim();
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return s;
}

function toProfile(a: AgentRow): AgentProfile {
  return {
    email: a.email,
    contactName: a.contact_name,
    agencyName: a.agency_name,
    phone: a.phone,
    whatsapp: a.whatsapp,
    address: a.address,
    city: a.city,
    gstin: a.gstin,
    website: a.website,
    logo: a.logo,
    brandColor: a.brand_color,
    ticketFooter: a.ticket_footer,
    defaultMarkup: a.default_markup,
    gstOnCharge: a.gst_on_charge,
    paymentFees: a.payment_fees && typeof a.payment_fees === 'object' ? a.payment_fees : {},
    trialEndsAt: a.trial_ends_at.toISOString(),
    paidUntil: a.paid_until ? a.paid_until.toISOString() : null,
    active: subscriptionActive(a),
  };
}

function toQuote(r: QuoteRow): SavedQuote {
  return {
    id: r.id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at ? r.updated_at.toISOString() : undefined,
    status: r.status === 'draft' ? 'draft' : 'sent',
    data: r.data as SavedQuote['data'],
  };
}

/** { default?: n, "6E"?: n, ... } with whole-rupee amounts 0–5000. Empty/blank entries are dropped. */
function validateFees(v: unknown): Record<string, number> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Payment fees must be a list of amounts');
  const out: Record<string, number> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 40) throw new HttpError(400, 'Too many payment fee entries');
  for (const [key, raw] of entries) {
    if (!/^(default|[A-Z0-9]{2})$/.test(key)) throw new HttpError(400, `Unknown airline code "${key}"`);
    if (raw === '' || raw === null || raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 5000) throw new HttpError(400, 'Payment fee must be a whole number of rupees (0–5000)');
    out[key] = n;
  }
  return out;
}

function quoteFields(body: Record<string, unknown>) {
  const data = JSON.stringify(body.data ?? {});
  if (data.length > 50_000) throw new HttpError(413, 'Quote too large');
  return {
    customerName: str(body.customerName, 120, 'Customer name'),
    customerPhone: str(body.customerPhone, 20, 'Customer phone'),
    data,
    status: body.status === 'draft' ? 'draft' : 'sent',
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const MAX_PASSENGERS = 200;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function passengerFields(v: unknown): PassengerDetails {
  if (typeof v !== 'object' || v === null) throw new HttpError(400, 'Passenger details missing');
  const b = v as Record<string, unknown>;
  const upper = (x: unknown, max: number, field: string) => str(x, max, field).toUpperCase();
  const date = (x: unknown, field: string) => {
    const s = str(x, 10, field);
    if (s && !YMD.test(s)) throw new HttpError(400, `${field} must be a date`);
    return s;
  };
  const sex = str(b.sex, 1, 'Gender').toUpperCase();
  const p: PassengerDetails = {
    givenNames: upper(b.givenNames, 60, 'Given names'),
    surname: upper(b.surname, 60, 'Surname'),
    sex: sex === 'M' || sex === 'F' || sex === 'X' ? sex : '',
    dateOfBirth: date(b.dateOfBirth, 'Date of birth'),
    nationality: upper(b.nationality, 3, 'Nationality'),
    passportNumber: upper(b.passportNumber, 12, 'Passport number').replace(/\s/g, ''),
    issuingCountry: upper(b.issuingCountry, 3, 'Issuing country'),
    passportExpiry: date(b.passportExpiry, 'Passport expiry'),
  };
  if (!p.givenNames && !p.surname) throw new HttpError(400, 'Enter the passenger name');
  if (p.passportNumber && !/^[A-Z0-9]{5,12}$/.test(p.passportNumber)) throw new HttpError(400, 'Passport number looks wrong');
  return p;
}

function toPassenger(r: PassengerRow): SavedPassenger {
  return {
    ...decryptJson<PassengerDetails>(r.data_enc),
    id: r.id,
    createdAt: r.created_at.toISOString(),
    deleteAfter: r.delete_after.toISOString(),
  };
}

function requirePassengerStorage() {
  if (!passengerStorageEnabled) throw new HttpError(503, 'Saving passengers is not set up on this server yet (PASSENGER_DATA_KEY).');
}

async function requireAgent(req: IncomingMessage) {
  const a = await currentAgent(req);
  if (!a) throw new HttpError(401, 'Please log in');
  return a;
}

function requireActive(a: AgentRow) {
  if (!subscriptionActive(a)) throw new HttpError(402, 'Your AirRex subscription has ended. Please renew to keep using agent tools.');
}


/** Returns true when the request was an agent API call (handled here). */
export async function handleAgentApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/agent/')) return false;
  const route = `${req.method} ${url.pathname.replace(/\/\d+$/, '/:id')}`;

  try {
    try {
      await migrate();
    } catch (err) {
      console.error('database unavailable:', err instanceof Error ? err.message : err);
      throw new HttpError(503, 'Agent service is temporarily unavailable. Please try again in a minute.');
    }
    switch (route) {
      case 'POST /api/agent/signup': {
        const body = await readJson(req);
        const email = str(body.email, 200, 'Email').toLowerCase();
        const password = typeof body.password === 'string' ? body.password : '';
        const agencyName = str(body.agencyName, 120, 'Agency name');
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email');
        if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Password must be at least 8 characters');
        if (!agencyName) throw new HttpError(400, 'Enter your agency name');
        if (await one('SELECT 1 FROM agents WHERE lower(email) = $1', [email])) {
          throw new HttpError(409, 'An account with this email already exists. Please log in.');
        }

        const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86400_000);
        const phone = str(body.phone, 20, 'Phone');
        let agent: AgentRow | undefined;
        try {
          agent = await one<AgentRow>(
            `INSERT INTO agents (email, password_hash, contact_name, agency_name, phone, whatsapp, trial_ends_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [email, hashPassword(password), str(body.contactName, 120, 'Name'), agencyName, phone, phone, trialEnds],
          );
        } catch (err) {
          // Two sign-ups with the same email at the same moment: the unique index catches the second.
          if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'An account with this email already exists. Please log in.');
          throw err;
        }
        await createSession(req, res, agent!.id);
        send(res, 201, toProfile(agent!));
        return true;
      }

      case 'POST /api/agent/login': {
        const ip = clientIp(req);
        if (tooManyFailures(ip)) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
        const body = await readJson(req);
        const email = str(body.email, 200, 'Email').toLowerCase();
        const password = typeof body.password === 'string' ? body.password : '';
        const agent = await one<AgentRow>('SELECT * FROM agents WHERE lower(email) = $1', [email]);
        if (!agent || !verifyPassword(password, agent.password_hash)) {
          recordFailure(ip);
          throw new HttpError(401, 'Wrong email or password');
        }
        await createSession(req, res, agent.id);
        send(res, 200, toProfile(agent));
        return true;
      }

      case 'POST /api/agent/logout': {
        await destroySession(req, res);
        send(res, 200, { ok: true });
        return true;
      }

      case 'GET /api/agent/me': {
        const a = await currentAgent(req);
        send(res, a ? 200 : 401, a ? toProfile(a) : { error: 'Not logged in' });
        return true;
      }

      case 'PUT /api/agent/profile': {
        const a = await requireAgent(req);
        const body = await readJson(req);
        const logo = str(body.logo, MAX_LOGO, 'Logo');
        if (logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) {
          throw new HttpError(400, 'Logo must be a PNG, JPG or WebP image');
        }
        const brandColor = str(body.brandColor, 7, 'Brand colour') || '#0A1C34';
        if (!/^#[0-9a-f]{6}$/i.test(brandColor)) throw new HttpError(400, 'Brand colour must look like #1A2B3C');
        const markup = Number(body.defaultMarkup ?? 0);
        if (!Number.isInteger(markup) || markup < 0 || markup > 100000) throw new HttpError(400, 'Service charge must be a whole number of rupees');
        const agencyName = str(body.agencyName, 120, 'Agency name');
        if (!agencyName) throw new HttpError(400, 'Agency name is required');
        const gstin = str(body.gstin, 15, 'GSTIN').toUpperCase();
        if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) throw new HttpError(400, 'GSTIN must be 15 letters/numbers');

        const updated = await one<AgentRow>(
          `UPDATE agents SET contact_name = $1, agency_name = $2, phone = $3, whatsapp = $4, address = $5, city = $6,
             gstin = $7, website = $8, logo = $9, brand_color = $10, ticket_footer = $11, default_markup = $12,
             gst_on_charge = $13, payment_fees = $14::jsonb
           WHERE id = $15 RETURNING *`,
          [
            str(body.contactName, 120, 'Name'),
            agencyName,
            str(body.phone, 20, 'Phone'),
            str(body.whatsapp, 20, 'WhatsApp number'),
            str(body.address, 300, 'Address'),
            str(body.city, 80, 'City'),
            gstin,
            str(body.website, 200, 'Website'),
            logo,
            brandColor,
            str(body.ticketFooter, 400, 'Ticket footer'),
            markup,
            body.gstOnCharge === true,
            JSON.stringify(validateFees(body.paymentFees)),
            a.id,
          ],
        );
        send(res, 200, toProfile(updated!));
        return true;
      }

      case 'POST /api/agent/password': {
        const a = await requireAgent(req);
        const body = await readJson(req);
        const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        const next = typeof body.newPassword === 'string' ? body.newPassword : '';
        if (!verifyPassword(current, a.password_hash)) throw new HttpError(400, 'Current password is wrong');
        if (next.length < 8 || next.length > 200) throw new HttpError(400, 'New password must be at least 8 characters');
        await tx(async (c) => {
          await c.query('UPDATE agents SET password_hash = $1 WHERE id = $2', [hashPassword(next), a.id]);
          // Sign out other devices; a new session for this one is created below.
          await c.query('DELETE FROM sessions WHERE agent_id = $1', [a.id]);
        });
        await createSession(req, res, a.id);
        send(res, 200, { ok: true });
        return true;
      }

      case 'GET /api/agent/quotes': {
        const a = await requireAgent(req);
        const rows = await many<QuoteRow>(
          `SELECT * FROM quotes WHERE agent_id = $1 ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 200`,
          [a.id],
        );
        send(res, 200, rows.map(toQuote));
        return true;
      }

      case 'POST /api/agent/quotes': {
        const a = await requireAgent(req);
        requireActive(a);
        const q = quoteFields(await readJson(req));
        const result = await tx(async (c) => {
          const ins = await c.query<{ id: number }>(
            `INSERT INTO quotes (agent_id, customer_name, customer_phone, data, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, now(), now()) RETURNING id`,
            [a.id, q.customerName, q.customerPhone, q.data, q.status],
          );
          // Keep only the agency's latest MAX_QUOTES quotes (by last created/edited); older ones are removed.
          const del = await c.query(
            `DELETE FROM quotes WHERE agent_id = $1 AND id NOT IN (
               SELECT id FROM quotes WHERE agent_id = $1 ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT $2
             )`,
            [a.id, MAX_QUOTES],
          );
          return { id: ins.rows[0].id, removedOld: del.rowCount ?? 0 };
        });
        send(res, 201, result);
        return true;
      }

      case 'PUT /api/agent/quotes/:id': {
        const a = await requireAgent(req);
        requireActive(a);
        const id = Number(url.pathname.split('/').pop());
        const q = quoteFields(await readJson(req));
        const changed = await exec(
          `UPDATE quotes SET customer_name = $1, customer_phone = $2, data = $3::jsonb, status = $4, updated_at = now()
           WHERE id = $5 AND agent_id = $6`,
          [q.customerName, q.customerPhone, q.data, q.status, id, a.id],
        );
        if (changed === 0) throw new HttpError(404, 'Quote not found');
        send(res, 200, { id });
        return true;
      }

      case 'DELETE /api/agent/quotes/:id': {
        const a = await requireAgent(req);
        const id = Number(url.pathname.split('/').pop());
        await exec('DELETE FROM quotes WHERE id = $1 AND agent_id = $2', [id, a.id]);
        send(res, 200, { ok: true });
        return true;
      }

      case 'GET /api/agent/passengers': {
        const a = await requireAgent(req);
        requirePassengerStorage();
        const rows = await many<PassengerRow>(
          'SELECT * FROM passengers WHERE agent_id = $1 AND delete_after > now() ORDER BY created_at DESC, id DESC',
          [a.id],
        );
        const list: SavedPassenger[] = [];
        for (const r of rows) {
          try {
            list.push(toPassenger(r));
          } catch {
            /* encrypted with a different key: skip */
          }
        }
        send(res, 200, list);
        return true;
      }

      case 'POST /api/agent/passengers': {
        const a = await requireAgent(req);
        requireActive(a);
        requirePassengerStorage();
        const body = await readJson(req);
        if (body.consent !== true) throw new HttpError(400, "Confirm you have the passenger's permission to save their passport details");
        const p = passengerFields(body.passenger);
        const keepDays = Math.min(365, Math.max(1, Math.round(Number(body.keepDays) || 30)));
        const row = await tx(async (c) => {
          const count = await c.query<{ n: string }>('SELECT count(*) AS n FROM passengers WHERE agent_id = $1 AND delete_after > now()', [a.id]);
          if (Number(count.rows[0].n) >= MAX_PASSENGERS) throw new HttpError(409, `You can save up to ${MAX_PASSENGERS} passengers. Delete some first.`);
          const ins = await c.query<PassengerRow>(
            `INSERT INTO passengers (agent_id, data_enc, delete_after) VALUES ($1, $2, now() + make_interval(days => $3)) RETURNING *`,
            [a.id, encryptJson(p), keepDays],
          );
          return ins.rows[0];
        });
        send(res, 201, toPassenger(row));
        return true;
      }

      case 'DELETE /api/agent/passengers/:id': {
        const a = await requireAgent(req);
        const id = Number(url.pathname.split('/').pop());
        await exec('DELETE FROM passengers WHERE id = $1 AND agent_id = $2', [id, a.id]);
        send(res, 200, { ok: true });
        return true;
      }

      default:
        send(res, 404, { error: 'not found' });
        return true;
    }
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, { error: err.message });
    else {
      console.error(err);
      send(res, 500, { error: 'Something went wrong' });
    }
    return true;
  }
}
