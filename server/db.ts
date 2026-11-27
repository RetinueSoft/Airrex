// SQLite database (Node's built-in node:sqlite) for agent accounts, sessions and saved quotes.
// File: .data/airrex.db (git-ignored). Back it up: it holds your customers' accounts.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.DATA_DIR ?? join(import.meta.dirname, '..', '.data');
mkdirSync(DIR, { recursive: true });

export const db = new DatabaseSync(join(DIR, 'airrex.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS agents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT NOT NULL,
    contact_name    TEXT NOT NULL DEFAULT '',
    agency_name     TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL DEFAULT '',
    whatsapp        TEXT NOT NULL DEFAULT '',
    address         TEXT NOT NULL DEFAULT '',
    city            TEXT NOT NULL DEFAULT '',
    gstin           TEXT NOT NULL DEFAULT '',
    website         TEXT NOT NULL DEFAULT '',
    logo            TEXT NOT NULL DEFAULT '',      -- data: URL, small image
    brand_color     TEXT NOT NULL DEFAULT '#0A1C34',
    ticket_footer   TEXT NOT NULL DEFAULT '',
    default_markup  INTEGER NOT NULL DEFAULT 0,    -- service charge per passenger, INR
    created_at      TEXT NOT NULL,
    trial_ends_at   TEXT NOT NULL,
    paid_until      TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    agent_id    INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id        INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    customer_name   TEXT NOT NULL DEFAULT '',
    customer_phone  TEXT NOT NULL DEFAULT '',
    data            TEXT NOT NULL,                 -- JSON: query, flights, markup
    created_at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS quotes_agent ON quotes(agent_id, created_at DESC);
`);

// Migrations for databases created by older versions.
const agentColumns = (db.prepare('PRAGMA table_info(agents)').all() as { name: string }[]).map((c) => c.name);
if (!agentColumns.includes('gst_on_charge')) {
  db.exec('ALTER TABLE agents ADD COLUMN gst_on_charge INTEGER NOT NULL DEFAULT 0');
}
if (!agentColumns.includes('payment_fees')) {
  // JSON: { "default": 350, "6E": 400, ... } INR per passenger per flight leg
  db.exec(`ALTER TABLE agents ADD COLUMN payment_fees TEXT NOT NULL DEFAULT '{}'`);
}

const quoteColumns = (db.prepare('PRAGMA table_info(quotes)').all() as { name: string }[]).map((c) => c.name);
if (!quoteColumns.includes('status')) {
  // 'draft' = built but not sent yet, 'sent' = sent on WhatsApp / copied. Older quotes were all sent.
  db.exec(`ALTER TABLE quotes ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'`);
}
if (!quoteColumns.includes('updated_at')) {
  db.exec('ALTER TABLE quotes ADD COLUMN updated_at TEXT');
}

export interface AgentRow {
  id: number;
  email: string;
  password_hash: string;
  contact_name: string;
  agency_name: string;
  phone: string;
  whatsapp: string;
  address: string;
  city: string;
  gstin: string;
  website: string;
  logo: string;
  brand_color: string;
  ticket_footer: string;
  default_markup: number;
  gst_on_charge: number; // 1 = add 18% GST on the agency service charge
  payment_fees: string; // JSON map of airline code (or "default") -> INR per passenger per leg
  created_at: string;
  trial_ends_at: string;
  paid_until: string | null;
}
