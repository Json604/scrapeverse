/**
 * The status decision.
 *
 * Signals are split into HARD (unary ⇒ broken, numerically defined) and SOFT (need corroboration,
 * or the SAME soft signal on N consecutive runs). An earlier "any two signals" rule both
 * contradicted its own status table and re-opened quiet breakage: a real break that tripped exactly
 * one signal sat in `degraded` forever and never healed.
 */
import type {
  NormalizedRecord, Snapshot, Baseline, SourceId, Channel,
  SnapshotStatus, ExtractionHealth, Diagnosis, SourceExpectations,
} from "../types.ts";
import type { Weights } from "../config.ts";
import { checkSchema, fieldValue } from "./schema.ts";
import { buildEvidence, type CanaryExpectation } from "./evidence.ts";
import { assessFreshness } from "./freshness.ts";
import { entityIds, replacementBand } from "./baseline.ts";
import { jaccard, truncate } from "../util.ts";
import type { TransportMeta } from "../types.ts";

export interface ValidateInput {
  source: SourceId;
  channel: Channel;
  records: NormalizedRecord[];
  transport: TransportMeta;
  payloadHash: string;
  expectations: SourceExpectations;
  weights: Weights;
  previous: Snapshot | null;
  lastHealthy: Snapshot | null;
  baseline: Baseline | null;
  canaries: CanaryExpectation[];
  expectedHost?: string;
  /** Soft signals from the previous N-1 runs. Passed in so validate() stays pure and testable. */
  priorSoftSignals?: string[][];
}

export interface ValidateOutput { health: ExtractionHealth; status: SnapshotStatus; diagnosis: Diagnosis }

export function validate(input: ValidateInput): ValidateOutput {
  const { records, expectations: exp, weights: w, baseline, lastHealthy } = input;
  const n = records.length;

  const schema = checkSchema(records, exp, input.expectedHost);
  const fresh = assessFreshness(input.transport, input.payloadHash, input.previous);
  const ev = buildEvidence(records, lastHealthy?.records ?? null, exp, w, input.canaries, baseline);

  const prevIds = lastHealthy ? entityIds(lastHealthy.records) : null;
  const observedReplacement = prevIds ? 1 - jaccard(entityIds(records), prevIds) : null;

  const hard: string[] = [];
  const soft: string[] = [];

  // ── HARD signals ───────────────────────────────────────────────────────────
  if (!schema.valid) hard.push(`schema invalid: ${schema.problems.join("; ")}`);
  for (const f of exp.requiredFields) {
    const cov = schema.coverage[f] ?? 0;
    if (cov < w.coverageCollapse) hard.push(`coverage collapse on "${f}": ${(cov * 100).toFixed(0)}%`);
  }
  if (ev.presenceMissing >= 2) hard.push(`${ev.presenceMissing} presence canaries missing`);
  // Truncated list: a leaderboard has a stable size, so losing rows beyond the source's own
  // historical variance is extraction loss, not churn. Presence canaries CANNOT catch this —
  // the rows that survive still carry all their fields — and a row count inside rowRange hides it.
  if (baseline && baseline.rowCountMean > 0 && n > 0) {
    const floor = baseline.rowCountMean - Math.max(2, 3 * baseline.rowCountStd);
    if (n < floor) {
      hard.push(`row count ${n} below historical floor ${floor.toFixed(1)} (mean ${baseline.rowCountMean.toFixed(1)}) — truncated list`);
    }
  }
  for (const v of ev.violations) hard.push(v);

  // ── SOFT signals ───────────────────────────────────────────────────────────
  for (const [f, cov] of Object.entries(schema.coverage)) {
    if (cov >= w.coverageCollapse && cov < w.coverageWarn) soft.push(`coverage warn on "${f}": ${(cov * 100).toFixed(0)}%`);
  }
  // Overlap is INFORMATIONAL until the source has enough healthy history to have a real band,
  // and is disabled outright where turnover is by-design total (Product Hunt: overlapWeight 0).
  const band = replacementBand(baseline?.replacementSamples ?? [], w.overlapMinSamples);
  if (observedReplacement !== null && band && exp.overlapWeight > 0 && baseline?.signed) {
    if (observedReplacement > band[1] * 1.25) soft.push(`replacement ${observedReplacement.toFixed(2)} above empirical band [${band[0].toFixed(2)}, ${band[1].toFixed(2)}]`);
  }
  if (baseline && n > 0 && baseline.rowCountMean > 0) {
    const ratio = n / baseline.rowCountMean;
    if (ratio < 0.8 || ratio > 1.25) soft.push(`row count ${n} vs baseline mean ${baseline.rowCountMean.toFixed(1)}`);
  }

  // Same soft signal on N consecutive runs escalates — closes the "one signal, never heals" hole.
  const escalated = escalatingSoftSignals(soft, input.priorSoftSignals ?? [], w.softEscalationRuns);

  const anomalyScore = Math.min(1, hard.length * 0.5 + soft.length * 0.15);
  const health: ExtractionHealth = {
    rowCount: n,
    expectedRowRange: exp.rowRange,
    fieldCoverage: schema.coverage,
    schemaValid: schema.valid,
    observedReplacement,
    evidence: ev.evidence,
    canaryHits: ev.canaryHits,
    canaryMismatches: ev.canaryMismatches,
    presenceCanariesMissing: ev.presenceMissing,
    anomalyScore,
    softSignals: soft,
    hardSignals: hard,
  };

  let status: SnapshotStatus;
  if (fresh.stale) status = "stale";
  else if (!baseline?.signed) status = "calibrating";
  else if (hard.length > 0) status = "broken";
  else if (soft.length >= 2 || escalated.length > 0) status = "broken";
  else if (soft.length === 1) status = "degraded";
  else status = "healthy";

  return { health, status, diagnosis: buildDiagnosis(status, health, ev, baseline, records, w, exp) };
}

function escalatingSoftSignals(current: string[], prior: string[][], runs: number): string[] {
  if (current.length === 0 || runs <= 1) return [];
  if (prior.length < runs - 1) return [];

  // Compare signal KIND (text before the colon), not the full message — the numbers in it vary
  // every run, so exact-string matching would never detect a persistent signal.
  const kind = (x: string) => x.split(":")[0]!.trim();
  const escalated: string[] = [];
  for (const k of new Set(current.map(kind))) {
    if (prior.slice(0, runs - 1).every((p) => p.some((x) => kind(x) === k))) {
      escalated.push(`"${k}" persisted across ${runs} consecutive runs`);
    }
  }
  return escalated;
}

function buildDiagnosis(
  status: SnapshotStatus, health: ExtractionHealth,
  ev: { violations: string[]; mismatchDetail: string[] },
  baseline: Baseline | null, records: NormalizedRecord[], w: Weights,
  exp?: SourceExpectations,
): Diagnosis {
  const brokenFields: Diagnosis["brokenFields"] = [];
  for (const e of health.evidence) {
    const base = baseline?.fieldCoverage[e.field] ?? 1;
    let symptom: "missing" | "misaligned" | "malformed" | "empty" | null = null;
    if (e.coverage === 0) symptom = "empty";
    else if (e.maxConfusion >= w.confusionFlag) symptom = "misaligned";
    else if (e.breadth >= w.breadthStructureMin) symptom = "misaligned";
    else if (e.coverage < base * 0.6) symptom = "missing";
    if (!symptom) continue;

    const sample = records.find((r) => fieldValue(r, e.field) !== null);
    brokenFields.push({
      field: e.field,
      baselineCoverage: base,
      observedCoverage: e.coverage,
      symptom,
      sampleAfter: sample ? truncate(String(fieldValue(sample, e.field)), 40) : undefined,
    });
  }

  const reasons = [...health.hardSignals, ...health.softSignals];
  const totalFields = new Set([...(exp?.watchKeys ?? []), ...(exp?.requiredFields ?? []), "title"]).size;
  return {
    verdict: status, reasons, brokenFields,
    suggestedHealPrompt: renderHealPrompt(brokenFields, w, { rowCount: health.rowCount, totalFields }),
  };
}

/**
 * Hard 1000-char API cap. Truncate SAMPLES first — field names are the load-bearing part.
 *
 * Distinguishes two genuinely different failures:
 *  - total loss (no rows, or every field empty) means the collector is returning the WRONG SHAPE —
 *    asking it to "re-locate the language field" is useless advice;
 *  - partial loss means specific selectors moved, and naming the healthy fields protects them.
 */
export function renderHealPrompt(
  brokenFields: Diagnosis["brokenFields"], w: Weights,
  context?: { rowCount: number; totalFields: number; specFields?: Array<{ name: string; description: string }> },
): string {
  const totalLoss =
    context !== undefined &&
    (context.rowCount === 0 || brokenFields.length >= context.totalFields) &&
    brokenFields.every((b) => b.observedCoverage === 0);

  if (totalLoss) {
    // Name the fields the COLLECTOR knows (its own output schema), not our normalized names —
    // the collector has never heard of `title` if its schema calls that field `repo`.
    const fields = context.specFields?.length
      ? context.specFields.map((f) => `${f.name} (${f.description})`).join("; ")
      : brokenFields.map((b) => b.field).join(", ");
    return truncate(
      `The scraper is returning no usable rows${context.rowCount === 0 ? " at all" : ""}. ` +
      `It should return ONE ROW PER ITEM in the ranking list on the page, not a single row for the page ` +
      `and not a nested array. Each row must contain: ${fields}. ` +
      `Find the repeating list item element on the page and emit one output row for each one.`,
      w.healPromptMaxChars,
    );
  }

  if (brokenFields.length === 0) return "";

  const parts = brokenFields.map((b) => {
    const what =
      b.symptom === "misaligned" ? `is returning the wrong column (now reads like a different field${b.sampleAfter ? `, e.g. "${b.sampleAfter}"` : ""})`
      : b.symptom === "empty" ? "returns nothing on every row"
      : b.symptom === "malformed" ? "returns values in an unexpected shape"
      : `is missing on most rows (coverage fell to ${(b.observedCoverage * 100).toFixed(0)}%)`;
    return `The "${b.field}" field ${what}.`;
  });

  // Only claim other fields are fine when some actually are.
  const someHealthy = context === undefined || brokenFields.length < context.totalFields;
  const tail = someHealthy ? " Other fields still extract correctly; do not change them." : "";
  let prompt = `${parts.join(" ")} Re-locate them and return the correct values.${tail}`;

  if (prompt.length > w.healPromptMaxChars) {
    const terse = brokenFields.map((b) => `"${b.field}" (${b.symptom})`).join(", ");
    prompt = truncate(`Re-locate these fields, which no longer extract correctly: ${terse}.${tail}`, w.healPromptMaxChars);
  }
  return prompt;
}
