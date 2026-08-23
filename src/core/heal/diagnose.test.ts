import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnosisFromSnapshot } from "./diagnose.ts";
import type { Snapshot } from "../types.ts";

test("total-loss diagnosis names collector fields and forbids listing→detail", () => {
  const snapshot: Snapshot = {
    snapshotId: "snap_x", runId: "run_x", source: "github_trending", channel: "live",
    capturedAt: "2026-08-23T00:00:00.000Z", ingestedAt: "2026-08-23T00:00:00.000Z",
    prevSnapshotId: null, comparisonSnapshotId: null, records: [],
    status: "broken",
    health: {
      rowCount: 0, expectedRowRange: [15, 30], fieldCoverage: {}, schemaValid: false,
      observedReplacement: null, evidence: [], canaryHits: 0, canaryMismatches: 0,
      presenceCanariesMissing: 0, anomalyScore: 1,
      softSignals: [], hardSignals: ["schema invalid: zero rows extracted"],
    },
    provenance: {
      collectorId: "c_test", collectorVersion: "v1", specVersion: 1,
      inputUrl: "https://github.com/trending", baselineVersion: 1, rawRef: null,
      payloadHash: "empty", transport: { providerJobId: "j", fetchedAt: "2026-08-23T00:00:00.000Z", refetched: true },
    },
  };

  const d = diagnosisFromSnapshot(snapshot);
  assert.match(d.suggestedHealPrompt, /repo /);
  assert.match(d.suggestedHealPrompt, /Do not open or follow/);
  assert.match(d.suggestedHealPrompt, /flat top-level fields/);
  assert.equal(d.verdict, "broken");
});
