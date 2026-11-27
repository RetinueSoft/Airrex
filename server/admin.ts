// Admin commands for agent subscriptions. Run from the project folder:
//   npm run admin -- list
//   (Activating agencies and setting licence, expiry date and grace period: the site admin page /site-admin.)
//   npm run admin -- extend <mobile> <days>      e.g. after an agent pays for a month: extend 9876543210 30
//   npm run admin -- expire <mobile>             end trial/subscription now
//   npm run admin -- delete <mobile>             remove the agent and their saved quotes
//   npm run admin -- reset-password <mobile>     prints a new temporary password
//   npm run admin -- reports [days]             "What did you pay?" reports (default last 30 days)
//   npm run admin -- captures [days]            prices the AirRex Helper recorded on airline pages
//   npm run admin -- capture <id>               every line of one recorded page
// On the server (Docker): app-compose airrex exec app node server/admin.ts list

import { normalizeMobile } from '../shared/mobile.ts';
import { randomBytes } from 'node:crypto';
import { exec, migrate, one, many, pool, type AgentRow } from './db.ts';
import { hashPassword, licenceEnd, subscriptionActive } from './auth.ts';

const [cmd, email, arg] = process.argv.slice(2);

async function find(e: string | undefined) {
  if (!e) throw new Error('Give the agency mobile number (or email)');
  const a = await one<AgentRow>('SELECT * FROM agents WHERE mobile = $1 OR lower(email) = lower($2)', [normalizeMobile(e) || '-', e]);
  if (!a) throw new Error(`No agency with mobile number or email ${e}`);
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
          mobile: a.mobile ?? '-',
          email: a.email ?? '-',
          agency: a.agency_name,
          phone: a.phone,
          joined: day(a.created_at),
          status: a.status,
          licence: a.licence || '-',
          expires: day(licenceEnd(a)),
          grace: a.grace_days,
          quotes: a.quotes,
          access: a.status !== 'active' ? a.status.toUpperCase() : subscriptionActive(a) ? (now > licenceEnd(a).getTime() ? 'in grace' : 'yes') : 'EXPIRED',
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
      console.log(`${a.mobile ?? a.email} (${a.agency_name}) paid until ${day(until)}`);
      break;
    }
    case 'expire': {
      const a = await find(email);
      await exec(`UPDATE agents SET trial_ends_at = now() - interval '1 second', paid_until = NULL WHERE id = $1`, [a.id]);
      console.log(`${a.mobile ?? a.email} subscription ended`);
      break;
    }
    case 'delete': {
      const a = await find(email);
      await exec('DELETE FROM agents WHERE id = $1', [a.id]); // sessions and quotes go with it (ON DELETE CASCADE)
      console.log(`Deleted ${a.mobile ?? a.email} and their quotes`);
      break;
    }
    case 'reset-password': {
      const a = await find(email);
      const temp = randomBytes(6).toString('base64url');
      await exec('UPDATE agents SET password_hash = $1 WHERE id = $2', [hashPassword(temp), a.id]);
      await exec('DELETE FROM sessions WHERE agent_id = $1', [a.id]);
      console.log(`Temporary password for ${a.mobile ?? a.email}: ${temp}\nAsk them to change it in Agent → Account.`);
      break;
    }
    case 'reports': {
      const days = Math.max(1, Number(email) || 30);
      type Row = {
        airline_code: string; n: number; avg_diff_pp: number; bag_reports: number; avg_bag_cost: number | null; avg_fee: number | null;
      };
      const summary = await many<Row>(
        `SELECT airline_code, count(*)::int AS n,
                round(avg((paid_total - shown_total)::numeric / adults))::int AS avg_diff_pp,
                count(bag_cost)::int AS bag_reports,
                round(avg(bag_cost))::int AS avg_bag_cost,
                round(avg(airline_fee))::int AS avg_fee
         FROM fare_reports WHERE created_at > now() - make_interval(days => $1)
         GROUP BY airline_code ORDER BY n DESC`,
        [days],
      );
      console.log(`Fare reports, last ${days} days (per airline):`);
      console.table(summary.map((r) => ({
        airline: r.airline_code, reports: r.n, 'paid − shown per person (avg ₹)': r.avg_diff_pp,
        'bag reports': r.bag_reports, 'avg bag cost ₹': r.avg_bag_cost ?? '-', 'avg airline fee ₹': r.avg_fee ?? '-',
      })));
      const latest = await many<Record<string, unknown>>(
        `SELECT to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS reported, origin || '-' || destination AS route, travel_date::text AS date, adults,
                airline_code AS airline, flight_numbers AS flights, shown_total AS shown, paid_total AS paid, fare_type,
                bag_kg, bag_cost, airline_fee, other_fees, notes
         FROM fare_reports WHERE created_at > now() - make_interval(days => $1) ORDER BY created_at DESC LIMIT 25`,
        [days],
      );
      console.log('Latest 25:');
      console.table(latest);
      break;
    }
    case 'captures': {
      const days = Math.max(1, Number(email) || 7);
      const rows = await many<Record<string, unknown>>(
        `SELECT id, to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'MM-DD HH24:MI') AS at, airline_code AS airline,
                origin || '-' || destination AS route, travel_date::text AS date, adults, shown_total AS shown,
                host, left(coalesce(nullif(heading, ''), title), 40) AS page, payment_page AS payment, jsonb_array_length(lines) AS lines,
                (SELECT max((l->>'amount')::int) FROM jsonb_array_elements(lines) l
                  WHERE l->>'text' ~* '(total|grand|to pay|you pay|amount payable)') AS total_on_page
         FROM page_captures WHERE created_at > now() - make_interval(days => $1)
         ORDER BY created_at DESC LIMIT 50`,
        [days],
      );
      console.log(`Pages recorded by AirRex Helper, last ${days} days (newest 50). "total_on_page" = largest amount on a Total line.`);
      console.table(rows);
      console.log('Show all lines of one page: npm run admin -- capture <id>');
      break;
    }
    case 'capture': {
      const row = await one<{ host: string; path: string; title: string; heading: string; lines: { text: string; amount: number | null }[]; shown_total: number }>(
        'SELECT host, path, title, heading, lines, shown_total FROM page_captures WHERE id = $1',
        [Number(email)],
      );
      if (!row) throw new Error(`No capture ${email}`);
      console.log(`${row.host}${row.path} · ${row.heading || row.title} · AirRex showed ₹${row.shown_total}`);
      console.table(row.lines);
      break;
    }
    default:
      console.log('Commands: list | extend <mobile> <days> | expire <mobile> | delete <mobile> | reset-password <mobile> | reports [days] | captures [days] | capture <id>');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
