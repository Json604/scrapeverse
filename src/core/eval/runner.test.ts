import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildFixtureCases, runEval, syntheticBaseline, resolveEvalSets } from "./runner.ts";
import { getAdapter } from "../sources/index.ts";
import { DEFAULT_WEIGHTS } from "../config.ts";

describe("resolveEvalSets", () => {
  test("rejects unknown set names instead of reporting n=0 precision 1.000", () => {
    assert.throws(() => resolveEvalSets("nope"), /unknown set/);
  });
  test("rejects unshipped wayback / live-shadow rather than silently scoring empty", () => {
    assert.throws(() => resolveEvalSets("wayback"), /not shipped/);
  });
});

describe("syntheticBaseline matches the source under evaluation", () => {
  test("github_trending CHANGE operators are not classified BREAK because of missing metrics", () => {
    const adapter = getAdapter("github_trending");
    const records = syntheticBaseline({
      source: adapter.id,
      entityType: adapter.entityType,
      targetUrl: adapter.targetUrl,
      expectations: adapter.expectations,
    });
    const field = adapter.expectations.watchKeys[0]!;
    const cases = buildFixtureCases(records, field);
    const tuning = runEval(cases, adapter.expectations, "fixture-tuning", DEFAULT_WEIGHTS);
    const held = runEval(cases, adapter.expectations, "fixture-heldout", DEFAULT_WEIGHTS);

    const falseBreaks = [...tuning.cases, ...held.cases]
      .filter((c) => c.truth === "CHANGE" && c.predicted === "BREAK");
    assert.equal(
      falseBreaks.length,
      0,
      falseBreaks.map((c) => `${c.name} (${c.status})`).join("; "),
    );
  });

  test("futurepedia regression suite still scores 1.000 / 1.000", () => {
    const adapter = getAdapter("futurepedia");
    const records = syntheticBaseline({
      source: adapter.id,
      entityType: adapter.entityType,
      targetUrl: adapter.targetUrl,
      expectations: adapter.expectations,
    });
    const field = adapter.expectations.watchKeys[0]!;
    const cases = buildFixtureCases(records, field);
    const tuning = runEval(cases, adapter.expectations, "fixture-tuning", DEFAULT_WEIGHTS);
    assert.equal(tuning.precisionBreak, 1);
    assert.equal(tuning.recallBreak, 1);
    assert.ok(tuning.cases.every((c) => c.correct));
  });
});
