import type { Command } from "commander";
import {
  runEval, buildFixtureCases, syntheticBaseline, resolveEvalSets, type EvalResult,
} from "../../core/eval/runner.ts";
import { getAdapter } from "../../core/sources/index.ts";
import { loadWeights } from "../../core/config.ts";

function renderMatrix(r: EvalResult): void {
  const labels = ["BREAK", "CHANGE", "STALE", "UNKNOWN"] as const;
  const used = labels.filter((t) => labels.some((p) => r.matrix[t][p] > 0));
  console.log(`\n  set: ${r.set}   n=${r.n}   excluded(ambiguous)=${r.excluded}`);
  console.log(`  ${"".padEnd(12)}${labels.map((l) => `pred:${l}`.padEnd(13)).join("")}`);
  for (const t of used) {
    console.log(`  ${`true:${t}`.padEnd(12)}${labels.map((p) => String(r.matrix[t][p]).padEnd(13)).join("")}`);
  }
  console.log(`  precision(BREAK) ${r.precisionBreak.toFixed(3)}   recall(BREAK) ${r.recallBreak.toFixed(3)}`);
  const wrong = r.cases.filter((c) => !c.correct);
  if (wrong.length) {
    console.log(`\n  misclassified:`);
    for (const c of wrong) console.log(`    ${c.name.padEnd(26)} truth=${c.truth.padEnd(8)} predicted=${c.predicted} (status ${c.status})`);
  }
}

export function registerEval(program: Command): void {
  program
    .command("eval")
    .description("Measure break-vs-change classification against labeled sets")
    .option("--source <source>", "source whose expectations to evaluate under", "futurepedia")
    .option("--set <set>", "fixture-tuning | fixture-heldout | all", "all")
    .option("--json", "machine-readable output")
    .action(async (opts: { source: string; set: string; json?: boolean }) => {
      const adapter = getAdapter(opts.source);
      const weights = loadWeights();
      const baseline = syntheticBaseline({
        source: adapter.id,
        entityType: adapter.entityType,
        targetUrl: adapter.targetUrl,
        expectations: adapter.expectations,
      });
      const field = adapter.expectations.watchKeys[0];
      if (!field) {
        throw new Error(
          `"${opts.source}" has no watchKeys — attribute-mutation eval is not meaningful for this source. ` +
          `Try futurepedia, github_trending, or tech_radar.`,
        );
      }
      const cases = buildFixtureCases(baseline, field);
      const sets = resolveEvalSets(opts.set);
      const results = sets.map((s) => runEval(cases, adapter.expectations, s, weights));

      if (opts.json) { console.log(JSON.stringify({ weights: weights.version, results }, null, 2)); return; }

      console.log(`\n  driftwatch eval  ·  ${opts.source}  ·  weights ${weights.version}`);
      console.log(`  ${"─".repeat(66)}`);
      for (const r of results) renderMatrix(r);
      console.log(`\n  NOTE: fixture sets are a REGRESSION SUITE, not a generalization claim.`);
      console.log(`  A headline accuracy number requires the wayback / live-shadow sets.\n`);
    });
}
