import { timeline } from "../../../src/core/query/index.ts";
import { ok, fail, num } from "../_lib.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams;
    const source = p.get("source");
    if (!source) return fail("missing ?source", 400);
    return ok(await timeline(source, {
      ...(p.get("channel") ? { channel: p.get("channel")! } : {}),
      limit: num(p.get("limit"), 30, 200),
    }));
  } catch (e) { return fail((e as Error).message); }
}
