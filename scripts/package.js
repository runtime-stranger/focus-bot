/*!
 * FocusBot release packager — zero-dependency STORED ZIP writer.
 *
 * Rebuilds the load-unpacked extension bundle `focus-bot-extension.zip`
 * from the latest `client/` sources so the artifact always matches the
 * repository. Only production store files are included — no tests, no .git,
 * no README, no node_modules.
 *
 * Usage:
 *   node scripts/package.js         (or: npm run package)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '1.3.0';
const CLIENT = join(ROOT, 'client');
const OUT = join(ROOT, 'focus-bot-extension.zip');
const OUT_STORE = join(ROOT, 'focus-bot-webstore-v' + VERSION + '.zip');
// Ready-to-load Chrome folder — select THIS path under chrome://extensions → "Load unpacked".
const DIST_EXT = join(ROOT, 'dist', 'extension');

// Production store files only — entry order matters for a deterministic archive.
const ENTRIES = [
  'manifest.json',
  'focus-bot.js',
  'focus-bot.css',
  'popup.html',
  'popup.js',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'privacy.html',
];

/* ---- CRC32 (RFC 1952 table) ---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---- DOS timestamp encoding ---- */
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); return b; };
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  const now = new Date();
  const { time, date } = dosDateTime(now);
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const size = data.length;

    // Local file header
    const local = Buffer.concat([
      u32(0x04034b50),      // signature
      u16(20),              // version needed
      u16(0),               // flags
      u16(0),               // method: stored
      u16(time), u16(date),
      u32(crc),
      u32(size), u32(size), // compressed = uncompressed (stored)
      u16(nameBuf.length), u16(0), // name len / extra len
      nameBuf,
    ]);
    localParts.push(local, data);

    // Central directory record
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),              // version made by
      u16(20),              // version needed
      u16(0), u16(0),
      u16(time), u16(date),
      u32(crc),
      u32(size), u32(size),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset),
      nameBuf,
    ]);
    centralParts.push(central);

    offset += local.length + size;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),                 // number of this disk
    u16(0),                 // disk where central directory starts
    u16(entries.length), u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0), // comment length
  ]);

  return Buffer.concat([...localParts, central, end]);
}

/* ---- Build ---- */
const missing = ENTRIES.filter((f) => !existsSync(join(CLIENT, f)));
if (missing.length) {
  console.error('[package] missing client files:', missing.join(', '));
  process.exit(1);
}

const entries = ENTRIES.map((f) => ({
  name: f,
  data: readFileSync(join(CLIENT, f)),
}));

const archive = zip(entries);
writeFileSync(OUT, archive);
writeFileSync(OUT_STORE, archive);

/* ---- Load-unpacked folder ---- */
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) copyFileSync(s, d);
  }
}

rmSync(DIST_EXT, { recursive: true, force: true });
mkdirSync(DIST_EXT, { recursive: true });
copyDir(CLIENT, join(DIST_EXT, 'client'));
// The root manifest is the single source of truth for the loadable folder and
// must sit at the TOP of dist/extension, referencing ./client/ via relative paths.
copyFileSync(join(ROOT, 'manifest.json'), join(DIST_EXT, 'manifest.json'));

const total = entries.reduce((s, e) => s + e.data.length, 0);
console.log(`[package] wrote ${OUT}`);
console.log(`[package] ・ store artifact ${OUT_STORE}`);
console.log(`[package] ${entries.length} files · ${total} bytes raw · ${archive.length} bytes archive`);
console.log(`[package] contents: ${ENTRIES.join(', ')}`);
console.log(`[package] ・ load-unpacked folder: ${resolve(DIST_EXT)}`);
console.log(`[package]   chrome://extensions → toggle "Developer mode" → "Load unpacked" → select the folder above`);
