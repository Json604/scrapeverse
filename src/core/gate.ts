/**
 * The branch that makes this a product rather than a differ.
 *
 * `degraded` output goes to QUARANTINE, never to the event stream. An earlier draft emitted
 * degraded events at confidence 0.5, which published exactly where the system was least certain —
 * halving a number does not make a false ENTERED/LEFT storm true.
 */
import type { Snapshot, ChangeEvent, CandidateChange, SourceExpectations } from "./types.ts";
import { diffSnapshots } from "./diff.ts";
import { collections } from "./db.ts";
import type { Weights } from "./config.ts";

export type GateAction = "store_only" | "heal" | "quarantine" | "emit";

export interface GateResult {
  action: GateAction;
  events: ChangeEvent[];
  candidates: CandidateChange[];
  reason: string;
}

export async function gate(
  curr: Snapshot, lastHealthy: Snapshot | null,
  exp: SourceExpectations, gapCount: number, weights: Weights, runOrdinal: number,
): Promise<GateResult> {
  switch (curr.status) {
    case "stale":
      return { action: "store_only", events: [], candidates: [], reason: "stale fetch — no diff, no baseline update" };
    case "calibrating":
      return { action: "store_only", events: [], candidates: [], reason: "calibrating — emit nothing until baseline is signed" };
    case "broken":
      // NEVER emit. A broken extraction diffed against a healthy one produces exactly the
      // full-table ENTERED/LEFT storm this project exists to suppress.
      return { action: "heal", events: [], candidates: [], reason: `broken: ${curr.health.hardSignals[0] ?? "hard signal"}` };
    case "degraded": {
      if (!lastHealthy) return { action: "store_only", events: [], candidates: [], reason: "degraded with no healthy baseline to diff against" };
      const raw = diffSnapshots(lastHealthy, curr, exp, gapCount, 0.5);
      const candidates: CandidateChange[] = raw.map((e) => ({
        ...e, promotedBy: null, observedRuns: 1, expiresAfterRun: runOrdinal + weights.candidateTtlRuns,
      }));
      return { action: "quarantine", events: [], candidates, reason: `degraded: ${curr.health.softSignals[0] ?? "soft signal"}` };
    }
    case "healthy": {
      if (!lastHealthy) return { action: "store_only", events: [], candidates: [], reason: "first healthy snapshot — nothing to diff against" };
      return { action: "emit", events: diffSnapshots(lastHealthy, curr, exp, gapCount, 1), candidates: [], reason: "healthy" };
    }
  }
}

/**
 * On the next healthy snapshot, discard quarantined candidates that the real diff reproduces.
 * Without this the same logical change reaches the stream twice under two different event ids.
 */
export async function reconcileCandidates(
  source: string, channel: string, emitted: ChangeEvent[], runOrdinal: number,
): Promise<{ discarded: number; expired: number }> {
  const c = await collections();
  const key = (e: { entityId: string; changeType: string; field?: string; from: unknown; to: unknown }) =>
    `${e.entityId}|${e.changeType}|${e.field ?? ""}|${String(e.from)}|${String(e.to)}`;
  const emittedKeys = new Set(emitted.map(key));

  const pending = await c.candidates.find({ source, channel, promotedBy: null } as Record<string, unknown>).toArray();
  const subsumed = pending.filter((p) => emittedKeys.has(key(p))).map((p) => p.eventId);
  if (subsumed.length) await c.candidates.deleteMany({ eventId: { $in: subsumed } } as Record<string, unknown>);

  const expired = await c.candidates.deleteMany({
    source, channel, promotedBy: null, expiresAfterRun: { $lt: runOrdinal },
  } as Record<string, unknown>);

  return { discarded: subsumed.length, expired: expired.deletedCount ?? 0 };
}
