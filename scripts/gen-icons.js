/*!
 * FocusBot icon generator — pure Node.js, zero dependencies.
 * Generates 16x16, 32x32, 48x48, 128x128 PNG icons with brand gradient circle.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'client', 'icons');

mkdirSync(ICONS_DIR, { recursive: true });

/* ---- PNG helpers (raw, no deps) ---- */
const u32be = (v) => Buffer.from([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);

function crc32(buf) {
  let c = 0xffffffff;
  const table = crc32._table;
  if (!table) {
    crc32._table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let x = n;
      for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
      crc32._table[n] = x;
    }
  }
  for (let i = 0; i < buf.length; i++) c = crc32._table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32be(data.length), typeData, u32be(crc32(typeData))]);
}

/* ---- Color helpers ---- */
function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

/* ---- Icon renderer: gradient circle ---- */
const COLOR_A = hexToRgb('#38bdf8'); // sky blue
const COLOR_B = hexToRgb('#818cf8'); // indigo

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4); // RGBA
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;
  const innerRadius = radius * 0.55; // for FB letterform cutout effect

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // Gradient: top-left (COLOR_A) to bottom-right (COLOR_B)
        const t = (dx / size + dy / size + 1) / 2; // 0..1
        const r = lerp(COLOR_A[0], COLOR_B[0], Math.min(1, Math.max(0, t)));
        const g = lerp(COLOR_A[1], COLOR_B[1], Math.min(1, Math.max(0, t)));
        const b = lerp(COLOR_A[2], COLOR_B[2], Math.min(1, Math.max(0, t)));

        // Anti-alias the edge
        const edgeFade = dist > radius - 0.5 ? Math.max(0, radius - dist + 0.5) : 1;

        // Simple "FB" letterform: vertical bars for F and B
        const nx = (x - cx) / radius; // -1..1
        const ny = (y - cy) / radius; // -1..1
        const letterAlpha = drawFB(nx, ny, size);

        const alpha = Math.round(edgeFade * (1 - letterAlpha * 0.35) * 255);
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = alpha;
      } else if (dist <= radius + 0.5) {
        // Anti-alias edge
        const fade = Math.max(0, radius + 0.5 - dist);
        const t = (dx / size + dy / size + 1) / 2;
        const r = lerp(COLOR_A[0], COLOR_B[0], Math.min(1, Math.max(0, t)));
        const g = lerp(COLOR_A[1], COLOR_B[1], Math.min(1, Math.max(0, t)));
        const b = lerp(COLOR_A[2], COLOR_B[2], Math.min(1, Math.max(0, t)));
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = Math.round(fade * 255);
      } else {
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
      }
    }
  }
  return pixels;
}

/** Draw "FB" letterform as alpha overlay (0=white, 1=dark) */
function drawFB(nx, ny, size) {
  const s = size >= 48 ? 1 : 0.5;
  // F
  const fX = nx + 0.35;
  const fY = ny;
  const inFVert = fX > -0.06 * s && fX < 0.06 * s && fY > -0.3 && fY < 0.3;
  const inFTop = fX > -0.06 * s && fX < 0.18 * s && fY > -0.3 && fY < -0.2;
  const inFMid = fX > -0.06 * s && fX < 0.12 * s && fY > -0.02 * s && fY < 0.02 * s;
  const inF = inFVert || inFTop || inFMid;

  // B
  const bX = nx - 0.15;
  const bY = ny;
  const inBVert = bX > -0.06 * s && bX < 0.0 && bY > -0.3 && bY < 0.3;
  const inBTop = bX >= 0.0 && bX < 0.14 * s && bY > -0.3 && bY < -0.02 * s &&
    bX < 0.14 * s * (1 - Math.pow((bY + 0.16) / 0.14, 2));
  const inBBot = bX >= 0.0 && bX < 0.16 * s && bY > 0.0 && bY < 0.3 &&
    bX < 0.16 * s * (1 - Math.pow((bY - 0.15) / 0.15, 2));
  const inB = inBVert || inBTop || inBBot;

  return (inF || inB) ? 1 : 0;
}

/* ---- Generate all sizes ---- */
for (const size of [16, 32, 48, 128]) {
  const pixels = renderIcon(size);

  // Build raw scanlines (filter byte 0 = None per row)
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: None
    pixels.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const compressed = deflateSync(raw);

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  const outPath = join(ICONS_DIR, `${size}x${size}.png`);
  writeFileSync(outPath, png);
  console.log(`[gen-icons] ${size}x${size}.png → ${png.length} bytes`);
}

console.log('[gen-icons] Done — all icons generated.');
