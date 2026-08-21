import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMongoUri, DEFAULT_WEIGHTS } from "./config.ts";

test("normalizeMongoUri appends a database when Atlas omits one", () => {
  const out = normalizeMongoUri("mongodb+srv://u:p@c0.abc.mongodb.net");
  assert.match(out, /\/driftwatch\?/);
  assert.match(out, /retryWrites=true/);
  assert.match(out, /w=majority/);
});

test("normalizeMongoUri preserves an explicit database and options", () => {
  const out = normalizeMongoUri("mongodb+srv://u:p@h/mydb?w=1");
  assert.match(out, /\/mydb\?/);
  assert.match(out, /w=1/);
  assert.doesNotMatch(out, /w=majority/);
});

test("normalizeMongoUri rejects garbage rather than silently connecting nowhere", () => {
  assert.throws(() => normalizeMongoUri("not-a-uri"), /not a valid URI/);
});

test("weights version is explicitly marked uncalibrated", () => {
  // Guards against quoting default thresholds as if they were fit from data.
  assert.match(DEFAULT_WEIGHTS.version, /uncalibrated/);
  assert.ok(DEFAULT_WEIGHTS.breadthContentMax < DEFAULT_WEIGHTS.breadthStructureMin);
  assert.equal(DEFAULT_WEIGHTS.healPromptMaxChars, 1000);
});
