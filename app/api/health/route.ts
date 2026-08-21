import { sourceHealth } from "../../../src/core/query/index.ts";
import { ok, fail } from "../_lib.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return ok(await sourceHealth()); }
  catch (e) { return fail((e as Error).message); }
}
