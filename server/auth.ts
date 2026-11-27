// Agent authentication: scrypt password hashes, random session tokens in an HttpOnly cookie
// (only a SHA-256 of the token is stored), and a simple login rate limit.

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, type AgentRow } from './db.ts';

const COOKIE = 'airrex_session';
const SESSION_DAYS = 30;
export const TRIAL_DAYS = Number(process.env.AGENT_TRIAL_DAYS ?? 30);

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

// Set TRUST_PROXY=true only when running behind a reverse proxy (nginx, Render, Railway…) that sets
// X-Forwarded-* headers. Otherwise anyone could fake their IP and dodge the login rate limit.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

function isHttps(req: IncomingMessage) {
  return (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') || process.env.NODE_ENV === 'production';
}

export function createSession(req: IncomingMessage, res: ServerResponse, agentId: number) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare('INSERT INTO sessions (token_hash, agent_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), agentId, expires.toISOString());
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function readToken(req: IncomingMessage) {
  const cookie = req.headers.cookie ?? '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  return m?.[1];
}

export function destroySession(req: IncomingMessage, res: ServerResponse) {
  const token = readToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function currentAgent(req: IncomingMessage): AgentRow | undefined {
  const token = readToken(req);
  if (!token) return undefined;
  const row = db
    .prepare('SELECT a.* FROM sessions s JOIN agents a ON a.id = s.agent_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .get(sha256(token), new Date().toISOString()) as AgentRow | undefined;
  return row;
}

/** Trial or paid subscription still running. */
export function subscriptionActive(a: AgentRow) {
  const now = new Date().toISOString();
  return a.trial_ends_at > now || (a.paid_until !== null && a.paid_until > now);
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

// Remove expired sessions once an hour.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()), 3600_000).unref();
