import type { SourceAdapter } from "./types.ts";
import { pick, str } from "./types.ts";
import type { RawRow } from "../backend/types.ts";
import type { NormalizedRecord, Metric } from "../types.ts";
import { parseNumber, normalizeUrl } from "../util.ts";

const TARGET = "https://www.futurepedia.io/ai-tools";

/** The money-demo source: `pricingModel` flipping on a persistent row is a clean ATTRIBUTE_CHANGED. */
export const futurepedia: SourceAdapter = {
  id: "futurepedia",
  entityType: "tool",
  targetUrl: TARGET,
  spec: {
    specId: "spec_futurepedia_v1", source: "futurepedia", version: 1, targetUrl: TARGET,
    // Client-rendered: the listing only exists after hydration, which is why this source is a real
    // self-healing target (and why its Wayback captures are empty shells).
    interaction: [{ action: "wait", ms: 2500 }, { action: "scroll" }],
    createdAt: "2026-08-21T00:00:00.000Z", supersedes: null,
    fields: [
      { name: "name", description: "the tool name shown as the card heading", type: "string", required: true },
      { name: "url", description: "the href of the tool card linking to its detail page", type: "url", required: true },
      { name: "pricingModel", description: "the pricing label on the card, such as Free, Freemium, Paid, Free Trial", type: "enum", enumValues: ["Free", "Freemium", "Paid", "Free Trial"], required: true },
      { name: "category", description: "the category label on the card", type: "string", required: false },
      { name: "rating", description: "the numeric star rating on the card", type: "number", required: false },
    ],
  },
  expectations: {
    rowRange: [20, 60],
    watchKeys: ["pricingModel", "category"],
    requiredFields: ["title", "pricingModel"],
    presenceCanaries: ["title", "pricingModel"],
    liveCanaries: [],              // populated by `driftwatch calibrate --sign`
    turnover: { lo: 0.05, hi: 0.3 },
    overlapWeight: 1,
    rankNoiseFloor: 3,
    metricDeltaFloors: { rating: 0.2 },
  },
  nativeId(row: RawRow): string | null {
    const direct = str(pick(row, "nativeId"));
    if (direct) return direct;
    const href = str(pick(row, "url", "link", "href", "detailUrl"));
    if (href) {
      const m = href.match(/\/tool\/([a-z0-9-]+)/i);
      if (m) return m[1]!.toLowerCase();
    }
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
      const rating = parseNumber(pick(row, "rating", "stars", "score"));
      const metrics: Record<string, Metric> = {};
      if (rating !== null) metrics["rating"] = { name: "rating", value: rating, unit: "total" };
      const url = normalizeUrl(str(pick(row, "url", "link", "href")) ?? `${TARGET}/${nativeId}`, TARGET);
      out.push({
        source: "futurepedia", entityType: "tool", nativeId,
        entityId: `futurepedia:${nativeId}`,
        title: str(pick(row, "name", "title", "tool")) ?? nativeId,
        url, canonicalUrl: url, rank, metrics,
        attributes: {
          // OPEN enum on purpose: Futurepedia really ships "Contact", "Open Source", "from $X".
          // A closed enum would mark a healthy page malformed.
          pricingModel: str(pick(row, "pricingModel", "pricing", "price", "pricingLabel")),
          category: str(pick(row, "category", "categories", "tag", "type")),
        },
        capturedAt,
      });
    }
    return out;
  },
};
