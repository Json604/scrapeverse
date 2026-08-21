/** The loop: fetch → normalize → validate → gate → store. */
import type { Channel, Snapshot, SourceId } from "./types.ts";
import type { ExtractionBackend } from "./backend/types.ts";
import { getAdapter } from "./sources/index.ts";
import { validate } from "./validate/index.ts";
import { getBaseline, recomputeBaseline } from "./validate/baseline.ts";
import { gate, reconcileCandidates, type GateResult } from "./gate.ts";
import {
  saveSnapshot, lastSnapshot, lastHealthySnapshot, countGap, payloadHash,
} from "./store/snapshots.ts";
import { collections } from "./db.ts";
import { uuid, nowIso, shortHash } from "./util.ts";
import { loadWeights } from "./config.ts";
import { stripPii } from "./sources/types.ts";
import { expectationsFor } from "./sources/expectations.ts";

export interface RunOptions {
  source: SourceId;
  channel?: Channel;
  collectorId: string;
  backend: ExtractionBackend;
  url?: string;
  runId?: string;
  capturedAt?: string;
  storeRaw?: boolean;
}

export interface RunResult {
  snapshot: Snapshot;
  gate: GateResult;
  inserted: boolean;
  eventsWritten: number;
  candidatesWritten: number;
  reconciled: { discarded: number; expired: number };
}

export async function runSource(opts: RunOptions): Promise<RunResult> {
  const adapter = getAdapter(opts.source);
  const channel: Channel = opts.channel ?? "live";
  const weights = loadWeights();
  const url = opts.url ?? adapter.targetUrl;

  const fetched = await opts.backend.fetch({ collectorId: opts.collectorId, url });
  const capturedAt = opts.capturedAt ?? nowIso();
  const records = adapter.normalize(stripPii(fetched.rows), capturedAt);
  const hash = payloadHash(records);

  const c = await collections();
  const [previous, lastHealthy, baseline] = await Promise.all([
    lastSnapshot(opts.source, channel),
    lastHealthySnapshot(opts.source, channel),
    getBaseline(opts.source, channel),
  ]);
  const canaries = await c.canaries.find({ source: opts.source, channel } as Record<string, unknown>).toArray();
  const expectations = expectationsFor(adapter.expectations, channel, baseline);

  const priorRuns = await c.snapshots
    .find({ source: opts.source, channel } as Record<string, unknown>)
    .sort({ capturedAt: -1 }).limit(weights.softEscalationRuns - 1).toArray();

  const { health, status, diagnosis } = validate({
    source: opts.source, channel, records,
    transport: fetched.transport, payloadHash: hash,
    expectations, weights,
    previous, lastHealthy, baseline,
    canaries: canaries.map((x) => ({ entityId: x.entityId, field: x.field, expected: x.expected })),
    expectedHost: safeHost(adapter.targetUrl),
    priorSoftSignals: priorRuns.map((r) => r.health.softSignals),
  });

  const runId = opts.runId ?? `run_${shortHash(`${opts.source}|${channel}|${capturedAt}`, 16)}`;
  const snapshot: Snapshot = {
    snapshotId: `snap_${uuid()}`,
    runId, source: opts.source, channel,
    capturedAt, ingestedAt: nowIso(),
    prevSnapshotId: previous?.snapshotId ?? null,
    comparisonSnapshotId: lastHealthy?.snapshotId ?? null,
    records, health, status,
    provenance: {
      collectorId: fetched.collectorId,
      collectorVersion: fetched.collectorVersion,
      specVersion: adapter.spec.version,
      inputUrl: fetched.inputUrl,
      baselineVersion: baseline?.version ?? 0,
      rawRef: opts.storeRaw === false ? null : `raw_${runId}`,
      payloadHash: hash,
      transport: fetched.transport,
    },
  };

  const runOrdinal = await c.snapshots.countDocuments({ source: opts.source, channel } as Record<string, unknown>);
  const gapCount = lastHealthy ? await countGap(opts.source, channel, lastHealthy.capturedAt, capturedAt) : 0;
  const g = await gate(snapshot, lastHealthy, expectations, gapCount, weights, runOrdinal);

  const saved = await saveSnapshot(snapshot, {
    events: g.events, candidates: g.candidates,
    ...(opts.storeRaw === false ? {} : { raw: fetched.raw }),
  });

  let reconciled = { discarded: 0, expired: 0 };
  if (g.action === "emit") {
    reconciled = await reconcileCandidates(opts.source, channel, g.events, runOrdinal);
    await recomputeBaseline(opts.source, channel, expectations, weights.baselineWindow);
  }

  // Diagnosis is only interesting when something is wrong; keep it off the happy path.
  if (status === "broken") snapshot.health.hardSignals = diagnosis.reasons;

  return {
    snapshot, gate: g, inserted: saved.inserted,
    eventsWritten: saved.events, candidatesWritten: saved.candidates, reconciled,
  };
}

function safeHost(url: string): string | undefined {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return undefined; }
}
