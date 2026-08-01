// Generates PNG app icons from the plane silhouette, with no image-library
// dependency (raw PNG chunks + Node's built-in zlib). Run: node tools/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(outDir, { recursive: true });

// Plane silhouette (Material "flight" glyph) as a polygon in a 24x24 box.
const PLANE = [
  [21, 16], [21, 14], [13, 9],
  [13, 3.5], [12.7, 2.55], [11.5, 2.15], [10.3, 2.55], [10, 3.5],
  [10, 9], [2, 14], [2, 16], [10, 13.5],
  [10, 19], [8, 20.5], [8, 22], [11.5, 21], [15, 22], [15, 20.5],
  [13, 19], [13, 13.5],
];

const BG = [0x0f, 0x4c, 0x81];
const FG = [0xff, 0xff, 0xff];

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // scanlines, each prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderIcon(size, planeScale) {
  const SS = 4; // supersampling factor for smooth edges
  const rgba = Buffer.alloc(size * size * 4);
  // Map the 24x24 glyph into the icon, centred, occupying `planeScale` of it.
  const glyphPx = size * planeScale;
  const offset = (size - glyphPx) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const gx = ((x + (sx + 0.5) / SS) - offset) / glyphPx * 24;
          const gy = ((y + (sy + 0.5) / SS) - offset) / glyphPx * 24;
          if (pointInPolygon(gx, gy, PLANE)) hits++;
        }
      }
      const a = hits / (SS * SS);
      const i = (y * size + x) * 4;
      rgba[i]     = Math.round(BG[0] + (FG[0] - BG[0]) * a);
      rgba[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a);
      rgba[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a);
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, rgba);
}

const targets = [
  ["icon-192.png", 192, 0.70],
  ["icon-512.png", 512, 0.70],
  ["icon-maskable-512.png", 512, 0.55], // extra padding for maskable safe zone
];
for (const [name, size, scale] of targets) {
  writeFileSync(join(outDir, name), renderIcon(size, scale));
  console.log(`wrote icons/${name}`);
}
