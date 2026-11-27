// Admin commands for agent subscriptions. Run from the project folder:
//   npm run admin -- list
//   npm run admin -- extend <email> <days>      e.g. after an agent pays for a month: extend a@b.com 30
//   npm run admin -- expire <email>             end trial/subscription now
//   npm run admin -- delete <email>             remove the agent and their saved quotes
//   npm run admin -- reset-password <email>     prints a new temporary password

import { randomBytes } from 'node:crypto';
import { db, type AgentRow } from './db.ts';
import { hashPassword } from './auth.ts';

const [cmd, email, arg] = process.argv.slice(2);

function find(e: string | undefined) {
  if (!e) throw new Error('Give the agent email');
  const a = db.prepare('SELECT * FROM agents WHERE email = ?').get(e.toLowerCase()) as AgentRow | undefined;
  if (!a) throw new Error(`No agent with email ${e}`);
  return a;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '-');

try {
  switch (cmd) {
    case 'list': {
      const rows = db.prepare('SELECT * FROM agents ORDER BY created_at').all() as unknown as AgentRow[];
      const now = new Date().toISOString();
      console.table(
        rows.map((a) => ({
          email: a.email,
          agency: a.agency_name,
          city: a.city,
          phone: a.phone,
          joined: day(a.created_at),
          trialEnds: day(a.trial_ends_at),
          paidUntil: day(a.paid_until),
          status: a.trial_ends_at > now ? 'trial' : a.paid_until && a.paid_until > now ? 'paid' : 'EXPIRED',
        })),
      );
      break;
    }
    case 'extend': {
      const a = find(email);
      const days = Number(arg);
      if (!Number.isInteger(days) || days <= 0) throw new Error('Days must be a positive whole number');
      // Extend from whichever is later: today, end of trial, or current paid date.
      const base = Math.max(Date.now(), Date.parse(a.trial_ends_at), a.paid_until ? Date.parse(a.paid_until) : 0);
      const until = new Date(base + days * 86400_000).toISOString();
      db.prepare('UPDATE agents SET paid_until = ? WHERE id = ?').run(until, a.id);
      console.log(`${a.email} (${a.agency_name}) paid until ${day(until)}`);
      break;
    }
    case 'expire': {
      const a = find(email);
      const past = new Date(Date.now() - 1000).toISOString();
      db.prepare('UPDATE agents SET trial_ends_at = ?, paid_until = NULL WHERE id = ?').run(past, a.id);
      console.log(`${a.email} subscription ended`);
      break;
    }
    case 'delete': {
      const a = find(email);
      db.prepare('DELETE FROM agents WHERE id = ?').run(a.id);
      console.log(`Deleted ${a.email} and their quotes`);
      break;
    }
    case 'reset-password': {
      const a = find(email);
      const temp = randomBytes(6).toString('base64url');
      db.prepare('UPDATE agents SET password_hash = ? WHERE id = ?').run(hashPassword(temp), a.id);
      db.prepare('DELETE FROM sessions WHERE agent_id = ?').run(a.id);
      console.log(`Temporary password for ${a.email}: ${temp}\nAsk them to change it in Agent → Account.`);
      break;
    }
    default:
      console.log('Commands: list | extend <email> <days> | expire <email> | delete <email> | reset-password <email>');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
