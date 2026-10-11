import { deflateSync } from "node:zlib";

export type RGB = readonly [number, number, number];

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Minimal PNG encoder: 8-bit RGBA, filter type 0 on every scanline. Square when `height` is omitted. Deterministic. */
export function encodePng(width: number, rgba: Buffer, height = width): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A canvas to paste renders on: the Console's raised ground, opaque. */
export class Strip {
  readonly px: Buffer;
  constructor(readonly width: number, readonly height: number, ground: RGB = [0x10, 0x10, 0x10]) {
    this.px = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.px[i * 4] = ground[0];
      this.px[i * 4 + 1] = ground[1];
      this.px[i * 4 + 2] = ground[2];
      this.px[i * 4 + 3] = 255;
    }
  }
  /** Source-over `rgba` (size×size) at (x, y), each source pixel `zoom`× (nearest: the dither stays crisp). */
  paste(rgba: Buffer, size: number, x0: number, y0: number, zoom = 1): void {
    for (let sy = 0; sy < size; sy++) {
      for (let sx = 0; sx < size; sx++) {
        const s = (sy * size + sx) * 4;
        const a = (rgba[s + 3] ?? 0) / 255;
        if (a <= 0) continue;
        for (let zy = 0; zy < zoom; zy++) {
          for (let zx = 0; zx < zoom; zx++) {
            const x = x0 + sx * zoom + zx;
            const y = y0 + sy * zoom + zy;
            if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
            const d = (y * this.width + x) * 4;
            for (let c = 0; c < 3; c++) this.px[d + c] = Math.round((rgba[s + c] ?? 0) * a + (this.px[d + c] ?? 0) * (1 - a));
            this.px[d + 3] = 255;
          }
        }
      }
    }
  }
}
