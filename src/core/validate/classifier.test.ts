/**
 * The decisive tests. Each case here defeated an earlier draft of the design.
 * If these pass, the break-vs-change thesis holds mechanically rather than rhetorically.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./index.ts";
import { changeBreadth, fieldConfusion } from "./evidence.ts";
import { diffRecords } from "../diff.ts";
import { DEFAULT_WEIGHTS } from "../config.ts";
import type {
  NormalizedRecord, SourceExpectations, Baseline, Snapshot, TransportMeta,
} from "../types.ts";

const EXP: SourceExpectations = {
  rowRange: [20, 25],
  watchKeys: ["pricingModel", "category"],
  requiredFields: ["title", "pricingModel"],
  presenceCanaries: ["title", "pricingModel"],
  liveCanaries: [],
  turnover: { lo: 0.0, hi: 0.1 },
  overlapWeight: 1,
  rankNoiseFloor: 2,
  metricDeltaFloors: {},
};

const PRICES = ["Free", "Freemium", "Paid", "Free Trial"];
const CATEGORIES = ["Image", "Chat", "Code", "Audio"];
const DEPLOYMENTS = ["Cloud", "API", "Self-hosted", "Extension"];

function rows(n: number, f: (i: number) => Partial<NormalizedRecord> = () => ({})): NormalizedRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    source: "futurepedia" as const, entityType: "tool" as const,
    nativeId: `tool-${i}`, entityId: `futurepedia:tool-${i}`,
    title: `Tool ${i}`, url: `https://futurepedia.io/tool/tool-${i}`,
    canonicalUrl: `https://futurepedia.io/tool/tool-${i}`,
    rank: i + 1, metrics: {},
    attributes: { pricingModel: PRICES[i % 4]!, category: CATEGORIES[i % 4]! },
    capturedAt: "2026-08-21T00:00:00.000Z",
    ...f(i),
  }));
}

const TRANSPORT: TransportMeta = { providerJobId: "job-new", fetchedAt: "2026-08-21T01:00:00.000Z", refetched: true };

function snap(recs: NormalizedRecord[], hash: string, jobId = "job-old"): Snapshot {
  return {
    snapshotId: "snap_prev", runId: "run_prev", source: "futurepedia", channel: "live",
    capturedAt: "2026-08-20T00:00:00.000Z", ingestedAt: "2026-08-20T00:00:00.000Z",
    prevSnapshotId: null, comparisonSnapshotId: null, records: recs,
    status: "healthy",
    health: {
      rowCount: recs.length, expectedRowRange: [20, 25], fieldCoverage: {}, schemaValid: true,
      observedReplacement: 0, evidence: [], canaryHits: 0, canaryMismatches: 0,
      presenceCanariesMissing: 0, anomalyScore: 0, softSignals: [], hardSignals: [],
    },
    provenance: {
      collectorId: "c_test", collectorVersion: "v1", specVersion: 1,
      inputUrl: "https://futurepedia.io/ai-tools", baselineVersion: 1, rawRef: null,
      payloadHash: hash, transport: { providerJobId: jobId, fetchedAt: "2026-08-20T00:00:00.000Z", refetched: true },
    },
  };
}

const BASELINE: Baseline = {
  source: "futurepedia", channel: "live", version: 1, signed: true,
  signedKeys: ["pricingModel", "category"],
  rowCountMean: 24, rowCountStd: 0.5,
  fieldCoverage: { title: 1, pricingModel: 1, category: 1 },
  vocabularies: { pricingModel: PRICES, category: CATEGORIES, title: [] },
  replacementSamples: [], healthySnapshotIds: [], updatedAt: "2026-08-20T00:00:00.000Z",
};

function run(curr: NormalizedRecord[], prev: NormalizedRecord[] | null, over: Partial<Parameters<typeof validate>[0]> = {}) {
  const prevSnap = prev ? snap(prev, "hash-prev") : null;
  return validate({
    source: "futurepedia", channel: "live", records: curr,
    transport: TRANSPORT, payloadHash: "hash-curr",
    expectations: EXP, weights: DEFAULT_WEIGHTS,
    previous: prevSnap, lastHealthy: prevSnap, baseline: BASELINE,
    canaries: [], ...over,
  });
}

describe("break vs change — the cases that killed earlier drafts", () => {
  test("MONEY DEMO: one tool flips Free→Paid ⇒ healthy, exactly one ATTRIBUTE_CHANGED", () => {
    const prev = rows(24);
    const curr = rows(24, (i) => (i === 7 ? { attributes: { pricingModel: "Paid", category: CATEGORIES[7 % 4]! } } : {}));

    const { status } = run(curr, prev);
    assert.equal(status, "healthy", "a sparse real change must NOT read as a break");

    const events = diffRecords(prev, curr, EXP, {
      fromSnapshot: "a", toSnapshot: "b", intervalStart: "x", intervalEnd: "y",
      gapCount: 0, confidence: 1, channel: "live",
    });
    const attr = events.filter((e) => e.changeType === "ATTRIBUTE_CHANGED");
    assert.equal(attr.length, 1);
    assert.equal(attr[0]!.field, "pricingModel");
    assert.equal(attr[0]!.from, PRICES[7 % 4]);
    assert.equal(attr[0]!.to, "Paid");
  });

  test("WRONG COLUMN: pricingModel ← category ⇒ broken (this defeated the fingerprint check)", () => {
    const prev = rows(24);
    const curr = rows(24, (i) => ({ attributes: { pricingModel: CATEGORIES[i % 4]!, category: CATEGORIES[i % 4]! } }));
    const { status, health } = run(curr, prev);
    assert.equal(status, "broken");
    assert.ok(health.hardSignals.some((s) => /selector drift|universal/.test(s)), health.hardSignals.join(" | "));
  });

  test("UNTRACKED SIBLING: pricingModel ← deployment chip ⇒ broken (this defeated vocabulary disjointness)", () => {
    // The killer case: the drifted-to column is NOT tracked, so no vocabulary comparison can see it.
    // Only breadth catches this — every row changes at once.
    const prev = rows(24);
    const curr = rows(24, (i) => ({ attributes: { pricingModel: DEPLOYMENTS[i % 4]!, category: CATEGORIES[i % 4]! } }));
    const { status, health } = run(curr, prev);
    assert.equal(status, "broken", "untracked-sibling drift must not fail open");
    assert.ok(health.hardSignals.some((s) => /universal/.test(s)), health.hardSignals.join(" | "));
  });

  test("breadth separates sparse content change from universal structure change", () => {
    const prev = rows(24);
    const one = rows(24, (i) => (i === 3 ? { attributes: { pricingModel: "Paid", category: CATEGORIES[3 % 4]! } } : {}));
    const all = rows(24, (i) => ({ attributes: { pricingModel: DEPLOYMENTS[i % 4]!, category: CATEGORIES[i % 4]! } }));

    assert.ok(changeBreadth(one, prev, "pricingModel").breadth < DEFAULT_WEIGHTS.breadthContentMax);
    assert.equal(changeBreadth(all, prev, "pricingModel").breadth, 1);
  });

  test("fieldConfusion detects a MIXED read that set-subset comparison cannot", () => {
    const prev = rows(24);
    const half = rows(24, (i) => (i % 2 === 0 ? { attributes: { pricingModel: CATEGORIES[i % 4]!, category: CATEGORIES[i % 4]! } } : {}));
    const c = fieldConfusion(half, prev, "pricingModel", "category");
    assert.ok(c >= 0.4 && c <= 0.6, `expected ~0.5 mixed agreement, got ${c}`);
  });

  test("PARTIAL LIST: 20 of 24 rows still extract ⇒ broken, not 4 false LEFTs", () => {
    const prev = rows(24);
    const curr = rows(24).slice(0, 20);
    const { status } = run(curr, prev);
    assert.equal(status, "broken", "row count inside rowRange must not mask a truncated list");
  });

  test("COVERAGE COLLAPSE: pricingModel empty on every row ⇒ broken", () => {
    const prev = rows(24);
    const curr = rows(24, (i) => ({ attributes: { pricingModel: null, category: CATEGORIES[i % 4]! } }));
    const { status, health } = run(curr, prev);
    assert.equal(status, "broken");
    assert.ok(health.hardSignals.some((s) => /coverage collapse|empty on every row/.test(s)));
  });

  test("GENESIS: no signed baseline ⇒ calibrating, never healthy", () => {
    const { status } = run(rows(24), null, { baseline: null });
    assert.equal(status, "calibrating", "a plausible-but-wrong first extraction must not become truth");
  });

  test("STALE: unchanged payload with no refetch ⇒ stale", () => {
    const prev = rows(24);
    const prevSnap = snap(prev, "same-hash", "job-1");
    const { status } = validate({
      source: "futurepedia", channel: "live", records: rows(24),
      transport: { providerJobId: "job-1", fetchedAt: "x", refetched: false },
      payloadHash: "same-hash", expectations: EXP, weights: DEFAULT_WEIGHTS,
      previous: prevSnap, lastHealthy: prevSnap, baseline: BASELINE, canaries: [],
    });
    assert.equal(status, "stale");
  });

  test("QUIET DAY: unchanged payload but a genuinely fresh fetch ⇒ healthy, not stale", () => {
    // StackShare on a slow week. Byte-identical and completely honest.
    const prev = rows(24);
    const prevSnap = snap(prev, "same-hash", "job-1");
    const { status } = validate({
      source: "futurepedia", channel: "live", records: rows(24),
      transport: { providerJobId: "job-2", fetchedAt: "x", refetched: true },
      payloadHash: "same-hash", expectations: EXP, weights: DEFAULT_WEIGHTS,
      previous: prevSnap, lastHealthy: prevSnap, baseline: BASELINE, canaries: [],
    });
    assert.equal(status, "healthy", "a quiet source must not be treated as a fetch failure");
  });

  test("CANARY: a sparse mismatch is a real change, not a heal rejection", () => {
    // The self-inflicted wound: a pinned pricingModel=Free canary would otherwise VETO the
    // very Free→Paid event this product exists to capture.
    const prev = rows(24);
    const curr = rows(24, (i) => (i === 0 ? { attributes: { pricingModel: "Paid", category: CATEGORIES[0]! } } : {}));
    const { status } = run(curr, prev, {
      canaries: [{ entityId: "futurepedia:tool-0", field: "pricingModel", expected: "Free" }],
    });
    assert.equal(status, "healthy");
  });
});

describe("Product Hunt — full daily turnover is normal, not a break", () => {
  const PH_EXP: SourceExpectations = {
    ...EXP, rowRange: [15, 40], watchKeys: ["category"], requiredFields: ["title"],
    presenceCanaries: ["title"], turnover: { lo: 0.9, hi: 1.0 }, overlapWeight: 0,
  };

  test("0% entity overlap ⇒ NOT broken (overlap is disabled for this source)", () => {
    const prev = rows(24);
    const curr = rows(24).map((r, i) => ({
      ...r, nativeId: `new-${i}`, entityId: `futurepedia:new-${i}`, title: `New ${i}`,
    }));
    const { status } = validate({
      source: "producthunt", channel: "live", records: curr,
      transport: TRANSPORT, payloadHash: "h", expectations: PH_EXP, weights: DEFAULT_WEIGHTS,
      previous: snap(prev, "p"), lastHealthy: snap(prev, "p"),
      baseline: { ...BASELINE, replacementSamples: Array(20).fill(0.98) },
      canaries: [],
    });
    assert.notEqual(status, "broken", "full turnover is Product Hunt's normal Tuesday");
  });
});

describe("heal post-verification", () => {
  test("`calibrating` alone is not proof a heal worked", () => {
    // Regression: a heal that left the collector returning ZERO ROWS was marked `active`
    // because the verification run came back `calibrating`. Calibrating means "cannot tell yet".
    const soundness = (status: string, schemaValid: boolean, hard: string[], rows: number) =>
      status === "healthy" || (status === "calibrating" && schemaValid && hard.length === 0 && rows > 0);

    assert.equal(soundness("calibrating", false, ["schema invalid: zero rows extracted"], 0), false);
    assert.equal(soundness("calibrating", true, [], 25), true);
    assert.equal(soundness("healthy", true, [], 25), true);
    assert.equal(soundness("broken", true, ["coverage collapse"], 25), false);
  });
});
