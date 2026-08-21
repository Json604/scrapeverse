import type { SourceAdapter, OracleResult } from "./types.ts";
import { pick, str } from "./types.ts";
import type { RawRow } from "../backend/types.ts";
import type { NormalizedRecord, Metric } from "../types.ts";
import { parseNumber, normalizeUrl, jaccard } from "../util.ts";

const TARGET = "https://huggingface.co/models?sort=trending";

export const hfTrending: SourceAdapter = {
  id: "hf_trending",
  entityType: "model",
  targetUrl: TARGET,
  spec: {
    specId: "spec_hf_trending_v1", source: "hf_trending", version: 1, targetUrl: TARGET,
    interaction: [{ action: "wait", ms: 1500 }], createdAt: "2026-08-21T00:00:00.000Z", supersedes: null,
    fields: [
      { name: "modelId", description: "the model identifier in org/name form from the card link", type: "string", required: true },
      { name: "task", description: "the pipeline task label on the card", type: "string", required: false },
      { name: "downloads", description: "the download count on the card", type: "number", required: false },
      { name: "likes", description: "the like count on the card", type: "number", required: false },
    ],
  },
  expectations: {
    rowRange: [20, 50],
    watchKeys: ["task"],
    requiredFields: ["title"],
    presenceCanaries: ["title"],
    liveCanaries: [],
    turnover: { lo: 0.2, hi: 0.5 },
    overlapWeight: 1,
    rankNoiseFloor: 3,
    metricDeltaFloors: { downloads: 500, likes: 5 },
  },
  nativeId(row: RawRow): string | null {
    const id = str(pick(row, "nativeId", "modelId", "model_id", "id", "name", "model", "title"));
    if (!id) return null;
    const m = id.match(/([\w.-]+)\s*\/\s*([\w.-]+)/);
    if (m) return `${m[1]}/${m[2]}`;
    return id.includes("/") ? id : null;
  },
  normalize(rows: RawRow[], capturedAt: string): NormalizedRecord[] {
    const out: NormalizedRecord[] = [];
    let rank = 0;
    for (const row of rows) {
      const nativeId = this.nativeId(row);
      if (!nativeId) continue;
      rank++;
      const downloads = parseNumber(pick(row, "downloads", "downloadCount"));
      const likes = parseNumber(pick(row, "likes", "likeCount", "hearts"));
      const metrics: Record<string, Metric> = {};
      if (downloads !== null) metrics["downloads"] = { name: "downloads", value: downloads, unit: "total" };
      if (likes !== null) metrics["likes"] = { name: "likes", value: likes, unit: "total" };
      const url = normalizeUrl(`https://huggingface.co/${nativeId}`);
      out.push({
        source: "hf_trending", entityType: "model", nativeId,
        entityId: `hf_trending:${nativeId}`,
        title: nativeId, url, canonicalUrl: url, rank, metrics,
        attributes: { task: str(pick(row, "task", "pipeline", "pipelineTag", "pipeline_tag")) },
        capturedAt,
      });
    }
    return out;
  },
  async oracle(records: NormalizedRecord[]): Promise<OracleResult> {
    try {
      const res = await fetch("https://huggingface.co/api/models?sort=trendingScore&limit=50", {
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return { available: false, agreement: null, detail: `hf api ${res.status}` };
      const body = (await res.json()) as Array<{ id?: string }>;
      const ids = new Set(body.map((m) => String(m.id)).filter(Boolean));
      if (ids.size < 10) return { available: false, agreement: null, detail: "too few oracle rows" };
      const agreement = jaccard(new Set(records.map((r) => r.nativeId)), ids);
      return { available: true, agreement, detail: `jaccard ${agreement.toFixed(2)} vs HF api` };
    } catch (e) {
      return { available: false, agreement: null, detail: `oracle unreachable: ${(e as Error).message}` };
    }
  },
};
