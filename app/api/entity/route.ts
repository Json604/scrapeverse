import { blameEntity } from "../../../src/core/query/index.ts";
import { ok, fail } from "../_lib.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return fail("missing ?id", 400);
    return ok(await blameEntity(id));
  } catch (e) { return fail((e as Error).message); }
}
