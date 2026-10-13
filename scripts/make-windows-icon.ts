#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "@hormes/core";
import { encodePng } from "./png.ts";
import { checkIcon, renderIcon } from "./icon-render.ts";

/**
 * The Windows app's icon: the same five white voice bars on black as the Mac's Dock icon (icon-render.ts), as an
 * .ico with a PNG image per size (Windows Vista and later read PNG entries). Run `pnpm build:icon:windows` after a
 * change to the renderer; the .ico is tracked so the app builds without Node.
 */
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256] as const;

export function buildIco(sizes: readonly number[]): Buffer {
  const images = sizes.map((size) => {
    const r = renderIcon(size);
    checkIcon(r);
    return { size, png: encodePng(size, r.px) };
  });
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); // no palette
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

const out = join(REPO_ROOT, "apps", "windows", "Hormes.Windows", "Hormes.ico");
writeFileSync(out, buildIco(SIZES));
console.log(`wrote ${out} (${SIZES.join(", ")} px)`);
