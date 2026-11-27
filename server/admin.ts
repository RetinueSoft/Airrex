// Admin commands for agent subscriptions. Run from the project folder:
//   npm run admin -- list
//   npm run admin -- extend <email> <days>      e.g. after an agent pays for a month: extend a@b.com 30
//   npm run admin -- expire <email>             end trial/subscription now
//   npm run admin -- delete <email>             remove the agent and their saved quotes
//   npm run admin -- reset-password <email>     prints a new temporary password
// On the server (Docker): app-compose airrex exec app node server/admin.ts list

import { randomBytes } from 'node:crypto';
import { exec, migrate, one, many, pool, type AgentRow } from './db.ts';
import { hashPassword } from './auth.ts';

const [cmd, email, arg] = process.argv.slice(2);

async function find(e: string | undefined) {
  if (!e) throw new Error('Give the agent email');
  const a = await one<AgentRow>('SELECT * FROM agents WHERE lower(email) = lower($1)', [e]);
  if (!a) throw new Error(`No agent with email ${e}`);
  return a;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '-');

async function main() {
  await migrate();
  switch (cmd) {
    case 'list': {
      const rows = await many<AgentRow & { quotes: number }>(
        'SELECT a.*, (SELECT count(*)::int FROM quotes q WHERE q.agent_id = a.id) AS quotes FROM agents a ORDER BY a.created_at',
      );
      const now = Date.now();
      console.table(
        rows.map((a) => ({
          email: a.email,
          agency: a.agency_name,
          city: a.city,
          phone: a.phone,
          joined: day(a.created_at),
          trialEnds: day(a.trial_ends_at),
          paidUntil: day(a.paid_until),
          quotes: a.quotes,
          status: a.trial_ends_at.getTime() > now ? 'trial' : a.paid_until && a.paid_until.getTime() > now ? 'paid' : 'EXPIRED',
        })),
      );
      break;
    }
    case 'extend': {
      const a = await find(email);
      const days = Number(arg);
      if (!Number.isInteger(days) || days <= 0) throw new Error('Days must be a positive whole number');
      // Extend from whichever is later: today, end of trial, or current paid date.
      const base = Math.max(Date.now(), a.trial_ends_at.getTime(), a.paid_until ? a.paid_until.getTime() : 0);
      const until = new Date(base + days * 86400_000);
      await exec('UPDATE agents SET paid_until = $1 WHERE id = $2', [until, a.id]);
      console.log(`${a.email} (${a.agency_name}) paid until ${day(until)}`);
      break;
    }
    case 'expire': {
      const a = await find(email);
      await exec(`UPDATE agents SET trial_ends_at = now() - interval '1 second', paid_until = NULL WHERE id = $1`, [a.id]);
      console.log(`${a.email} subscription ended`);
      break;
    }
    case 'delete': {
      const a = await find(email);
      await exec('DELETE FROM agents WHERE id = $1', [a.id]); // sessions and quotes go with it (ON DELETE CASCADE)
      console.log(`Deleted ${a.email} and their quotes`);
      break;
    }
    case 'reset-password': {
      const a = await find(email);
      const temp = randomBytes(6).toString('base64url');
      await exec('UPDATE agents SET password_hash = $1 WHERE id = $2', [hashPassword(temp), a.id]);
      await exec('DELETE FROM sessions WHERE agent_id = $1', [a.id]);
      console.log(`Temporary password for ${a.email}: ${temp}\nAsk them to change it in Agent → Account.`);
      break;
    }
    default:
      console.log('Commands: list | extend <email> <days> | expire <email> | delete <email> | reset-password <email>');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
