/**
 * Generates the HoverBuddy raster icons from scratch, drawing the same
 * blue-owl character that appears in:
 *   - assets/icon.svg            (static brand mark)
 *   - src/renderer/components/OwlMascot.tsx   (animated in-panel mascot)
 *
 * Why a hand-rolled PNG encoder instead of `sharp` / `resvg`:
 *   - Zero extra npm dependencies; this runs on a stock Node install.
 *   - At tray sizes (16-32 px) full SVG rasterization doesn't look good
 *     anyway — hinted geometric primitives render crisper.
 *
 * Outputs:
 *   assets/icon.png        256x256  — main app / window icon
 *   assets/tray.png         32x32   — Windows tray @1x
 *   assets/tray@2x.png      64x64   — HiDPI tray (Electron picks when available)
 *   assets/icon.ico         ICO with 16,24,32,48,64,128,256 PNG-compressed frames
 *
 * Colour reference:
 *   body          #18BFE1  (cyan 500)
 *   back wing     #0FA8C9  (cyan 700)
 *   belly         #FFFFFF
 *   eye white     #FFFFFF
 *   pupil         #1C1C1C
 *   beak / feet   #F2A93A
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ── PNG encoder ──────────────────────────────────────────────────────────
// Writes 8-bit RGBA PNG. Single IDAT chunk, filter type 0 on every row.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
      t[n] = v >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type = RGBA
  ihdr[10] = 0;    // compression
  ihdr[11] = 0;    // filter
  ihdr[12] = 0;    // interlace

  // Prefix each scanline with a filter byte (0 = none).
  const stride = w * 4;
  const rawWithFilter = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    rawWithFilter[y * (stride + 1)] = 0;
    rgba.copy(rawWithFilter, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(rawWithFilter);

  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Drawing primitives over an RGBA buffer ───────────────────────────────
// All primitives operate in "SVG viewBox" space (0..256) and sample-average
// sub-pixels for cheap AA. They always alpha-composite over the existing
// buffer so shapes stack correctly.

function makeCanvas(size) {
  // Fully transparent to start.
  return { buf: Buffer.alloc(size * size * 4), size };
}

function putPixel(c, x, y, r, g, b, a) {
  if (x < 0 || x >= c.size || y < 0 || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const srcA = a / 255;
  const dstA = c.buf[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  c.buf[i]     = Math.round((r * srcA + c.buf[i]     * dstA * (1 - srcA)) / outA);
  c.buf[i + 1] = Math.round((g * srcA + c.buf[i + 1] * dstA * (1 - srcA)) / outA);
  c.buf[i + 2] = Math.round((b * srcA + c.buf[i + 2] * dstA * (1 - srcA)) / outA);
  c.buf[i + 3] = Math.round(outA * 255);
}

// AA sampling: test `samples * samples` sub-pixels per pixel via `isInside`.
function drawShape(c, bbox, isInside, color) {
  const [r, g, b, a = 255] = color;
  const samples = 3;
  const [x0, y0, x1, y1] = bbox;
  const xs = Math.max(0, Math.floor(x0));
  const ys = Math.max(0, Math.floor(y0));
  const xe = Math.min(c.size - 1, Math.ceil(x1));
  const ye = Math.min(c.size - 1, Math.ceil(y1));
  for (let y = ys; y <= ye; y++) {
    for (let x = xs; x <= xe; x++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          if (isInside(px, py)) hits++;
        }
      }
      if (hits === 0) continue;
      const coverage = hits / (samples * samples);
      putPixel(c, x, y, r, g, b, Math.round(a * coverage));
    }
  }
}

function circle(c, cx, cy, r, color) {
  drawShape(
    c,
    [cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1],
    (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r,
    color,
  );
}

function ellipse(c, cx, cy, rx, ry, color) {
  drawShape(
    c,
    [cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1],
    (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1,
    color,
  );
}

function triangle(c, ax, ay, bx, by, cx, cy, color) {
  const minx = Math.min(ax, bx, cx) - 1;
  const maxx = Math.max(ax, bx, cx) + 1;
  const miny = Math.min(ay, by, cy) - 1;
  const maxy = Math.max(ay, by, cy) + 1;
  function sign(px, py, x1, y1, x2, y2) {
    return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  }
  drawShape(c, [minx, miny, maxx, maxy], (x, y) => {
    const d1 = sign(x, y, ax, ay, bx, by);
    const d2 = sign(x, y, bx, by, cx, cy);
    const d3 = sign(x, y, cx, cy, ax, ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }, color);
}

// ── Owl composition (viewBox 0..256, matches icon.svg layout) ────────────
function drawOwl(size) {
  const c = makeCanvas(size);
  const s = size / 256;   // scale factor from 256-space to target pixels

  // Convenience: all coords given in 256-space, scaled at draw time.
  const C = (cx, cy, r, col) => circle(c, cx * s, cy * s, r * s, col);
  const E = (cx, cy, rx, ry, col) => ellipse(c, cx * s, cy * s, rx * s, ry * s, col);
  const T = (ax, ay, bx, by, cx_, cy_, col) =>
    triangle(c, ax * s, ay * s, bx * s, by * s, cx_ * s, cy_ * s, col);

  const BODY       = [24, 191, 225, 255];
  const BODY_DARK  = [15, 168, 201, 255];
  const BELLY      = [255, 255, 255, 240];
  const EYE_WHITE  = [255, 255, 255, 255];
  const PUPIL      = [28, 28, 28, 255];
  const PUPIL_HILIGHT = [255, 255, 255, 255];
  const WARM       = [242, 169, 58, 255];

  // Back wing accent (only noticeable at 128+ px)
  if (size >= 48) {
    E(180, 160, 26, 44, BODY_DARK);
  }

  // Body (rounded teardrop — we fake it with overlapping ellipses)
  E(128, 170, 82, 70, BODY);
  // Belly patch
  E(128, 188, 42, 42, BELLY);

  // Feet
  T(92, 218, 78, 238, 96, 226, WARM);
  T(108, 220, 98, 238, 114, 228, WARM);
  T(148, 220, 146, 238, 162, 228, WARM);
  T(164, 218, 166, 238, 180, 226, WARM);

  // Head (slightly flattened disc + two tuft triangles)
  E(128, 74, 72, 54, BODY);
  // Ear tufts
  T(68, 56, 96, 78, 76, 88, BODY);
  T(188, 56, 160, 78, 180, 88, BODY);

  // Eye whites
  const eyeR = 22;
  C(102, 88, eyeR, EYE_WHITE);
  C(154, 88, eyeR, EYE_WHITE);

  // Pupils — at small sizes shift slightly to create "alert" look.
  const pupilR = size >= 64 ? 9 : 11;
  C(102, 88, pupilR, PUPIL);
  C(154, 88, pupilR, PUPIL);

  // Pupil highlights (only at larger sizes — noise at tray sizes)
  if (size >= 48) {
    C(106, 84, 3, PUPIL_HILIGHT);
    C(158, 84, 3, PUPIL_HILIGHT);
  }

  // Beak
  T(128, 104, 120, 118, 136, 118, WARM);

  return c.buf;
}

// ── ICO writer ───────────────────────────────────────────────────────────
// ICO = ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes each) + image data.
// For modern Windows, each entry's payload is a complete PNG.
function encodeICO(frames /* [{size, png}] */) {
  const entrySize = 16;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type = ICO
  header.writeUInt16LE(frames.length, 4);

  const entries = Buffer.alloc(entrySize * frames.length);
  let offset = header.length + entries.length;
  for (let i = 0; i < frames.length; i++) {
    const { size, png } = frames[i];
    const off = i * entrySize;
    entries[off] = size >= 256 ? 0 : size;         // width  (0 = 256)
    entries[off + 1] = size >= 256 ? 0 : size;     // height (0 = 256)
    entries[off + 2] = 0;                          // palette
    entries[off + 3] = 0;                          // reserved
    entries.writeUInt16LE(1, off + 4);             // color planes
    entries.writeUInt16LE(32, off + 6);            // bpp
    entries.writeUInt32LE(png.length, off + 8);    // image size
    entries.writeUInt32LE(offset, off + 12);       // offset
    offset += png.length;
  }

  return Buffer.concat([header, entries, ...frames.map((f) => f.png)]);
}

// ── Drive ────────────────────────────────────────────────────────────────
function main() {
  const outDir = path.resolve(__dirname, "..", "assets");
  fs.mkdirSync(outDir, { recursive: true });

  const targets = [
    { name: "tray.png",    size: 32 },
    { name: "tray@2x.png", size: 64 },
    { name: "icon.png",    size: 256 },
  ];

  for (const t of targets) {
    const rgba = drawOwl(t.size);
    const png = encodePNG(rgba, t.size, t.size);
    fs.writeFileSync(path.join(outDir, t.name), png);
    console.log(`  ${t.name.padEnd(14)} ${t.size}x${t.size}  ${png.length} bytes`);
  }

  // Build Windows .ico with the sizes the OS actually picks (16/24/32/48/64/128/256).
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoFrames = icoSizes.map((size) => ({
    size,
    png: encodePNG(drawOwl(size), size, size),
  }));
  const icoBuf = encodeICO(icoFrames);
  fs.writeFileSync(path.join(outDir, "icon.ico"), icoBuf);
  console.log(`  icon.ico       multi-size  ${icoBuf.length} bytes`);
}

main();
