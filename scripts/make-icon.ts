#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "@hormes/core";
import { Strip, encodePng } from "./png.ts";
import { SIZES, checkIcon, renderIcon } from "./icon-render.ts";

/** Generate all Dock sizes and reproducible previews of the five white voice bars on black. */
export function renderRgba(size: number): Buffer { return renderIcon(size).px; }

const iconset = join(REPO_ROOT, "build", "Hormes.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

const renders = new Map<number, Buffer>();
for (const size of SIZES) {
  const r = renderIcon(size);
  // Corners must be fully transparent and the centre fully opaque at every size.
  checkIcon(r);
  const rgba = r.px;
  renders.set(size, rgba);
  const png = encodePng(size, rgba);
  // iconutil wants both @1x and @2x names; the @2x of N is the 2N render.
  if (size <= 512) writeFileSync(join(iconset, `icon_${size}x${size}.png`), png);
  if (size >= 32) writeFileSync(join(iconset, `icon_${size / 2}x${size / 2}@2x.png`), png);
}

const icns = join(REPO_ROOT, "build", "Hormes.icns");
execFileSync("iconutil", ["-c", "icns", iconset, "-o", icns]);
writeFileSync(join(REPO_ROOT, "build", "icon.png"), encodePng(1024, renders.get(1024) ?? renderRgba(1024)));

// Inspect small and large voice marks side by side.
const pad = 24;
const stripSizes = [16, 32, 64, 128, 256] as const;
const zoomed = [16, 32, 64] as const;
const zoom = 4;
const rowW = stripSizes.reduce((w, s) => w + s + pad, pad);
const zoomW = zoomed.reduce((w, s) => w + s * zoom + pad, pad);
const stripW = Math.max(rowW, zoomW);
const stripH = pad + 256 + pad + 64 * zoom + pad;
const strip = new Strip(stripW, stripH);
let x = pad;
for (const s of stripSizes) {
  strip.paste(renders.get(s) ?? renderRgba(s), s, x, pad + 256 - s);
  x += s + pad;
}
x = pad;
for (const s of zoomed) {
  strip.paste(renders.get(s) ?? renderRgba(s), s, x, pad + 256 + pad + 64 * zoom - s * zoom, zoom);
  x += s * zoom + pad;
}
const stripPath = join(REPO_ROOT, "apps", "mac", "Resources", "preview-icon-sizes.png");
const stripPng = encodePng(stripW, strip.px, stripH);
writeFileSync(stripPath, stripPng);
// The native preview and documentation use the same generated voice-mark strip.
const mediaStrip = join(REPO_ROOT, "docs", "media", "icon-sizes.png");
writeFileSync(mediaStrip, stripPng);

console.log(`  ${icns}`);
console.log(`  ${join(REPO_ROOT, "build", "icon.png")}`);
console.log(`  ${stripPath}`);
console.log(`  ${mediaStrip}`);
