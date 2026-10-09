// Generates the extension icons (a colour wheel with a clock hand) as PNGs
// using only Node built-ins, so no image tooling is needed.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function icon(size) {
  const c = (size - 1) / 2;
  const R = size / 2;
  return png(size, (x, y) => {
    // 4x supersampling for smooth edges.
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const px = x + (sx + 0.5) / 4 - 0.5 - c;
        const py = y + (sy + 0.5) / 4 - 0.5 - c;
        const d = Math.hypot(px, py) / R;
        let col = null;
        if (d <= 1) {
          if (d > 0.62) {
            const hue = ((Math.atan2(py, px) * 180) / Math.PI + 450) % 360;
            col = [...hsl(hue, 0.7, 0.55), 255];
          } else if (d > 0.5) {
            col = [255, 255, 255, 255];
          } else {
            col = [38, 38, 38, 255];
            // clock hands: up and to the right
            const w = 0.09;
            if ((Math.abs(px / R) < w && py / R < 0.02 && py / R > -0.38) || (Math.abs(py / R) < w && px / R > -0.02 && px / R < 0.28)) {
              col = [255, 255, 255, 255];
            }
          }
        }
        if (col) acc = acc.map((v, i) => v + col[i] * (i === 3 ? 1 : col[3] / 255));
      }
    }
    const a = acc[3] / 16;
    return a === 0 ? [0, 0, 0, 0] : [acc[0] / (acc[3] / 255), acc[1] / (acc[3] / 255), acc[2] / (acc[3] / 255), a].map(Math.round);
  });
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) fs.writeFileSync(path.join(out, `icon${size}.png`), icon(size));
console.log('icons written to', out);
