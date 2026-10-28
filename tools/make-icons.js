// Renders icons/icon{16,32,48,128}.png with a small SDF rasterizer and a
// hand-rolled PNG writer (zlib + CRC32), no dependencies. Same pattern as
// the token-counter make-icons tool. Supersampling: 4x4 samples per pixel.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'icons');

const BG = [30, 40, 51];       // #1E2833
const FG = [237, 242, 247];    // #EDF2F7
const ACCENT = [79, 182, 255]; // #4FB6FF

// --- SDF primitives (coordinates in 0..1) ---
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
}
function sdSegment(px, py, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = px - a[0];
  const apy = py - a[1];
  const t = Math.min(1, Math.max(0, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)));
  return Math.hypot(apx - abx * t, apy - aby * t);
}
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

// Motif: L-shaped plan outline, an inner wall, a bulged arc hint, and a
// cyan detail circle. Returns {alpha, color} for a point; aa is the
// anti-aliasing width in unit-square coordinates (~1.5 px).
function sceneColor(px, py, aa) {
  const cov = (sd) => Math.max(0, Math.min(1, 0.5 - sd / aa));
  const bg = cov(sdRoundRect(px, py, 0.5, 0.5, 0.5, 0.5, 0.22));
  if (bg <= 0) return null;

  const w = 0.062;
  const lines = Math.min(
    sdSegment(px, py, [0.28, 0.70], [0.28, 0.32]),
    sdSegment(px, py, [0.28, 0.32], [0.64, 0.32]),
    sdSegment(px, py, [0.28, 0.52], [0.50, 0.52]),
    sdSegment(px, py, [0.50, 0.52], [0.64, 0.38]),
  );
  const strokeCov = cov(Math.abs(lines) - w / 2);
  if (strokeCov > 0) return { alpha: strokeCov, color: FG };
  const ringCov = cov(Math.abs(sdCircle(px, py, 0.70, 0.64, 0.115)) - w / 2);
  if (ringCov > 0) return { alpha: ringCov, color: ACCENT };
  return { alpha: bg, color: BG };
}

function render(size) {
  const S = 4; // samples per axis
  const aa = 1.5 / size;
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = (x + (sx + 0.5) / S) / size;
          const py = (y + (sy + 0.5) / S) / size;
          const hit = sceneColor(px, py, aa);
          if (hit) {
            r += hit.color[0];
            g += hit.color[1];
            b += hit.color[2];
            a += hit.alpha * 255;
          }
        }
      }
      const n = S * S;
      const i = (y * size + x) * 4;
      data[i] = Math.round(r / n);
      data[i + 1] = Math.round(g / n);
      data[i + 2] = Math.round(b / n);
      data[i + 3] = Math.round(a / n);
    }
  }
  return data;
}

// --- PNG ---
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = encodePng(size, render(size));
  const file = path.join(outDir, `icon${size}.png`);
  await writeFile(file, png);
  console.log(`icons/icon${size}.png: ${png.length} bytes`);
}
