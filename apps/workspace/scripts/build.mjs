import { build } from "esbuild";
import { mkdirSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { patchExcalidrawArrowHistory } from "./excalidraw-history.mjs";
const require = createRequire(import.meta.url);
const excalidrawEntry = require.resolve("@excalidraw/excalidraw");
const excalidraw = resolve(dirname(excalidrawEntry), "../..");
const excalidrawVersion = JSON.parse(readFileSync(`${excalidraw}/package.json`, "utf8")).version;
let patchedHistory = false;
const out = resolve("../../build/workspace");
mkdirSync(out, { recursive: true });
cpSync("NOTCHPROMPT-LICENSE.txt", `${out}/NOTCHPROMPT-LICENSE.txt`);
cpSync("EXCALIDRAW-LICENSE.txt", `${out}/EXCALIDRAW-LICENSE.txt`);
await build({ entryPoints: ["src/App.tsx"], bundle: true, external: ["./fonts/*"], outfile: `${out}/app.js`, format: "iife", conditions: ["production"], target: "safari17", jsx: "automatic", minify: true, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" }, assetNames: "assets/[name]-[hash]", plugins: [{ name: "pinned-excalidraw-and-local-fonts", setup(build) {
  build.onLoad({ filter: /excalidraw\/dist\/prod\/.*\.js$/ }, ({ path }) => {
    let contents = readFileSync(path, "utf8");
    if (path === excalidrawEntry) {
      contents = patchExcalidrawArrowHistory(contents, excalidrawVersion);
      patchedHistory = true;
    }
    // Excalidraw registers an external CDN fallback even when fonts are bundled.
    // Keep the fallback on our read-only local asset root instead.
    contents = contents.replace(/new URL\((\w+),\w+\.ASSETS_FALLBACK_URL\)/g, "new URL($1,window.EXCALIDRAW_ASSET_PATH)");
    return { contents, loader: "js" };
  });
  build.onEnd(() => patchedHistory ? undefined : { errors: [{ text: "Excalidraw's pinned arrow-history transform was not applied; refusing this workspace build." }] });
} }] });
cpSync(`${excalidraw}/dist/prod/fonts`, `${out}/fonts`, { recursive: true });
writeFileSync(`${out}/index.html`, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data: blob: https:; font-src 'self' data:;"><link rel="icon" href="data:,"><link rel="stylesheet" href="app.css"><title>Hormes workspace</title></head><body><div id="root"></div><script>window.EXCALIDRAW_ASSET_PATH=new URL('./',location.href).href;</script><script src="app.js"></script></body></html>`);
console.log("Bundled Hormes workspace with local drawing assets.");
