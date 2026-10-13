import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { redirectedFolders } from "../user-folders.ts";

test("user folders: OneDrive-redirected ones are named, defaults are not", () => {
  const home = String.raw`C:\Users\someone`;
  const reg = [
    String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders`,
    String.raw`    Desktop    REG_SZ    C:\Users\someone\OneDrive\Desktop`,
    `    Personal    REG_SZ    ${join(home, "Documents")}`,
    String.raw`    {374DE290-123F-4565-9164-39C4925E467B}    REG_SZ    D:\Downloads`,
    String.raw`    My Pictures    REG_SZ    C:\Users\someone\OneDrive\Pictures`,
  ].join("\r\n");
  const found = redirectedFolders(reg, home);
  assert.deepEqual(found.map((f) => f.name), ["Desktop", "Downloads", "Pictures"]);
  assert.equal(found[0]!.path, String.raw`C:\Users\someone\OneDrive\Desktop`);
  assert.equal(found[1]!.path, String.raw`D:\Downloads`);
});
