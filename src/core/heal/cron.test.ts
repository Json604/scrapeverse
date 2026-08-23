import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickHealTargets, type RunHealCandidate } from "./cron.ts";

function row(over: Partial<RunHealCandidate> = {}): RunHealCandidate {
  return {
    source: "hackernews",
    channel: "live",
    status: "broken",
    action: "heal",
    collectorId: "c_abc123",
    ...over,
  };
}

describe("pickHealTargets — cron auto-heal policy", () => {
  test("does nothing unless --heal-on-break is on", () => {
    assert.deepEqual(pickHealTargets([row()], { enabled: false, limit: 1 }), []);
  });

  test("heals a live broken collector whose gate said heal", () => {
    const broken = row();
    assert.deepEqual(pickHealTargets([broken], { enabled: true, limit: 1 }), [broken]);
  });

  test("skips healthy, degraded, calibrating, and stale runs", () => {
    const skipped = (["healthy", "degraded", "calibrating", "stale"] as const).map((status) =>
      row({ source: "stackshare", status, action: status === "degraded" ? "quarantine" : "store_only" }),
    );
    assert.deepEqual(pickHealTargets(skipped, { enabled: true, limit: 4 }), []);
  });

  test("never auto-heals a non-live channel — that would mutate the live collector", () => {
    assert.deepEqual(
      pickHealTargets([row({ channel: "fixture:demo" })], { enabled: true, limit: 1 }),
      [],
    );
  });

  test("skips sources with no live collector id", () => {
    assert.deepEqual(
      pickHealTargets([row({ collectorId: "" }), row({ collectorId: "github_trending/v2-structure" })], {
        enabled: true,
        limit: 2,
      }),
      [],
    );
  });

  test("caps heals per tick so a 15-minute saga cannot blow the Actions timeout", () => {
    const broken = [
      row({ source: "hackernews", collectorId: "c_hn" }),
      row({ source: "github_trending", collectorId: "c_gh" }),
      row({ source: "stackshare", collectorId: "c_ss" }),
    ];
    assert.deepEqual(pickHealTargets(broken, { enabled: true, limit: 1 }), [broken[0]]);
  });
});
