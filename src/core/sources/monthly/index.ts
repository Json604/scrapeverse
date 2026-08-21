/**
 * the design notes monthly overlay — slow-moving endorsement indices.
 * Deliberately NOT in the daily cadence: they emit rare, high-signal rank/ring moves.
 */
import type { SourceAdapter } from "../types.ts";
import { pick, str } from "../types.ts";
import type { RawRow } from "../../backend/types.ts";
import type { NormalizedRecord, Metric, SourceId, EntityType } from "../../types.ts";
import { parseNumber, normalizeUrl } from "../../util.ts";

function indexAdapter(cfg: {
  id: SourceId; entityType: EntityType; url: string; metric: string;
  watchKeys: string[]; extraFields: Array<{ name: string; description: string; type: "string" | "number" }>;
  attrKeys: Record<string, string[]>;
}): SourceAdapter {
  return {
    id: cfg.id,
    entityType: cfg.entityType,
    targetUrl: cfg.url,
    spec: {
      specId: `spec_${cfg.id}_v1`, source: cfg.id, version: 1, targetUrl: cfg.url,
      interaction: [], createdAt: "2026-08-21T00:00:00.000Z", supersedes: null,
      fields: [
        { name: "name", description: "the entry name in the ranking table", type: "string", required: true },
        { name: "rank", description: "the position number in the ranking table", type: "number", required: true },
        ...cfg.extraFields.map((f) => ({ ...f, required: false })),
      ],
    },
    expectations: {
      rowRange: [10, 120],
      watchKeys: cfg.watchKeys,
      requiredFields: ["title"],
      presenceCanaries: ["title"],
      liveCanaries: [],
      turnover: { lo: 0.0, hi: 0.05 },     // these barely move — that is the whole point
      overlapWeight: 1,
      rankNoiseFloor: 1,
      metricDeltaFloors: { [cfg.metric]: 0.05 },
    },
    nativeId(row: RawRow): string | null {
      const n = str(pick(row, "name", "language", "technology", "title", "entry"));
      return n ? n.toLowerCase().replace(/[^a-z0-9+#.]+/g, "-").replace(/^-|-$/g, "") : null;
    },
    normalize(rows: RawRow[], capturedAt: string): NormalizedRecord[] {
      const out: NormalizedRecord[] = [];
      let fallbackRank = 0;
      for (const row of rows) {
        const nativeId = this.nativeId(row);
        if (!nativeId) continue;
        fallbackRank++;
        const rank = parseNumber(pick(row, "rank", "position", "place")) ?? fallbackRank;
        const value = parseNumber(pick(row, cfg.metric, "share", "ratings", "percentage"));
        const metrics: Record<string, Metric> = {};
        if (value !== null) metrics[cfg.metric] = { name: cfg.metric, value, unit: "total" };
        const attributes: Record<string, string | null> = {};
        for (const [key, names] of Object.entries(cfg.attrKeys)) attributes[key] = str(pick(row, ...names));
        out.push({
          source: cfg.id, entityType: cfg.entityType, nativeId,
          entityId: `${cfg.id}:${nativeId}`,
          title: str(pick(row, "name", "language", "technology", "title")) ?? nativeId,
          url: normalizeUrl(cfg.url), canonicalUrl: normalizeUrl(cfg.url),
          rank, metrics, attributes, capturedAt,
        });
      }
      return out;
    },
  };
}

export const tiobe = indexAdapter({
  id: "tiobe", entityType: "language", url: "https://www.tiobe.com/tiobe-index/",
  metric: "ratings", watchKeys: [],
  extraFields: [{ name: "ratings", description: "the percentage rating for the language", type: "number" }],
  attrKeys: {},
});

export const pypl = indexAdapter({
  id: "pypl", entityType: "language", url: "https://pypl.github.io/PYPL.html",
  metric: "share", watchKeys: [],
  extraFields: [{ name: "share", description: "the popularity share percentage", type: "number" }],
  attrKeys: {},
});

/** Tech Radar items MOVE RINGS — that ring change is the high-signal diff. */
export const techRadar = indexAdapter({
  id: "tech_radar", entityType: "technology",
  url: "https://www.thoughtworks.com/radar/languages-and-frameworks",
  metric: "ring_ordinal", watchKeys: ["ring", "quadrant"],
  extraFields: [
    { name: "ring", description: "the radar ring: Adopt, Trial, Assess or Hold", type: "string" },
    { name: "quadrant", description: "the radar quadrant the item sits in", type: "string" },
  ],
  attrKeys: { ring: ["ring", "level"], quadrant: ["quadrant", "category"] },
});
