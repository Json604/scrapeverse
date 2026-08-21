import { allAdapters } from "../../../src/core/sources/index.ts";
import { ok, fail } from "../_lib.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(allAdapters().map((a) => ({
      id: a.id, entityType: a.entityType, targetUrl: a.targetUrl,
      watchKeys: a.expectations.watchKeys,
      rowRange: a.expectations.rowRange,
      turnover: a.expectations.turnover,
      overlapWeight: a.expectations.overlapWeight,
      hasOracle: typeof a.oracle === "function",
      specVersion: a.spec.version,
    })));
  } catch (e) { return fail((e as Error).message); }
}
