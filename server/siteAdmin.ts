// Site admin (/site-admin): one user, "rexl", who activates agencies and sets their licence, expiry date and
// grace period.
//
// The admin password is set once after deployment, on /site-admin. So a stranger can't set it first, the page
// also asks for a one-time setup code that the server prints in its log (or ADMIN_SETUP_CODE if set).
// Sessions use a separate HttpOnly cookie (airrex_admin, 12 hours); logins are rate-limited like agents'.

import { randomBytes, randomInt, createHash } from 'node:crypto';
import { passwordProblem } from '../shared/password.ts';
import { normalizeMobile } from '../shared/mobile.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { exec, many, migrate, one } from './db.ts';
import { clientIp, hashPassword, recordFailure, tooManyFailures, verifyPassword } from './auth.ts';

export const SITE_ADMIN_USER = 'rexl';
/** rexl logs in with this mobile number (SITE_ADMIN_MOBILE to change it). */
export const SITE_ADMIN_MOBILE = normalizeMobile(process.env.SITE_ADMIN_MOBILE ?? '') || '9943135008';
const COOKIE = 'airrex_admin';
const SESSION_HOURS = 12;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

let setupCode: string | null = null;

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
  // JSON only: browsers can't send this cross-site without CORS, which protects against CSRF.
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Expected JSON');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 20_000) throw new HttpError(413, 'Request too large');
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function readToken(req: IncomingMessage) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie ?? '');
  return m?.[1];
}

function isHttps(req: IncomingMessage) {
  return (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') || process.env.NODE_ENV === 'production';
}

async function adminExists() {
  return !!(await one('SELECT 1 FROM site_admins WHERE username = $1', [SITE_ADMIN_USER]));
}

/** If the admin password isn't set yet, make the one-time setup code (once) and print it in the server log. */
async function ensureSetupCode() {
  if (setupCode || (await adminExists())) return;
  setupCode = process.env.ADMIN_SETUP_CODE?.trim() || randomBytes(6).toString('hex').toUpperCase();
  console.log(
    `\n  Site admin not set up yet. Open /site-admin, enter this one-time setup code and choose the password for "${SITE_ADMIN_USER}":\n` +
      `    ${setupCode}\n`,
  );
}

/** Called at server start (the code is also made on the first visit to /site-admin if the database was down). */
export async function announceAdminSetup() {
  await migrate();
  await ensureSetupCode();
}

async function createAdminSession(req: IncomingMessage, res: ServerResponse) {
  const token = randomBytes(32).toString('base64url');
  await exec('INSERT INTO admin_sessions (token_hash, username, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))', [
    sha256(token),
    SITE_ADMIN_USER,
    SESSION_HOURS,
  ]);
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SESSION_HOURS * 3600}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function loggedIn(req: IncomingMessage) {
  const token = readToken(req);
  if (!token) return false;
  return !!(await one('SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()', [sha256(token)]));
}

async function requireAdmin(req: IncomingMessage) {
  if (!(await loggedIn(req))) throw new HttpError(401, 'Please log in as the site admin');
}

function checkPassword(pw: unknown) {
  if (typeof pw !== 'string') throw new HttpError(400, 'Enter a password');
  const problem = passwordProblem(pw);
  if (problem) throw new HttpError(400, problem);
  return pw;
}

const STATUSES = ['pending', 'active', 'suspended'];

/** A temporary password that meets the password rule, e.g. "Rx4821#kqmt". */
function temporaryPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const caps = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const symbols = '@#$!%';
  const pick = (s: string) => s[randomInt(s.length)];
  return `${pick(caps)}${pick(letters)}${randomInt(1000, 10000)}${pick(symbols)}${pick(letters)}${pick(letters)}${pick(letters)}${pick(letters)}`;
}

interface AgencyRow {
  id: number;
  email: string | null;
  mobile: string | null;
  agency_name: string;
  contact_name: string;
  phone: string;
  city: string;
  created_at: Date;
  status: string;
  licence: string;
  trial_ends_at: Date;
  paid_until: Date | null;
  grace_days: number;
  quotes: number;
}

/** The licence's last day as YYYY-MM-DD in India time (or '' when there is no licence yet). */
function expiryDay(r: AgencyRow) {
  // The admin-set expiry date; for agencies from before the site admin existed, their old trial end.
  const end = r.paid_until ? Math.max(r.paid_until.getTime(), r.trial_ends_at.getTime()) : r.trial_ends_at.getTime();
  if (!r.paid_until && end <= r.created_at.getTime() + 60_000) return '';
  return new Date(end + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function toAgency(r: AgencyRow) {
  const end = Math.max(r.trial_ends_at.getTime(), r.paid_until ? r.paid_until.getTime() : 0);
  const graceEnd = end + Math.max(0, r.grace_days) * 86400_000;
  const now = Date.now();
  const state =
    r.status === 'pending' ? 'Waiting for activation'
    : r.status === 'suspended' ? 'Suspended'
    : now <= end ? 'Active'
    : now <= graceEnd ? 'In grace period'
    : 'Expired';
  return {
    id: r.id,
    email: r.email ?? '',
    mobile: r.mobile ?? '',
    agencyName: r.agency_name,
    contactName: r.contact_name,
    phone: r.phone,
    city: r.city,
    joined: r.created_at.toISOString(),
    status: r.status,
    licence: r.licence,
    expiresOn: expiryDay(r),
    graceDays: r.grace_days,
    quotes: r.quotes,
    state,
  };
}

export async function handleSiteAdminApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/site-admin/')) return false;
  const route = `${req.method} ${url.pathname.replace(/\/\d+(?=\/|$)/, '/:id')}`;
  try {
    try {
      await migrate();
    } catch {
      throw new HttpError(503, 'Database not available. Please try again in a minute.');
    }
    switch (route) {
      case 'GET /api/site-admin/status': {
        const setupNeeded = !(await adminExists());
        if (setupNeeded) await ensureSetupCode();
        send(res, 200, { username: SITE_ADMIN_USER, mobile: SITE_ADMIN_MOBILE, setupNeeded, loggedIn: await loggedIn(req) });
        return true;
      }

      case 'POST /api/site-admin/setup': {
        const ip = clientIp(req);
        if (tooManyFailures(`admin:${ip}`)) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes.');
        if (await adminExists()) throw new HttpError(409, 'The site admin password is already set. Please log in.');
        await ensureSetupCode();
        const body = await readJson(req);
        if (!setupCode || typeof body.code !== 'string' || body.code.trim().toUpperCase() !== setupCode.toUpperCase()) {
          recordFailure(`admin:${ip}`);
          throw new HttpError(403, 'Wrong setup code. It is printed in the server log when the server starts.');
        }
        const pw = checkPassword(body.password);
        await exec('INSERT INTO site_admins (username, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING', [SITE_ADMIN_USER, hashPassword(pw)]);
        setupCode = null;
        await createAdminSession(req, res);
        send(res, 201, { ok: true });
        return true;
      }

      case 'POST /api/site-admin/login': {
        const ip = clientIp(req);
        if (tooManyFailures(`admin:${ip}`)) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes.');
        const body = await readJson(req);
        const row = await one<{ password_hash: string }>('SELECT password_hash FROM site_admins WHERE username = $1', [SITE_ADMIN_USER]);
        const ok =
          row && normalizeMobile(body.mobile) === SITE_ADMIN_MOBILE && typeof body.password === 'string' && verifyPassword(body.password, row.password_hash);
        if (!ok) {
          recordFailure(`admin:${ip}`);
          throw new HttpError(401, 'Wrong mobile number or password');
        }
        await createAdminSession(req, res);
        send(res, 200, { ok: true });
        return true;
      }

      case 'POST /api/site-admin/logout': {
        const token = readToken(req);
        if (token) await exec('DELETE FROM admin_sessions WHERE token_hash = $1', [sha256(token)]);
        res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
        send(res, 200, { ok: true });
        return true;
      }

      case 'POST /api/site-admin/password': {
        await requireAdmin(req);
        const body = await readJson(req);
        const row = await one<{ password_hash: string }>('SELECT password_hash FROM site_admins WHERE username = $1', [SITE_ADMIN_USER]);
        if (!row || typeof body.currentPassword !== 'string' || !verifyPassword(body.currentPassword, row.password_hash)) {
          throw new HttpError(400, 'Current password is wrong');
        }
        await exec('UPDATE site_admins SET password_hash = $1 WHERE username = $2', [hashPassword(checkPassword(body.newPassword)), SITE_ADMIN_USER]);
        send(res, 200, { ok: true });
        return true;
      }

      case 'GET /api/site-admin/agencies': {
        await requireAdmin(req);
        const rows = await many<AgencyRow>(
          `SELECT a.id, a.email, a.mobile, a.agency_name, a.contact_name, a.phone, a.city, a.created_at, a.status, a.licence,
                  a.trial_ends_at, a.paid_until, a.grace_days,
                  (SELECT count(*)::int FROM quotes q WHERE q.agent_id = a.id) AS quotes
           FROM agents a
           ORDER BY (a.status = 'pending') DESC, a.created_at DESC`,
        );
        send(res, 200, rows.map(toAgency));
        return true;
      }

      case 'POST /api/site-admin/agencies/:id/reset-password': {
        // Either the password rexl typed, or a temporary one (shown once to rexl). The agency is logged out
        // everywhere and should change it after logging in (Account → Change password).
        await requireAdmin(req);
        const id = Number(url.pathname.split('/')[4]);
        const body = await readJson(req);
        const chosen = typeof body.password === 'string' && body.password ? body.password : '';
        const password = chosen ? checkPassword(chosen) : temporaryPassword();
        const changed = await exec('UPDATE agents SET password_hash = $1 WHERE id = $2', [hashPassword(password), id]);
        if (!changed) throw new HttpError(404, 'Agency not found');
        await exec('DELETE FROM sessions WHERE agent_id = $1', [id]);
        send(res, 200, { password });
        return true;
      }

      case 'PUT /api/site-admin/agencies/:id': {
        await requireAdmin(req);
        const id = Number(url.pathname.split('/').pop());
        const body = await readJson(req);
        const status = String(body.status ?? '');
        if (!STATUSES.includes(status)) throw new HttpError(400, 'Status must be pending, active or suspended');
        const licence = typeof body.licence === 'string' ? body.licence.trim().slice(0, 60) : '';
        const graceDays = Number(body.graceDays ?? 0);
        if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 365) throw new HttpError(400, 'Grace period must be 0–365 days');
        const expiresOn = typeof body.expiresOn === 'string' ? body.expiresOn.trim() : '';
        if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new HttpError(400, 'Expiry date must be a date');
        if (status === 'active' && !expiresOn) throw new HttpError(400, 'Set an expiry date to activate the agency');
        const mobile = normalizeMobile(body.mobile);
        if (!mobile) throw new HttpError(400, 'Login mobile must be a valid 10-digit mobile number');
        if (await one('SELECT 1 FROM agents WHERE mobile = $1 AND id <> $2', [mobile, id])) throw new HttpError(409, 'Another agency already uses this mobile number');
        // The licence runs to the end of the expiry day (India time). Setting it replaces any old free trial, so the
        // trial end is moved before the expiry date (the licence end is the later of the two).
        const changed = await exec(
          `UPDATE agents SET status = $1, licence = $2, grace_days = $3, mobile = $6,
             paid_until = CASE WHEN $4 = '' THEN NULL ELSE ($4 || 'T23:59:59+05:30')::timestamptz END,
             trial_ends_at = LEAST(
               trial_ends_at, created_at,
               CASE WHEN $4 = '' THEN created_at ELSE ($4 || 'T00:00:00+05:30')::timestamptz END
             )
           WHERE id = $5`,
          [status, licence, graceDays, expiresOn, id, mobile],
        );
        if (!changed) throw new HttpError(404, 'Agency not found');
        const row = await one<AgencyRow>(
          `SELECT a.id, a.email, a.mobile, a.agency_name, a.contact_name, a.phone, a.city, a.created_at, a.status, a.licence,
                  a.trial_ends_at, a.paid_until, a.grace_days,
                  (SELECT count(*)::int FROM quotes q WHERE q.agent_id = a.id) AS quotes
           FROM agents a WHERE a.id = $1`,
          [id],
        );
        send(res, 200, toAgency(row!));
        return true;
      }

      default:
        send(res, 404, { error: 'not found' });
        return true;
    }
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, { error: err.message });
    else {
      console.error('site admin:', err);
      send(res, 500, { error: 'Something went wrong' });
    }
    return true;
  }
}
