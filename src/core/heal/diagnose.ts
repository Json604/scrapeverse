import type { Diagnosis, Snapshot } from "../types.ts";
import { getAdapter } from "../sources/index.ts";
import { loadWeights } from "../config.ts";
import { renderHealPrompt } from "../validate/index.ts";

/** Rebuild the heal prompt from the snapshot the gate already classified as broken. */
export function diagnosisFromSnapshot(snapshot: Snapshot): Diagnosis {
  const diagnosis: Diagnosis = {
    verdict: snapshot.status,
    reasons: [...snapshot.health.hardSignals, ...snapshot.health.softSignals],
    brokenFields: snapshot.health.evidence
      .filter((e) => e.coverage < 0.9 || e.maxConfusion >= 0.6 || e.breadth >= 0.6)
      .map((e) => ({
        field: e.field,
        baselineCoverage: 1,
        observedCoverage: e.coverage,
        symptom: (e.coverage === 0 ? "empty" : e.maxConfusion >= 0.6 || e.breadth >= 0.6 ? "misaligned" : "missing") as
          "empty" | "misaligned" | "missing",
      })),
    suggestedHealPrompt: "",
  };
  const adapter = getAdapter(snapshot.source);
  const exp = adapter.expectations;
  diagnosis.suggestedHealPrompt = renderHealPrompt(diagnosis.brokenFields, loadWeights(), {
    rowCount: snapshot.records.length,
    totalFields: new Set([...exp.watchKeys, ...exp.requiredFields, "title"]).size,
    specFields: adapter.spec.fields.map((f) => ({ name: f.name, description: f.description })),
  });
  return diagnosis;
}
