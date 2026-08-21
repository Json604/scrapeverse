import type { SourceAdapter } from "./types.ts";
import { pick, str } from "./types.ts";
import type { RawRow } from "../backend/types.ts";
import type { NormalizedRecord, Metric } from "../types.ts";
import { parseNumber, normalizeUrl } from "../util.ts";

const TARGET = "https://stackshare.io/trending/tools";

/**
 * The deliberate stress test: this list barely moves, so across a week MOST
 * apparent change here is extraction breakage rather than real movement. Low overlap is ALARMING
 * here and completely normal on Product Hunt — which is exactly why the band is per-source and
 * learned from each source's own history rather than typed into a shared table.
 */
export const stackshare: SourceAdapter = {
  id: "stackshare",
  entityType: "tool",
  targetUrl: TARGET,
  spec: {
    specId: "spec_stackshare_v1", source: "stackshare", version: 1, targetUrl: TARGET,
    interaction: [{ action: "wait", ms: 1500 }], createdAt: "2026-08-21T00:00:00.000Z", supersedes: null,
    fields: [
      { name: "slug", description: "the tool slug from its link", type: "string", required: true },
      { name: "name", description: "the tool name on the row", type: "string", required: true },
      { name: "category", description: "the category label on the row", type: "string", required: false },
      { name: "stacks", description: "the number of stacks using this tool", type: "number", required: false },
    ],
  },
  expectations: {
    rowRange: [20, 50],
    watchKeys: ["category"],
    requiredFields: ["title"],
    presenceCanaries: ["title"],
    liveCanaries: [],           // low turnover ⇒ live canaries ARE meaningful here (see evidence.ts)
    turnover: { lo: 0.0, hi: 0.1 },
    overlapWeight: 1,
    rankNoiseFloor: 1,
    metricDeltaFloors: { stacks: 5 },
  },
  nativeId(row: RawRow): string | null {
    const direct = str(pick(row, "nativeId"));
    if (direct) return direct;
    const href = str(pick(row, "url", "link", "href"));
    const m = href?.match(/stackshare\.io\/([a-z0-9._-]+)/i);
    if (m && m[1] && !["trending", "tools"].includes(m[1].toLowerCase())) return m[1].toLowerCase();
    const name = str(pick(row, "name", "title", "tool"));
    return name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : null;
  },
  normalize(rows: RawRow[], capturedAt: string): NormalizedRecord[] {
    const out: NormalizedRecord[] = [];
    let rank = 0;
    for (const row of rows) {
      const nativeId = this.nativeId(row);
      if (!nativeId) continue;
      rank++;
      const stacks = parseNumber(pick(row, "stacks", "stacksCount", "companies", "usedBy"));
      const metrics: Record<string, Metric> = {};
      if (stacks !== null) metrics["stacks"] = { name: "stacks", value: stacks, unit: "total" };
      const url = normalizeUrl(str(pick(row, "url", "link")) ?? `https://stackshare.io/${nativeId}`, TARGET);
      out.push({
        source: "stackshare", entityType: "tool", nativeId,
        entityId: `stackshare:${nativeId}`,
        title: str(pick(row, "name", "title", "tool")) ?? nativeId,
        url, canonicalUrl: url, rank, metrics,
        attributes: { category: str(pick(row, "category", "categories", "type")) },
        capturedAt,
      });
    }
    return out;
  },
};
