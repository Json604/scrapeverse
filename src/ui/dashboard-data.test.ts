import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeEvent, NormalizedRecord, Snapshot } from "../core/types.ts";
import { buildDashboardData } from "./dashboard-data.ts";

function record(source: NormalizedRecord["source"], title: string, rank = 1): NormalizedRecord {
  return {
    source,
    entityType: source === "hackernews" ? "story" : "repo",
    nativeId: title,
    entityId: `${source}:${title}`,
    title,
    url: "https://example.com",
    canonicalUrl: "https://example.com",
    rank,
    metrics: source === "hackernews"
      ? { points: { name: "points", value: 142, unit: "total" } }
      : { starsToday: { name: "starsToday", value: 1544, unit: "today" } },
    attributes: source === "github_trending" ? { language: "Rust" } : {},
    capturedAt: "2026-08-23T13:00:00.000Z",
  };
}

function snapshot(source: Snapshot["source"], status: Snapshot["status"], records: NormalizedRecord[]): Snapshot {
  return {
    snapshotId: `snap-${source}-${status}`,
    runId: `run-${source}-${status}`,
    source,
    channel: "live",
    capturedAt: "2026-08-23T13:00:00.000Z",
    ingestedAt: "2026-08-23T13:00:01.000Z",
    prevSnapshotId: null,
    comparisonSnapshotId: null,
    records,
    status,
    health: {
      rowCount: records.length,
      expectedRowRange: [1, 100],
      fieldCoverage: {},
      schemaValid: true,
      observedReplacement: 0,
      evidence: [],
      canaryHits: 0,
      canaryMismatches: 0,
      presenceCanariesMissing: 0,
      anomalyScore: 0,
      softSignals: [],
      hardSignals: [],
    },
    provenance: {
      collectorId: "collector",
      collectorVersion: "1",
      specVersion: 1,
      inputUrl: "https://example.com",
      baselineVersion: 1,
      rawRef: null,
      payloadHash: "hash",
      transport: { providerJobId: null, fetchedAt: "2026-08-23T13:00:00.000Z", refetched: true },
    },
  };
}

function event(changeType: ChangeEvent["changeType"], source: ChangeEvent["source"] = "hackernews"): ChangeEvent {
  return {
    eventId: `${source}-${changeType}`,
    source,
    channel: "live",
    entityId: `${source}:entity`,
    entityTitle: "Real entity",
    changeType,
    ...(changeType.startsWith("RANK_") ? { field: "rank", delta: 4 } : {}),
    from: changeType === "ENTERED" ? null : 5,
    to: 1,
    fromSnapshot: "old",
    toSnapshot: `snap-${source}-healthy`,
    intervalStart: "2026-08-23T07:00:00.000Z",
    intervalEnd: "2026-08-23T13:00:00.000Z",
    gapCount: 0,
    confidence: 1,
  };
}

test("buildDashboardData projects live events without inventing unsupported LEFT rows", () => {
  const data = buildDashboardData({
    events: [event("ENTERED"), event("RANK_UP", "github_trending"), event("LEFT")],
    latestSnapshots: [snapshot("hackernews", "healthy", [record("hackernews", "entity")])],
    trustedSnapshots: [snapshot("hackernews", "healthy", [record("hackernews", "entity")])],
    eventCountsBySnapshot: { "snap-hackernews-healthy": 2 },
  }, new Date("2026-08-23T14:00:00.000Z"));

  assert.deepEqual(data.events.map((item) => item.kind), ["entered", "moved"]);
  assert.equal(data.events[0]?.entity, "Real entity");
  assert.equal(data.events[0]?.source, "Hacker News");
  assert.equal(data.events[0]?.observed, "1 hr ago");
  assert.equal(data.events[0]?.entityId, "hackernews:entity");
  assert.equal(data.events[0]?.url, "https://example.com");
});

test("buildDashboardData uses latest health for trust and latest healthy records for boards", () => {
  const latestBroken = snapshot("github_trending", "broken", []);
  const trusted = snapshot("github_trending", "healthy", [record("github_trending", "openai/codex")]);
  const data = buildDashboardData({
    events: [],
    latestSnapshots: [latestBroken],
    trustedSnapshots: [trusted],
    eventCountsBySnapshot: {},
  }, new Date("2026-08-23T14:00:00.000Z"));

  assert.equal(data.sources.find((source) => source.id === "github_trending")?.status, "broken");
  assert.equal(data.boards.find((board) => board.sourceId === "github_trending")?.title, "openai/codex");
  assert.equal(data.boards.find((board) => board.sourceId === "github_trending")?.source, "GitHub Trending");
  assert.equal(data.boards.find((board) => board.sourceId === "github_trending")?.url, "https://example.com");
  assert.match(data.boards.find((board) => board.sourceId === "github_trending")?.detail ?? "", /Rust/);
  assert.equal(data.rankings[0]?.items[0]?.title, "openai/codex");
  assert.equal(data.rankings[0]?.items[0]?.url, "https://example.com");
});

test("a healthy source with no latest-snapshot events is explicitly quiet", () => {
  const healthy = snapshot("stackshare", "healthy", [record("stackshare", "PostgreSQL")]);
  const data = buildDashboardData({
    events: [], latestSnapshots: [healthy], trustedSnapshots: [healthy], eventCountsBySnapshot: {},
  }, new Date("2026-08-23T14:00:00.000Z"));

  assert.equal(data.sources.find((source) => source.id === "stackshare")?.status, "quiet");
});
