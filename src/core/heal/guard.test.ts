import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assertHealTargetAllowed } from "./saga.ts";

describe("heal target channel isolation", () => {
  test("fixture path is allowed on a fixture channel (dry-run / fixture backend)", () => {
    assert.doesNotThrow(() =>
      assertHealTargetAllowed("fixture:stress", "github_trending/v2-structure"),
    );
  });

  test("live c_* collector is refused on a fixture channel", () => {
    assert.throws(
      () => assertHealTargetAllowed("fixture:demo", "c_mt3dfmmv1b7cgi5n2v"),
      /refusing to heal collector/,
    );
  });

  test("live c_* collector is allowed on the live channel", () => {
    assert.doesNotThrow(() => assertHealTargetAllowed("live", "c_mt3dfmmv1b7cgi5n2v"));
  });
});
