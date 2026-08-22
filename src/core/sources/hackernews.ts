import type { SourceAdapter, OracleResult } from "./types.ts";
import { pick, str } from "./types.ts";
import type { RawRow } from "../backend/types.ts";
import type { NormalizedRecord, Metric } from "../types.ts";
import { parseNumber, normalizeUrl, jaccard } from "../util.ts";
import { hnOracle } from "../oracle/hn-algolia.ts";

const TARGET = "https://news.ycombinator.com/";

export const hackernews: SourceAdapter = {
  id: "hackernews",
  entityType: "story",
  targetUrl: TARGET,
  spec: {
    specId: "spec_hackernews_v1", source: "hackernews", version: 1, targetUrl: TARGET,
    interaction: [], createdAt: "2026-08-21T00:00:00.000Z", supersedes: null,
    fields: [
      { name: "itemId", description: "the numeric item id from the story's comments link", type: "string", required: true },
      { name: "title", description: "the story headline text", type: "string", required: true },
      { name: "url", description: "the outbound link on the headline", type: "url", required: false },
      { name: "points", description: "the score shown under the headline", type: "number", required: true },
      { name: "comments", description: "the comment count under the headline", type: "number", required: false },
    ],
  },
  expectations: {
    // Studio often follows "More" and returns ~60 unique stories. The front page is 30;
    // the historical floor learns the live size after calibration.
    rowRange: [20, 90],
    watchKeys: ["domain"],
    requiredFields: ["title", "points"],
    presenceCanaries: ["title", "points"],
    liveCanaries: [],
    turnover: { lo: 0.5, hi: 1.0 },
    overlapWeight: 0.4,
    rankNoiseFloor: 3,
    metricDeltaFloors: { points: 10, comments: 5 },
  },
  nativeId(row: RawRow): string | null {
    const id = str(pick(row, "nativeId", "itemId", "item_id", "id", "storyId"));
    if (id && /^\d+$/.test(id)) return id;
    const link = str(pick(row, "commentsUrl", "discussionUrl", "hnUrl"));
    const m = link?.match(/id=(\d+)/);
    return m ? m[1]! : null;
  },
  normalize(rows: RawRow[], capturedAt: string): NormalizedRecord[] {
    const out: NormalizedRecord[] = [];
    let rank = 0;
    for (const row of rows) {
      const nativeId = this.nativeId(row);
      if (!nativeId) continue;
      rank++;
      const points = parseNumber(pick(row, "points", "score"));
      const comments = parseNumber(pick(row, "comments", "commentCount", "descendants"));
      const metrics: Record<string, Metric> = {};
      if (points !== null) metrics["points"] = { name: "points", value: points, unit: "total" };
      if (comments !== null) metrics["comments"] = { name: "comments", value: comments, unit: "total" };
      const outbound = str(pick(row, "url", "link"));
      const url = outbound
        ? normalizeUrl(outbound, TARGET)
        : `https://news.ycombinator.com/item?id=${nativeId}`;
      const canonicalUrl = `https://news.ycombinator.com/item?id=${nativeId}`;
      let domain: string | null = null;
      try { domain = new URL(url).host.replace(/^www\./, ""); } catch { /* keep null */ }
      out.push({
        source: "hackernews", entityType: "story", nativeId,
        entityId: `hackernews:${nativeId}`,
        // NOTE: `author` is deliberately NOT captured — hackathon rules forbid personal data.
        title: str(pick(row, "title", "headline")) ?? `item ${nativeId}`,
        url, canonicalUrl, rank, metrics,
        attributes: { domain },
        capturedAt,
      });
    }
    return out;
  },
  async oracle(records: NormalizedRecord[]): Promise<OracleResult> {
    return hnOracle(records, jaccard);
  },
};
