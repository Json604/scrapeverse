import { queryEvents, countEvents } from "../../../src/core/query/index.ts";
import { ok, fail, num } from "../_lib.ts";
import type { ChangeType } from "../../../src/core/types.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams;
    const q = {
      ...(p.get("source") ? { source: p.get("source")! } : {}),
      ...(p.get("channel") ? { channel: p.get("channel")! } : {}),
      ...(p.get("type") ? { changeType: p.get("type") as ChangeType } : {}),
      ...(p.get("field") ? { field: p.get("field")! } : {}),
      ...(p.get("since") ? { since: p.get("since")! } : {}),
      limit: num(p.get("limit"), 50, 500),
    };
    const [events, counts] = await Promise.all([queryEvents(q), countEvents(q)]);
    return ok({ events, counts, query: q });
  } catch (e) { return fail((e as Error).message); }
}
