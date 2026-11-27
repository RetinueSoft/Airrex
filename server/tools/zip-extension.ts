// Packs the AirRex Helper browser extension (extension/) into public/airrex-helper.zip, which the site offers
// for download on /helper. Runs as part of `npm run build` (and `npm run build:extension`).
// Minimal ZIP writer (stored, no compression) so no extra dependency is needed.
//
// AIRREX_SITE_URL (e.g. https://airrex.example.com): the live AirRex address. It is added to the packed
// manifest so the helper also works there; without it the helper only recognises AirRex on localhost.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'extension');
const OUT_DIR = join(ROOT, 'public');
const OUT = join(OUT_DIR, 'airrex-helper.zip');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const locals: Buffer[] = [];
const centrals: Buffer[] = [];
let offset = 0;
const list = files(SRC).sort();
const siteUrl = process.env.AIRREX_SITE_URL?.trim();
let siteOrigin = '';
if (siteUrl) {
  const u = new URL(siteUrl);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error('AIRREX_SITE_URL must be https://');
  siteOrigin = u.origin;
}

/** File contents; the manifest gets the live AirRex address added when AIRREX_SITE_URL is set. */
function contents(file: string): Buffer {
  const data = readFileSync(file);
  if (!siteOrigin || !file.endsWith('manifest.json')) return data;
  const m = JSON.parse(data.toString('utf8'));
  const pattern = `${siteOrigin}/*`;
  if (!m.host_permissions.includes(pattern)) m.host_permissions.unshift(pattern);
  if (!m.content_scripts[0].matches.includes(pattern)) m.content_scripts[0].matches.unshift(pattern);
  return Buffer.from(JSON.stringify(m, null, 2), 'utf8');
}

for (const file of list) {
  // Inside a folder, so "Load unpacked" can point at the extracted airrex-helper folder.
  const name = Buffer.from(`airrex-helper/${relative(SRC, file).replace(/\\/g, '/')}`, 'utf8');
  const data = contents(file);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt32LE(0, 10); // time/date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, data);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);
  offset += local.length + name.length + data.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(list.length, 8);
end.writeUInt16LE(list.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, Buffer.concat([...locals, ...centrals, end]));
const version = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8')).version;
console.log(
  `AirRex Helper ${version}: ${list.length} files -> public/airrex-helper.zip` +
    (siteOrigin ? ` (site ${siteOrigin})` : ' (localhost only; set AIRREX_SITE_URL for the live site)'),
);
