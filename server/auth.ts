// Agent authentication: scrypt password hashes, random session tokens in an HttpOnly cookie
// (only a SHA-256 of the token is stored), and a simple login rate limit.

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { exec, one, type AgentRow } from './db.ts';

const COOKIE = 'airrex_session';
const SESSION_DAYS = 30;
export const TRIAL_DAYS = Number(process.env.AGENT_TRIAL_DAYS ?? 30);

// Set TRUST_PROXY=true only when running behind a reverse proxy (Caddy, nginx…) that sets
// X-Forwarded-* headers. Otherwise anyone could fake their IP and dodge the login rate limit.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

function isHttps(req: IncomingMessage) {
  return (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') || process.env.NODE_ENV === 'production';
}

export async function createSession(req: IncomingMessage, res: ServerResponse, agentId: number) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await exec('INSERT INTO sessions (token_hash, agent_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), agentId, expires]);
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function readToken(req: IncomingMessage) {
  const cookie = req.headers.cookie ?? '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  return m?.[1];
}

export async function destroySession(req: IncomingMessage, res: ServerResponse) {
  const token = readToken(req);
  if (token) await exec('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function currentAgent(req: IncomingMessage): Promise<AgentRow | undefined> {
  const token = readToken(req);
  if (!token) return undefined;
  return one<AgentRow>(
    'SELECT a.* FROM sessions s JOIN agents a ON a.id = s.agent_id WHERE s.token_hash = $1 AND s.expires_at > now()',
    [sha256(token)],
  );
}

/** Trial or paid subscription still running. */
export function subscriptionActive(a: AgentRow) {
  const now = Date.now();
  return a.trial_ends_at.getTime() > now || (a.paid_until !== null && a.paid_until.getTime() > now);
}

// ---- Login rate limit: max 8 failed attempts per IP per 15 minutes -------------------------
const failures = new Map<string, number[]>();
const WINDOW = 15 * 60_000;

export function clientIp(req: IncomingMessage) {
  const forwarded = TRUST_PROXY ? req.headers['x-forwarded-for']?.toString().split(',')[0] : undefined;
  return (forwarded ?? req.socket.remoteAddress ?? '').trim();
}
export function tooManyFailures(ip: string) {
  const recent = (failures.get(ip) ?? []).filter((t) => Date.now() - t < WINDOW);
  failures.set(ip, recent);
  return recent.length >= 8;
}
export function recordFailure(ip: string) {
  failures.set(ip, [...(failures.get(ip) ?? []), Date.now()]);
}

/** Remove expired sessions once an hour (started by the server). */
export function startSessionCleanup() {
  setInterval(() => {
    exec('DELETE FROM sessions WHERE expires_at < now()').catch((e) => console.warn('session cleanup:', e.message));
    // Passport details are kept only as long as the agent chose (default 30 days).
    exec('DELETE FROM passengers WHERE delete_after < now()').catch((e) => console.warn('passenger cleanup:', e.message));
  }, 3600_000).unref();
}
