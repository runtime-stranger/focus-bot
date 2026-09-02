/*!
 * FocusBot icon generator — pure Node.js, zero dependencies.
 * Renders the official minimalist mark: a round blue gradient disc with a
 * dark navy play triangle at its exact centre. No badge, no letters, nothing
 * extra — the same geometry as the SVG template (viewBox 0 0 128 128):
 *
 *   <circle cx="64" cy="64" r="60" fill="url(#blueGrad)"/>
 *   <polygon points="54,42 86,64 54,86" fill="#0b192c"/>
 *
 * Each size is rasterised natively with 4x supersampled anti-aliasing so the
 * 16px icon stays crisp.
 *
 * Output (client/icons/): icon-16.png, icon-32.png, icon-48.png, icon-128.png
 *
 * Usage:
 *   node scripts/gen-icons.js
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'client', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor

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

/* ---- Geometry (128 x 128 viewBox, same as the SVG template) ---- */
const VB = 128;
const CIRCLE = { cx: 64, cy: 64, r: 60 };
const TRI = { /* polygon points="54,42 86,64 54,86" */
  ax: 54, ay: 42,
  bx: 86, by: 64,
  cx: 54, cy: 86,
};

/* ---- Palette ---- */
const BLUE_A = [0x4e, 0xa8, 0xff]; // #4ea8ff (gradient top-left)
const BLUE_B = [0x7e, 0x8a, 0xff]; // #7e8aff (gradient bottom-right)
const NAVY = [0x0b, 0x19, 0x2c];   // #0b192c play triangle

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const clamp = (t) => Math.min(1, Math.max(0, t));

/** Point-in-triangle (same winding convention as SVG polygon). */
function inTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Sample one fine subsample (viewBox coordinates); returns [r, g, b, a]. */
function sample(u, v) {
  const dx = u - CIRCLE.cx, dy = v - CIRCLE.cy;
  const d = Math.hypot(dx, dy);
  if (d > CIRCLE.r) return [0, 0, 0, 0]; // outside the disc → transparent

  // Play triangle sits on top of the gradient
  if (inTriangle(u, v, TRI.ax, TRI.ay, TRI.bx, TRI.by, TRI.cx, TRI.cy)) {
    return [...NAVY, 255];
  }

  // Round blue gradient disc, top-left → bottom-right
  const t = clamp((u + v) / (2 * CIRCLE.cx));
  return [lerp(BLUE_A[0], BLUE_B[0], t), lerp(BLUE_A[1], BLUE_B[1], t), lerp(BLUE_A[2], BLUE_B[2], t), 255];
}

/* ---- Render one size (4x supersampled AA) ---- */
function renderIcon(size) {
  const scale = size / VB;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const vbx = (x + (sx + 0.5) / SS) / scale;
          const vby = (y + (sy + 0.5) / SS) / scale;
          const c = sample(vbx, vby);
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const n = SS * SS;
      const idx = (y * size + x) * 4;
      px[idx] = Math.round(r / n);
      px[idx + 1] = Math.round(g / n);
      px[idx + 2] = Math.round(b / n);
      px[idx + 3] = Math.round(a / n);
    }
  }
  return px;
}

/* ---- PNG assembly ---- */
function toPng(size, pixels) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: None
    pixels.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- Generate all sizes ---- */
for (const size of SIZES) {
  const png = toPng(size, renderIcon(size));
  const out = join(ICONS_DIR, `icon-${size}.png`);
  writeFileSync(out, png);
  console.log(`[gen-icons] ${out} → ${png.length} bytes`);
}
console.log('[gen-icons] Done — minimalist blue disc + dark play triangle rendered.');