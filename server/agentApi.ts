// Agent API:
//   POST   /api/agent/signup        { email, password, agencyName, contactName, phone }
//   POST   /api/agent/login         { email, password }
//   POST   /api/agent/logout
//   GET    /api/agent/me
//   PUT    /api/agent/profile       { ...AgentProfile editable fields, logo as data: URL }
//   POST   /api/agent/password      { currentPassword, newPassword }
//   GET    /api/agent/quotes
//   POST   /api/agent/quotes        { customerName, customerPhone, data }
//   DELETE /api/agent/quotes/:id
// Writes require Content-Type: application/json. Combined with SameSite=Lax cookies this blocks
// cross-site form posts (CSRF).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, type AgentRow } from './db.ts';
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
import type { AgentProfile, SavedQuote } from '../shared/types.ts';

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
    gstOnCharge: a.gst_on_charge === 1,
    paymentFees: parseFees(a.payment_fees),
    trialEndsAt: a.trial_ends_at,
    paidUntil: a.paid_until,
    active: subscriptionActive(a),
  };
}

function parseFees(json: string): Record<string, number> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
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

function requireAgent(req: IncomingMessage) {
  const a = currentAgent(req);
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
    switch (route) {
      case 'POST /api/agent/signup': {
        const body = await readJson(req);
        const email = str(body.email, 200, 'Email').toLowerCase();
        const password = typeof body.password === 'string' ? body.password : '';
        const agencyName = str(body.agencyName, 120, 'Agency name');
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email');
        if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Password must be at least 8 characters');
        if (!agencyName) throw new HttpError(400, 'Enter your agency name');
        const exists = db.prepare('SELECT 1 FROM agents WHERE email = ?').get(email);
        if (exists) throw new HttpError(409, 'An account with this email already exists. Please log in.');

        const now = new Date();
        const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 86400_000);
        const phone = str(body.phone, 20, 'Phone');
        const result = db
          .prepare(
            `INSERT INTO agents (email, password_hash, contact_name, agency_name, phone, whatsapp, created_at, trial_ends_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(email, hashPassword(password), str(body.contactName, 120, 'Name'), agencyName, phone, phone, now.toISOString(), trialEnds.toISOString());
        createSession(req, res, Number(result.lastInsertRowid));
        const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(result.lastInsertRowid) as unknown as AgentRow;
        send(res, 201, toProfile(agent));
        return true;
      }

      case 'POST /api/agent/login': {
        const ip = clientIp(req);
        if (tooManyFailures(ip)) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
        const body = await readJson(req);
        const email = str(body.email, 200, 'Email').toLowerCase();
        const password = typeof body.password === 'string' ? body.password : '';
        const agent = db.prepare('SELECT * FROM agents WHERE email = ?').get(email) as AgentRow | undefined;
        if (!agent || !verifyPassword(password, agent.password_hash)) {
          recordFailure(ip);
          throw new HttpError(401, 'Wrong email or password');
        }
        createSession(req, res, agent.id);
        send(res, 200, toProfile(agent));
        return true;
      }

      case 'POST /api/agent/logout': {
        destroySession(req, res);
        send(res, 200, { ok: true });
        return true;
      }

      case 'GET /api/agent/me': {
        const a = currentAgent(req);
        send(res, a ? 200 : 401, a ? toProfile(a) : { error: 'Not logged in' });
        return true;
      }

      case 'PUT /api/agent/profile': {
        const a = requireAgent(req);
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

        db.prepare(
          `UPDATE agents SET contact_name = ?, agency_name = ?, phone = ?, whatsapp = ?, address = ?, city = ?,
             gstin = ?, website = ?, logo = ?, brand_color = ?, ticket_footer = ?, default_markup = ?, gst_on_charge = ?, payment_fees = ? WHERE id = ?`,
        ).run(
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
          body.gstOnCharge === true ? 1 : 0,
          JSON.stringify(validateFees(body.paymentFees)),
          a.id,
        );
        send(res, 200, toProfile(db.prepare('SELECT * FROM agents WHERE id = ?').get(a.id) as unknown as AgentRow));
        return true;
      }

      case 'POST /api/agent/password': {
        const a = requireAgent(req);
        const body = await readJson(req);
        const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        const next = typeof body.newPassword === 'string' ? body.newPassword : '';
        if (!verifyPassword(current, a.password_hash)) throw new HttpError(400, 'Current password is wrong');
        if (next.length < 8 || next.length > 200) throw new HttpError(400, 'New password must be at least 8 characters');
        db.prepare('UPDATE agents SET password_hash = ? WHERE id = ?').run(hashPassword(next), a.id);
        // Sign out other devices, keep this one.
        db.prepare('DELETE FROM sessions WHERE agent_id = ?').run(a.id);
        createSession(req, res, a.id);
        send(res, 200, { ok: true });
        return true;
      }

      case 'GET /api/agent/quotes': {
        const a = requireAgent(req);
        const rows = db
          .prepare(
            `SELECT id, customer_name, customer_phone, data, created_at, updated_at, status FROM quotes
             WHERE agent_id = ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 200`,
          )
          .all(a.id) as { id: number; customer_name: string; customer_phone: string; data: string; created_at: string; updated_at: string | null; status: string }[];
        const quotes: SavedQuote[] = rows.map((r) => ({
          id: r.id,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          createdAt: r.created_at,
          updatedAt: r.updated_at ?? undefined,
          status: r.status === 'draft' ? 'draft' : 'sent',
          data: JSON.parse(r.data),
        }));
        send(res, 200, quotes);
        return true;
      }

      case 'POST /api/agent/quotes': {
        const a = requireAgent(req);
        requireActive(a);
        const body = await readJson(req);
        const q = quoteFields(body);
        const now = new Date().toISOString();
        const result = db
          .prepare('INSERT INTO quotes (agent_id, customer_name, customer_phone, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(a.id, q.customerName, q.customerPhone, q.data, q.status, now, now);
        // Keep only the agency's latest MAX_QUOTES quotes (by last created/edited); older ones are removed.
        const removed = db
          .prepare(
            `DELETE FROM quotes WHERE agent_id = ? AND id NOT IN (
               SELECT id FROM quotes WHERE agent_id = ? ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT ?
             )`,
          )
          .run(a.id, a.id, MAX_QUOTES);
        send(res, 201, { id: Number(result.lastInsertRowid), removedOld: Number(removed.changes) });
        return true;
      }

      case 'PUT /api/agent/quotes/:id': {
        const a = requireAgent(req);
        requireActive(a);
        const id = Number(url.pathname.split('/').pop());
        const body = await readJson(req);
        const q = quoteFields(body);
        const r = db
          .prepare('UPDATE quotes SET customer_name = ?, customer_phone = ?, data = ?, status = ?, updated_at = ? WHERE id = ? AND agent_id = ?')
          .run(q.customerName, q.customerPhone, q.data, q.status, new Date().toISOString(), id, a.id);
        if (Number(r.changes) === 0) throw new HttpError(404, 'Quote not found');
        send(res, 200, { id });
        return true;
      }

      case 'DELETE /api/agent/quotes/:id': {
        const a = requireAgent(req);
        const id = Number(url.pathname.split('/').pop());
        db.prepare('DELETE FROM quotes WHERE id = ? AND agent_id = ?').run(id, a.id);
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
