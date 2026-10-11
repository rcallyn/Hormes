import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderIcon } from "../../../scripts/icon-render.ts";
import { encodePng } from "../../../scripts/png.ts";

// Reuse the Mac's five voice bars; iOS supplies the icon's corner mask.
const directory = fileURLToPath(new URL("../HormesPhone/Assets.xcassets/AppIcon.appiconset/", import.meta.url));
mkdirSync(directory, { recursive: true });
const { px } = renderIcon(1024);
for (let index = 3; index < px.length; index += 4) px[index] = 255;
writeFileSync(`${directory}/AppIcon.png`, encodePng(1024, px));
writeFileSync(`${directory}/Contents.json`, JSON.stringify({ images: [{ filename: "AppIcon.png", idiom: "universal", platform: "ios", size: "1024x1024" }], info: { author: "xcode", version: 1 } }, null, 2));
