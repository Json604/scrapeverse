import type { SourceAdapter } from "./types.ts";
import { pick, str } from "./types.ts";
import type { RawRow } from "../backend/types.ts";
import type { NormalizedRecord, Metric } from "../types.ts";
import { parseNumber, normalizeUrl } from "../util.ts";

const TARGET = "https://www.producthunt.com/";

export const producthunt: SourceAdapter = {
  id: "producthunt",
  entityType: "product",
  targetUrl: TARGET,
  spec: {
    specId: "spec_producthunt_v1", source: "producthunt", version: 1, targetUrl: TARGET,
    interaction: [{ action: "wait", ms: 2000 }], createdAt: "2026-08-21T00:00:00.000Z", supersedes: null,
    fields: [
      { name: "slug", description: "the product slug from its /posts/ link", type: "string", required: true },
      { name: "name", description: "the product name shown on the card", type: "string", required: true },
      { name: "tagline", description: "the one-line tagline under the product name", type: "string", required: false },
      { name: "upvotes", description: "the upvote count on the right of the card", type: "number", required: true },
      { name: "topics", description: "the topic tags listed on the card", type: "string", required: false },
    ],
  },
  expectations: {
    rowRange: [15, 40],
    watchKeys: ["tagline", "topics"],
    requiredFields: ["title", "upvotes"],
    presenceCanaries: ["title", "upvotes"],
    liveCanaries: [],
    // ~Full daily turnover BY DESIGN. Overlap is meaningless here and is pinned off: 0% entity
    // overlap is a normal Tuesday, and a flat threshold would flag every single day as broken.
    turnover: { lo: 0.9, hi: 1.0 },
    overlapWeight: 0,
    rankNoiseFloor: 3,
    metricDeltaFloors: { upvotes: 25 },
  },
  nativeId(row: RawRow): string | null {
    const direct = str(pick(row, "nativeId"));
    if (direct) return direct;
    const href = str(pick(row, "url", "link", "href", "postUrl"));
    const m = href?.match(/\/posts\/([a-z0-9-]+)/i);
    if (m) return m[1]!.toLowerCase();
    const name = str(pick(row, "name", "title", "product"));
    return name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : null;
  },
  normalize(rows: RawRow[], capturedAt: string): NormalizedRecord[] {
    const out: NormalizedRecord[] = [];
    let rank = 0;
    for (const row of rows) {
      const nativeId = this.nativeId(row);
      if (!nativeId) continue;
      rank++;
      const upvotes = parseNumber(pick(row, "upvotes", "votes", "votesCount", "points"));
      const comments = parseNumber(pick(row, "comments", "commentsCount"));
      const metrics: Record<string, Metric> = {};
      if (upvotes !== null) metrics["upvotes"] = { name: "upvotes", value: upvotes, unit: "total" };
      if (comments !== null) metrics["comments"] = { name: "comments", value: comments, unit: "total" };
      const rawTopics = pick(row, "topics", "tags", "categories");
      const topics = Array.isArray(rawTopics)
        ? rawTopics.map((t) => String(t)).filter(Boolean)
        : str(rawTopics)?.split(/[,|]/).map((t) => t.trim()).filter(Boolean) ?? null;
      const url = normalizeUrl(str(pick(row, "url", "link")) ?? `https://www.producthunt.com/posts/${nativeId}`, TARGET);
      out.push({
        source: "producthunt", entityType: "product", nativeId,
        entityId: `producthunt:${nativeId}`,
        // makers / hunters deliberately not captured — personal data.
        title: str(pick(row, "name", "title", "product")) ?? nativeId,
        url, canonicalUrl: url, rank, metrics,
        attributes: { tagline: str(pick(row, "tagline", "description", "subtitle")), topics },
        capturedAt,
      });
    }
    return out;
  },
};
