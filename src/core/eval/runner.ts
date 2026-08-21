/**
 * Measure the classifier.
 *
 * Reports a MULTICLASS matrix (the case set contains STALE and UNKNOWN, which a 2×2 cannot hold),
 * and keeps `fixture` / `wayback` / `live-shadow` sets SEPARATE. Pooling them would let a
 * self-tuned fixture score inflate the headline number.
 */
import type { NormalizedRecord, SourceExpectations, Baseline, Snapshot, TransportMeta } from "../types.ts";
import { validate } from "../validate/index.ts";
import { DEFAULT_WEIGHTS, type Weights } from "../config.ts";
import { TUNING, HELD_OUT, type MutationOperator, type TruthLabel } from "../fixtures/mutate.ts";

export type EvalSet = "fixture-tuning" | "fixture-heldout" | "wayback" | "live-shadow";
export type Predicted = "BREAK" | "CHANGE" | "STALE" | "UNKNOWN";

export interface EvalCase {
  name: string;
  set: EvalSet;
  truth: TruthLabel;
  baseline: NormalizedRecord[];
  observed: NormalizedRecord[];
  ambiguous?: boolean;
}

export interface EvalResult {
  set: EvalSet;
  matrix: Record<TruthLabel, Record<Predicted, number>>;
  cases: Array<{ name: string; truth: TruthLabel; predicted: Predicted; status: string; correct: boolean }>;
  n: number;
  excluded: number;
  precisionBreak: number;
  recallBreak: number;
}

function emptyMatrix(): Record<TruthLabel, Record<Predicted, number>> {
  const row = (): Record<Predicted, number> => ({ BREAK: 0, CHANGE: 0, STALE: 0, UNKNOWN: 0 });
  return { BREAK: row(), CHANGE: row(), STALE: row(), UNKNOWN: row() };
}

function statusToPrediction(status: string): Predicted {
  if (status === "broken") return "BREAK";
  if (status === "stale") return "STALE";
  if (status === "calibrating") return "UNKNOWN";
  return "CHANGE";     // healthy and degraded both mean "the data moved, extraction is fine"
}

const TRANSPORT: TransportMeta = { providerJobId: "eval-new", fetchedAt: "2026-08-21T00:00:00Z", refetched: true };

function asSnapshot(records: NormalizedRecord[], source: string): Snapshot {
  return {
    snapshotId: "eval_prev", runId: "eval_prev", source: source as Snapshot["source"], channel: "live",
    capturedAt: "2026-08-20T00:00:00.000Z", ingestedAt: "2026-08-20T00:00:00.000Z",
    prevSnapshotId: null, comparisonSnapshotId: null, records, status: "healthy",
    health: {
      rowCount: records.length, expectedRowRange: [1, 999], fieldCoverage: {}, schemaValid: true,
      observedReplacement: 0, evidence: [], canaryHits: 0, canaryMismatches: 0,
      presenceCanariesMissing: 0, anomalyScore: 0, softSignals: [], hardSignals: [],
    },
    provenance: {
      collectorId: "eval", collectorVersion: "eval", specVersion: 1, inputUrl: "eval://",
      baselineVersion: 1, rawRef: null, payloadHash: "prev",
      transport: { providerJobId: "eval-old", fetchedAt: "2026-08-20T00:00:00Z", refetched: true },
    },
  };
}

export function runEval(
  cases: EvalCase[], exp: SourceExpectations, set: EvalSet, weights: Weights = DEFAULT_WEIGHTS,
): EvalResult {
  const matrix = emptyMatrix();
  const rows: EvalResult["cases"] = [];
  let excluded = 0;

  for (const kase of cases.filter((k) => k.set === set)) {
    if (kase.ambiguous) { excluded++; continue; }

    const prev = asSnapshot(kase.baseline, kase.baseline[0]?.source ?? "futurepedia");
    const baseline: Baseline = {
      source: prev.source, channel: "live", version: 1, signed: true, signedKeys: exp.watchKeys,
      rowCountMean: kase.baseline.length, rowCountStd: 0.3,
      fieldCoverage: Object.fromEntries(exp.watchKeys.map((k) => [k, 1])),
      vocabularies: {}, replacementSamples: [], healthySnapshotIds: [],
      updatedAt: "2026-08-20T00:00:00.000Z",
    };

    const { status } = validate({
      source: prev.source, channel: "live", records: kase.observed,
      transport: TRANSPORT, payloadHash: `h_${kase.name}`,
      expectations: exp, weights, previous: prev, lastHealthy: prev, baseline, canaries: [],
    });

    const predicted = statusToPrediction(status);
    matrix[kase.truth][predicted]++;
    rows.push({ name: kase.name, truth: kase.truth, predicted, status, correct: predicted === kase.truth });
  }

  const tp = matrix.BREAK.BREAK;
  const fp = matrix.CHANGE.BREAK + matrix.STALE.BREAK + matrix.UNKNOWN.BREAK;
  const fn = matrix.BREAK.CHANGE + matrix.BREAK.STALE + matrix.BREAK.UNKNOWN;

  return {
    set, matrix, cases: rows, n: rows.length, excluded,
    precisionBreak: tp + fp === 0 ? 1 : tp / (tp + fp),
    recallBreak: tp + fn === 0 ? 1 : tp / (tp + fn),
  };
}

export function buildFixtureCases(
  baseline: NormalizedRecord[], field: string,
): EvalCase[] {
  const mk = (ops: MutationOperator[], set: EvalSet): EvalCase[] =>
    ops.map((op) => ({
      name: op.name, set, truth: op.truth, baseline,
      observed: op.apply(baseline, field),
    }));
  return [...mk(TUNING, "fixture-tuning"), ...mk(HELD_OUT, "fixture-heldout")];
}
