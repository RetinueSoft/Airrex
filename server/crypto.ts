// Encryption for passenger (passport) details stored in the database: AES-256-GCM with a key from
// PASSENGER_DATA_KEY (32 random bytes, base64). Without the key, saving passengers is turned off.
// Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Keep it secret and backed up: if it is lost, saved passengers can't be read (they can be re-scanned).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function loadKey(): Buffer | null {
  const raw = process.env.PASSENGER_DATA_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    console.warn('PASSENGER_DATA_KEY must be 32 bytes in base64; saving passengers is turned off.');
    return null;
  }
  return key;
}

const KEY = loadKey();

export const passengerStorageEnabled = KEY !== null;

/** Encrypt a JSON value: "v1.<iv>.<tag>.<ciphertext>" (base64 parts). */
export function encryptJson(value: unknown): string {
  if (!KEY) throw new Error('PASSENGER_DATA_KEY is not set');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function decryptJson<T>(blob: string): T {
  if (!KEY) throw new Error('PASSENGER_DATA_KEY is not set');
  const [version, iv, tag, data] = blob.split('.');
  if (version !== 'v1') throw new Error('unknown encryption version');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8'));
}
