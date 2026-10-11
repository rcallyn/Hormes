import { test } from "node:test";
import assert from "node:assert/strict";
import { SIZES, checkIcon, renderIcon, staleAgainst } from "../icon-render.ts";

test("voice icon is readable, grayscale, transparent outside its black tile at every Dock size", () => {
  for (const size of SIZES) {
    const r = renderIcon(size); checkIcon(r);
    let black = 0, white = 0;
    for (let i = 0; i < r.px.length; i += 4) {
      assert.equal(r.px[i], r.px[i + 1]); assert.equal(r.px[i], r.px[i + 2]);
      if (r.px[i + 3] === 255 && r.px[i] === 0) black++;
      if (r.px[i + 3] === 255 && r.px[i]! > 128) white++;
    }
    assert.ok(black > white && white > size, `visible white mark on black at ${size}`);
    assert.deepEqual(renderIcon(size).px, r.px);
  }
});
test("packaging regenerates missing or stale icons", () => {
  assert.equal(staleAgainst(undefined, [10]), true);
  assert.equal(staleAgainst(20, [10, undefined]), false);
  assert.equal(staleAgainst(20, [21]), true);
});
