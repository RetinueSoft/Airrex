// One-time copy of the old SQLite database (.data/airrex.db) into PostgreSQL.
//   npm run import-sqlite                 uses .data/airrex.db
//   npm run import-sqlite -- <path.db>    another file
//   add --replace to empty the Postgres tables first (otherwise it refuses if agents already exist)
//
// Keeps ids, so links like /agent/quotes/11 keep working, and keeps unexpired logins.

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { migrate, pool, tx } from '../db.ts';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const file = args.find((a) => !a.startsWith('--')) ?? join(import.meta.dirname, '..', '..', '.data', 'airrex.db');

type Row = Record<string, unknown>;
const date = (v: unknown) => (v ? new Date(String(v)) : null);

async function main() {
  if (!existsSync(file)) throw new Error(`SQLite file not found: ${file}`);
  const src = new DatabaseSync(file, { readOnly: true });
  const cols = (t: string) => (src.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  const agentCols = cols('agents');
  const quoteCols = cols('quotes');

  const agents = src.prepare('SELECT * FROM agents ORDER BY id').all() as Row[];
  const sessions = src.prepare('SELECT * FROM sessions').all() as Row[];
  const quotes = src.prepare('SELECT * FROM quotes ORDER BY id').all() as Row[];
  src.close();

  await migrate();
  const counts = await tx(async (c) => {
    const existing = (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM agents')).rows[0].n;
    if (existing > 0 && !replace) {
      throw new Error(`PostgreSQL already has ${existing} agent(s). Run again with --replace to overwrite them.`);
    }
    if (replace) await c.query('TRUNCATE quotes, sessions, agents RESTART IDENTITY CASCADE');

    for (const a of agents) {
      await c.query(
        `INSERT INTO agents (id, email, password_hash, contact_name, agency_name, phone, whatsapp, address, city, gstin,
           website, logo, brand_color, ticket_footer, default_markup, gst_on_charge, payment_fees, created_at, trial_ends_at, paid_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20)`,
        [
          a.id, a.email, a.password_hash, a.contact_name, a.agency_name, a.phone, a.whatsapp, a.address, a.city, a.gstin,
          a.website, a.logo, a.brand_color, a.ticket_footer, a.default_markup,
          agentCols.includes('gst_on_charge') ? Number(a.gst_on_charge) === 1 : false,
          agentCols.includes('payment_fees') ? String(a.payment_fees || '{}') : '{}',
          date(a.created_at), date(a.trial_ends_at), date(a.paid_until),
        ],
      );
    }

    let keptSessions = 0;
    for (const s of sessions) {
      if (new Date(String(s.expires_at)).getTime() < Date.now()) continue; // skip expired logins
      await c.query('INSERT INTO sessions (token_hash, agent_id, expires_at) VALUES ($1, $2, $3)', [s.token_hash, s.agent_id, date(s.expires_at)]);
      keptSessions++;
    }

    for (const q of quotes) {
      await c.query(
        `INSERT INTO quotes (id, agent_id, customer_name, customer_phone, data, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
        [
          q.id, q.agent_id, q.customer_name, q.customer_phone, String(q.data),
          quoteCols.includes('status') && q.status === 'draft' ? 'draft' : 'sent',
          date(q.created_at),
          quoteCols.includes('updated_at') ? date(q.updated_at) : null,
        ],
      );
    }

    // New rows continue after the copied ids.
    for (const t of ['agents', 'quotes']) {
      await c.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM ${t}), 1), (SELECT count(*) > 0 FROM ${t}))`);
    }
    return { agents: agents.length, sessions: keptSessions, quotes: quotes.length };
  });

  console.log(`Copied from ${file}: ${counts.agents} agent(s), ${counts.quotes} quote(s), ${counts.sessions} active login(s).`);
  console.log('The SQLite file was not changed. Keep it as a backup until you have checked the app.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
