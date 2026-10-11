/** Hormes' five voice bars, white on a black macOS icon tile. No mascot or colour ramp. */
export const SIZES = [16, 32, 64, 128, 256, 512, 1024] as const;
export const ICON_SOURCES: readonly string[] = ["make-icon.ts", "icon-render.ts", "png.ts"];
export interface IconRender { readonly size: number; readonly px: Buffer; readonly mask: Uint8Array }
export function staleAgainst(builtMs: number | undefined, sourcesMs: readonly (number | undefined)[]): boolean {
  return builtMs === undefined || sourcesMs.some(ms => ms !== undefined && ms > builtMs);
}
function roundedBox(x: number, y: number, halfW: number, halfH: number, radius: number): number {
  const dx = Math.abs(x) - halfW + radius, dy = Math.abs(y) - halfH + radius;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}
export function renderIcon(size: number): IconRender {
  if (!Number.isInteger(size) || size < 16 || size > 1024) throw new Error("Icon size must be an integer from 16 to 1024");
  const px = Buffer.alloc(size * size * 4), mask = new Uint8Array(size * size);
  const halfBar = Math.max(0.022, 0.6 / size);
  const heights = [0.18, 0.32, 0.48, 0.32, 0.18];
  // Sample at pixel centres. Grayscale antialiasing preserves the monochrome mark at 16 px.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x + 0.5) / size - 0.5, ny = (y + 0.5) / size - 0.5;
    const edge = roundedBox(nx, ny, 0.42, 0.42, 0.105);
    const a = Math.round(Math.max(0, Math.min(1, 0.5 - edge * size)) * 255);
    let wave = 0;
    for (let bar = 0; bar < heights.length; bar++) {
      const d = roundedBox(nx - (bar - 2) * 0.1, ny, halfBar, heights[bar]! / 2, halfBar);
      wave = Math.max(wave, Math.max(0, Math.min(1, 0.5 - d * size)));
    }
    const value = Math.round(wave * 255), i = (y * size + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = value; px[i + 3] = a;
    mask[y * size + x] = wave >= 0.5 ? 1 : 0;
  }
  return { size, px, mask };
}
export function checkIcon(r: IconRender): void {
  if (r.px.length !== r.size * r.size * 4 || r.px[3] !== 0 || r.px[(r.size * r.size - 1) * 4 + 3] !== 0) throw new Error("Invalid icon bounds");
  if (!r.mask.some(value => value === 1)) throw new Error("Missing voice mark");
}
