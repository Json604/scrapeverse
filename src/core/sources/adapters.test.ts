import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allAdapters } from "./index.ts";
import { fieldValue } from "../validate/schema.ts";
import type { RawRow } from "../backend/types.ts";

/**
 * Guards a whole class of bug: `requiredFields` / `watchKeys` / `presenceCanaries` are resolved
 * against NORMALIZED records by fieldValue(), but it is easy to write them using the raw spec
 * field names instead. That mismatch makes a perfectly healthy page report 0% coverage and
 * classify as broken — which is exactly what happened to github_trending on real archived data.
 */
describe("adapter expectations reference resolvable fields", () => {
  for (const a of allAdapters()) {
    test(`${a.id}: every declared field resolves on a synthetic record`, () => {
      const raw: RawRow = Object.fromEntries(
        a.spec.fields.map((f) => [f.name, f.type === "number" ? 42 : f.name === "url" ? `${a.targetUrl}/x` : "sample"]),
      );
      // Give the adapter something it can build an id from.
      raw["repo"] = "owner/name"; raw["modelId"] = "org/model"; raw["itemId"] = "12345";
      raw["url"] = `${a.targetUrl.replace(/\/$/, "")}/tool/sample`;

      const records = a.normalize([raw], "2026-08-21T00:00:00.000Z");
      assert.ok(records.length === 1, `${a.id} normalized 0 records from a full raw row`);

      const declared = [...new Set([
        ...a.expectations.requiredFields,
        ...a.expectations.watchKeys,
        ...a.expectations.presenceCanaries,
      ])];
      const unresolvable = declared.filter((f) => fieldValue(records[0]!, f) === null);
      assert.deepEqual(unresolvable, [], `${a.id}: fields never resolve on normalized records: ${unresolvable.join(", ")}`);
    });

    test(`${a.id}: nativeId never embeds a personal identifier field`, () => {
      const personal = ["author", "by", "maker", "hunter", "submitter", "username"];
      for (const p of personal) {
        assert.ok(!a.expectations.watchKeys.includes(p), `${a.id} watches personal field ${p}`);
        assert.ok(!a.spec.fields.some((f) => f.name === p), `${a.id} spec requests personal field ${p}`);
      }
    });
  }
});

describe("normalization is idempotent", () => {
  for (const a of allAdapters()) {
    test(`${a.id}: normalize(normalize(x)) === normalize(x)`, () => {
      const raw: RawRow = Object.fromEntries(
        a.spec.fields.map((f) => [f.name, f.type === "number" ? 42 : "sample"]),
      );
      raw["repo"] = "owner/name"; raw["modelId"] = "org/model"; raw["itemId"] = "12345";
      raw["url"] = `${a.targetUrl.replace(/\/$/, "")}/tool/sample`;

      const once = a.normalize([raw], "2026-08-21T00:00:00.000Z");
      // Feeding normalized records back through must be a no-op — this is what makes captured
      // fixtures replayable through the real pipeline.
      const twice = a.normalize(once as unknown as RawRow[], "2026-08-21T00:00:00.000Z");
      assert.deepEqual(twice, once, `${a.id} loses data on re-normalization`);
    });
  }
});
