/**
 * Generates the Mudrik raster icons from scratch, drawing the same
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
 * Colour reference (matches OwlMascot.tsx / assets/icon.svg):
 *   body          #7499C2   (soft steel blue)
 *   wing shadow   #4F7399   (deeper feather)
 *   outline       #2D4A63   (navy — drawn as a slightly-larger shape beneath each fill)
 *   belly         #E8EEF5
 *   iris          #F2C94C   (golden yellow)
 *   iris ring     #D99A1E   (darker rim)
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

// ── Owl composition (viewBox 0..256, matches OwlMascot.tsx layout) ───────
// Strokes are faked by drawing each shape TWICE: first a slightly-larger
// copy in LINE colour, then the fill on top. Drawing order matters —
// shapes later in the list cover shapes earlier in the list, so an
// outline only shows where no later shape covers it (i.e., along the
// silhouette edge — exactly what we want).
function drawOwl(size) {
  const c = makeCanvas(size);
  const s = size / 256;

  const C = (cx, cy, r, col) => circle(c, cx * s, cy * s, r * s, col);
  const E = (cx, cy, rx, ry, col) => ellipse(c, cx * s, cy * s, rx * s, ry * s, col);
  const T = (ax, ay, bx, by, cx_, cy_, col) =>
    triangle(c, ax * s, ay * s, bx * s, by * s, cx_ * s, cy_ * s, col);

  const BODY  = [116, 153, 194, 255];   // #7499C2 — soft steel blue
  const WING  = [ 79, 115, 153, 235];   // #4F7399 — deeper feather
  const LINE  = [ 45,  74,  99, 255];   // #2D4A63
  const BELLY = [232, 238, 245, 255];   // #E8EEF5
  const IRIS  = [242, 201,  76, 255];   // #F2C94C — golden yellow
  const PUPIL = [ 28,  28,  28, 255];
  const HI    = [255, 255, 255, 255];
  const WARM  = [242, 169,  58, 255];   // #F2A93A

  // Stroke weight in 256-space. Outlines skipped for tray-sized icons
  // where a 3-5px-equivalent stroke would eat the shape.
  const strokes = size >= 48;
  const sw = size >= 128 ? 5 : 4;

  // ── Feet ─────────────────────────────────────────────────────────────
  if (size >= 64) {
    // Six toe bumps, three per foot.
    const toes = [94, 107, 120, 136, 149, 162];
    if (strokes) for (const fx of toes) C(fx, 236, 7 + sw * 0.5, LINE);
    for (const fx of toes) C(fx, 236, 7, WARM);
  } else if (size >= 24) {
    // Simplified: two chunky foot blobs.
    E(108, 232, 16, 8, WARM);
    E(148, 232, 16, 8, WARM);
  }

  // ── Body (unified pear silhouette, head+body merged for clean small-size reads) ──
  if (strokes) E(128, 150, 90 + sw, 90 + sw, LINE);
  E(128, 150, 90, 90, BODY);

  // Ear tufts — small triangles poking out of the head dome.
  if (size >= 48) {
    // Stroked tufts: draw a fractionally-enlarged outline triangle first.
    if (strokes) {
      T(64,  40, 86,  76, 100, 58, LINE);
      T(192, 40, 170, 76, 156, 58, LINE);
    }
    T(68,  44, 88,  74, 98, 58, BODY);
    T(188, 44, 168, 74, 158, 58, BODY);
  }

  // Wing shadow on each side — only shows as a subtle darkening.
  if (size >= 64) {
    E(52,  182, 14, 38, WING);
    E(204, 182, 14, 38, WING);
  }

  // ── Belly patch ──────────────────────────────────────────────────────
  if (strokes) E(128, 186, 46 + sw * 0.5, 52 + sw * 0.5, LINE);
  E(128, 186, 46, 52, BELLY);

  // ── Eyes ─────────────────────────────────────────────────────────────
  // Eye centres: slightly wider spacing than before to match the SVG.
  const eyeR = 28;
  if (strokes) {
    C(100, 92, eyeR + sw * 0.6, LINE);
    C(156, 92, eyeR + sw * 0.6, LINE);
  }
  C(100, 92, eyeR, HI);
  C(156, 92, eyeR, HI);

  // Tan iris — skipped at tiny sizes where it'd just muddy the pupil.
  if (size >= 32) {
    C(100, 92, 22, IRIS);
    C(156, 92, 22, IRIS);
  }

  // Pupils. Bigger at tiny sizes so they still register.
  const pupilR = size >= 64 ? 11 : 13;
  C(100, 92, pupilR, PUPIL);
  C(156, 92, pupilR, PUPIL);

  // Primary + secondary eye highlights (only at larger sizes).
  if (size >= 48) {
    C(104, 87, 4, HI);
    C(160, 87, 4, HI);
  }
  if (size >= 128) {
    C(95,  98, 1.5, HI);
    C(151, 98, 1.5, HI);
  }

  // ── Beak ─────────────────────────────────────────────────────────────
  if (strokes) T(128, 113, 115, 133, 141, 133, LINE);
  T(128, 118, 118, 132, 138, 132, WARM);

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
