/*!
 * FocusBot icon generator — pure Node.js, zero dependencies.
 * Renders the official mark: blue gradient circle, light "FB" monogram and a
 * prominent orange radio-badge (device) at the bottom-right corner.
 * Each size is rasterised natively with 4x supersampled anti-aliasing so the
 * small 16px icon stays crisp (no downscaled blur).
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

/* ---- Color helpers ---- */
const hexToRgb = (hex) => {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const clamp = (t) => Math.min(1, Math.max(0, t));

/* ---- Palette (full-contrast, not washed out) ---- */
const C = {
  blueA: hexToRgb('#4f9bff'),   // gradient start
  blueB: hexToRgb('#6b7fff'),   // gradient end
  rim:   hexToRgb('#3b6fe0'),   // circle edge (crisp contour)
  oA:    hexToRgb('#ff9e45'),   // orange gradient start
  oB:    hexToRgb('#ff6b00'),   // orange gradient end
  oRim:  hexToRgb('#b24d00'),   // badge device ring
  white: [255, 255, 255],
};

/* ---- "FB" 5x7 monogram: F (cols 0-4), gap (5), B (cols 6-10) ---- */
const FONT_F = [
  '11111', '10000', '11111', '10000', '10000', '10000', '10000',
];
const FONT_B = [
  '11110', '10001', '10001', '11110', '10001', '10001', '11110',
];

/* Design geometry (normalized 0..1 of the icon size) */
const GEO = {
  cx: 0.5, cy: 0.52,            // circle centre (slightly above centre)
  R: 0.43,                      // circle radius
  glyphW: 0.58,                 // whole "FB" canvas width
  // orange radio badge at bottom-right
  bx: 0.775, by: 0.775, bR: 0.135,
  dot: { x: 0.685, y: 0.775, r: 0.022 },
  arcs: [
    { r1: 0.075, r2: 0.100 },
    { r1: 0.112, r2: 0.124 },
  ],
};

const GLYPH_NC = 11, GLYPH_NR = 7;
const GLYPH_CELL = GEO.glyphW / GLYPH_NC;
const glyphTop = GEO.cy - (GLYPH_CELL * GLYPH_NR) / 2;
const glyphLeft = GEO.cx - GEO.glyphW / 2;

function insideFB(u, v) {
  const col = Math.floor((u - glyphLeft) / GLYPH_CELL);
  const row = Math.floor((v - glyphTop) / GLYPH_CELL);
  if (col < 0 || col >= GLYPH_NC || row < 0 || row >= GLYPH_NR) return false;
  if (col === 5) return false;
  const glyph = col < 5 ? FONT_F : FONT_B;
  return glyph[row][col % 5] === '1';
}

/** Sample one fine subsample; returns [r, g, b, a]. */
function sample(u, v) {
  const d = Math.hypot(u - GEO.cx, v - GEO.cy);

  // White radio motif (dot + arcs) — drawn above everything inside the badge
  const bdx = u - GEO.bx, bdy = v - GEO.by;
  const bd = Math.hypot(bdx, bdy);
  const angleOK = bdx >= 0.5 * bd; // horizontal ±60°, waves radiate right
  const inArc = GEO.arcs.some(({ r1, r2 }) => angleOK && bd > r1 && bd < r2);
  const inDot = Math.hypot(u - GEO.dot.x, v - GEO.dot.y) <= GEO.dot.r;
  if (inArc || inDot) return [...C.white, 255];

  // Orange badge (device) with a dark ring for contour
  if (bd <= GEO.bR) {
    const t = clamp((bdx / GEO.bR + bdy / GEO.bR + 2) / 4);
    return [lerp(C.oA[0], C.oB[0], t), lerp(C.oA[1], C.oB[1], t), lerp(C.oA[2], C.oB[2], t), 255];
  }
  if (bd <= GEO.bR + 0.012) {
    const a = Math.round(255 * clamp(1 - (bd - GEO.bR) / 0.012));
    return [...C.oRim, a];
  }

  // Outer border of the whole canvas → transparent
  if (d > 0.47) return [0, 0, 0, 0];
  // Circle contour (dark rim) for a crisp, non-pale edge
  if (d > 0.443) {
    const a = Math.round(255 * clamp(1 - (d - 0.443) / 0.027));
    return [...C.rim, a];
  }
  if (d > GEO.R) return [...C.rim, 255];

  // Blue gradient body (top-left → bottom-right for a soft 135° feel)
  const t = clamp((u + v) / 2);
  const rgb = [lerp(C.blueA[0], C.blueB[0], t), lerp(C.blueA[1], C.blueB[1], t), lerp(C.blueA[2], C.blueB[2], t)];

  // Light "FB" monogram
  if (insideFB(u, v)) return [...C.white, 255];
  return [...rgb, 255];
}

/* ---- Render one size (4x supersampled AA) ---- */
function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = sample(u, v);
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
console.log('[gen-icons] Done — blue circle + FB + orange radio badge rendered.');