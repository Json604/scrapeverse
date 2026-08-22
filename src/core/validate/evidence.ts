/**
 * Evidence that a field still MEANS that field.
 *
 * This layer exists because the rest of the validator is circular: the same signals that flag a
 * break would certify its heal. Two earlier designs died here.
 *
 *  1. Set-subset "vocabulary disjointness" was defeated by a drift onto an UNTRACKED sibling column
 *     (`pricingModel` → a `deployment` chip of {Cloud, API, Self-hosted}). Not a subset of any
 *     tracked vocabulary, so the open-enum rule classified it as a content change and failed open.
 *  2. Pinned live canaries with expected values would REJECT the money demo — a genuine
 *     `Free → Paid` flip is, definitionally, a canary mismatch.
 *
 * `breadth` solves both. It needs no vocabulary at all, and it distinguishes the two cases by the
 * only property that actually differs: a real attribute change is SPARSE, a selector drift is
 * UNIVERSAL. One tool flipping to Paid is 1/40. A drifted column is 40/40.
 */
import type { NormalizedRecord, FieldEvidence, Baseline, SourceExpectations } from "../types.ts";
import { fieldValue } from "./schema.ts";
import type { Weights } from "../config.ts";

export interface CanaryExpectation { entityId: string; field: string; expected: string | number | null }

export interface EvidenceReport {
  evidence: FieldEvidence[];
  canaryHits: number;
  canaryMismatches: number;
  mismatchDetail: string[];
  presenceMissing: number;
  violations: string[];
}

function indexBy(records: NormalizedRecord[]): Map<string, NormalizedRecord> {
  return new Map(records.map((r) => [r.entityId, r]));
}

/** Fraction of entities present in BOTH snapshots whose value for `field` changed. */
export function changeBreadth(
  curr: NormalizedRecord[], prev: NormalizedRecord[], field: string,
): { breadth: number; persisting: number } {
  const p = indexBy(prev);
  let persisting = 0, changed = 0;
  for (const r of curr) {
    const before = p.get(r.entityId);
    if (!before) continue;
    persisting++;
    if (String(fieldValue(r, field) ?? "") !== String(fieldValue(before, field) ?? "")) changed++;
  }
  return { breadth: persisting === 0 ? 0 : changed / persisting, persisting };
}

/**
 * Row-wise agreement between field F now and field G before, per entity.
 * Set-overlap cannot see a MIXED read (some rows drifted, some correct); per-row can.
 */
export function fieldConfusion(
  curr: NormalizedRecord[], prev: NormalizedRecord[], f: string, g: string,
): number {
  const p = indexBy(prev);
  let compared = 0, agree = 0;
  for (const r of curr) {
    const before = p.get(r.entityId);
    if (!before) continue;
    const a = fieldValue(r, f), b = fieldValue(before, g);
    if (a === null || b === null) continue;
    compared++;
    if (String(a) === String(b)) agree++;
  }
  return compared === 0 ? 0 : agree / compared;
}

export function buildEvidence(
  curr: NormalizedRecord[],
  prev: NormalizedRecord[] | null,
  exp: SourceExpectations,
  weights: Weights,
  canaries: CanaryExpectation[],
  baseline: Baseline | null,
): EvidenceReport {
  const evidence: FieldEvidence[] = [];
  const violations: string[] = [];
  const n = curr.length;

  const allFields = new Set<string>([...exp.watchKeys, ...exp.requiredFields, "title"]);
  const comparableFields = [...allFields];

  for (const field of allFields) {
    const filled = curr.filter((r) => fieldValue(r, field) !== null).length;
    const coverage = n === 0 ? 0 : filled / n;
    const distinct = new Set(curr.map((r) => String(fieldValue(r, field) ?? ""))).size;

    let breadth = 0, maxConfusion = 0, confusedWith: string | null = null;
    if (prev && prev.length) {
      breadth = changeBreadth(curr, prev, field).breadth;
      for (const other of comparableFields) {
        if (other === field) continue;
        const c = fieldConfusion(curr, prev, field, other);
        if (c > maxConfusion) { maxConfusion = c; confusedWith = other; }
      }
    }

    evidence.push({ field, coverage, breadth, maxConfusion, confusedWith, distinctCount: distinct });

    // Breadth-as-structure applies to watch keys (columns). Required metrics like HN
    // points or GH stars move on most rows on a busy page — that is content, not a break.
    if (exp.watchKeys.includes(field) && breadth >= weights.breadthStructureMin) {
      violations.push(
        `field "${field}" changed on ${(breadth * 100).toFixed(0)}% of persisting rows — ` +
        `universal change indicates structure, not content`,
      );
    }
    if (maxConfusion >= weights.confusionFlag && confusedWith) {
      violations.push(`field "${field}" now matches previous "${confusedWith}" on ${(maxConfusion * 100).toFixed(0)}% of rows — selector drift`);
    }
    // An "enum" with ~one distinct value per row is no longer an enum.
    if (baseline?.vocabularies[field] && n >= 10) {
      const baseDistinct = baseline.vocabularies[field]!.length;
      if (baseDistinct > 0 && baseDistinct <= 8 && distinct > Math.max(8, baseDistinct * 4)) {
        violations.push(`field "${field}" distinct values jumped ${baseDistinct} → ${distinct}; no longer enum-shaped`);
      }
    }
  }

  // ── canaries ───────────────────────────────────────────────────────────────
  // A canary MISS only means something where turnover is low. On a rotating list the pinned entity
  // is simply gone, which is normal and must never read as a break.
  const byId = indexBy(curr);
  const canaryMeaningful = exp.turnover.hi <= 0.1;
  let hits = 0, mismatches = 0;
  const mismatchDetail: string[] = [];

  for (const c of canaries) {
    const rec = byId.get(c.entityId);
    if (!rec) {
      if (canaryMeaningful) violations.push(`canary ${c.entityId} absent from a low-turnover source`);
      continue;
    }
    hits++;
    const actual = fieldValue(rec, c.field);
    if (String(actual ?? "") !== String(c.expected ?? "")) {
      mismatches++;
      mismatchDetail.push(`${c.entityId}.${c.field}: expected "${c.expected}" got "${actual}"`);
    }
  }

  // A canary mismatch is only a VIOLATION when the same field moved universally. Sparse mismatch
  // is exactly what a real content change looks like — that is the product, not a fault.
  for (const d of mismatchDetail) {
    const field = d.split(".")[1]?.split(":")[0] ?? "";
    const ev = evidence.find((e) => e.field === field);
    if (ev && ev.breadth >= weights.breadthStructureMin) {
      violations.push(`canary mismatch on "${field}" coincides with universal change — heal produced wrong field`);
    }
  }

  // ── presence canaries: always-on structural slots ──────────────────────────
  // This is what catches a PARTIAL list, which row-count ranges let through.
  let presenceMissing = 0;
  for (const slot of exp.presenceCanaries) {
    const present = curr.filter((r) => fieldValue(r, slot) !== null).length;
    if (n === 0 || present / n < 0.5) presenceMissing++;
  }
  if (presenceMissing >= 2) violations.push(`${presenceMissing} presence canaries missing — structural slots gone`);

  return { evidence, canaryHits: hits, canaryMismatches: mismatches, mismatchDetail, presenceMissing, violations };
}
