/**
 * Generates placeholder extension icons (16/32/48/128 px) as PNGs.
 *
 * No image libraries are used: we hand-roll a minimal PNG encoder on top of
 * Node's built-in zlib. Pixel data is produced by a tiny software rasteriser
 * (rounded rect background + checkmark, 4x supersampled for smooth edges).
 *
 *   npm run icons          only writes icons that do not exist yet
 *   npm run icons -- --force   overwrites whatever is there
 *
 * `public/icon-*.png` is the source of truth for the extension, so this script
 * refuses to replace existing files unless forced. Running it unguarded used
 * to quietly throw away real artwork and restore these placeholders.
 */
import { deflateSync } from "node:zlib";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor
const FORCE = process.argv.includes("--force");

// CRC32 table (PNG chunk checksum).
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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // 10..12 = compression/filter/interlace = 0

  // Each scanline is prefixed with a filter byte (0 = None).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- tiny rasteriser -------------------------------------------------------

/** Signed distance to a rounded rectangle centred at (cx, cy). Negative = inside. */
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

/** Signed distance to a thick line segment. */
function sdSegment(px, py, ax, ay, bx, by, halfThickness) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - t * vx, wy - t * vy) - halfThickness;
}

const BG = [37, 99, 235]; // tailwind blue-600
const FG = [255, 255, 255];

function renderIcon(size) {
  const out = Buffer.alloc(size * size * 4);
  const S = size * SS;
  const cx = S / 2;
  const cy = S / 2;
  const half = S / 2;
  const radius = S * 0.22;
  const stroke = S * 0.075;

  // Checkmark: down-stroke then up-stroke.
  const a = [S * 0.28, S * 0.52];
  const b = [S * 0.44, S * 0.68];
  const c = [S * 0.74, S * 0.34];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a8 = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;
          if (sdRoundRect(px, py, cx, cy, half, half, radius) > 0) continue; // outside

          const d = Math.min(
            sdSegment(px, py, a[0], a[1], b[0], b[1], stroke),
            sdSegment(px, py, b[0], b[1], c[0], c[1], stroke)
          );
          const onMark = d <= 0;
          r += onMark ? FG[0] : BG[0];
          g += onMark ? FG[1] : BG[1];
          b += onMark ? FG[2] : BG[2];
          a8 += 255;
        }
      }

      const samples = SS * SS;
      const idx = (y * size + x) * 4;
      if (a8 > 0) {
        const covered = a8 / 255;
        // Premultiplied averaging so edge pixels don't pick up the colour of
        // samples that landed outside the rounded rect.
        out[idx] = Math.round(r / covered);
        out[idx + 1] = Math.round(g / covered);
        out[idx + 2] = Math.round(b / covered);
        out[idx + 3] = Math.round(a8 / samples);
      }
    }
  }
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });

const existing = SIZES.filter((size) => existsSync(join(OUT_DIR, `icon-${size}.png`)));
if (existing.length > 0 && !FORCE) {
  console.log(
    `kept existing icon(s): ${existing.map((s) => `icon-${s}.png`).join(", ")}\n` +
      "Your artwork was not touched. Use `npm run icons -- --force` to replace it.",
  );
}

for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  if (existsSync(file) && !FORCE) continue;
  writeFileSync(file, encodePng(size, renderIcon(size)));
  console.log(`wrote ${file}`);
}
