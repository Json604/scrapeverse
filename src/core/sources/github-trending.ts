import type { SourceAdapter } from "./types.ts";
import { pick, str } from "./types.ts";
import type { RawRow } from "../backend/types.ts";
import type { NormalizedRecord, Metric } from "../types.ts";
import { parseNumber, normalizeUrl } from "../util.ts";

const TARGET = "https://github.com/trending";

export const githubTrending: SourceAdapter = {
  id: "github_trending",
  entityType: "repo",
  targetUrl: TARGET,

  spec: {
    specId: "spec_github_trending_v1",
    source: "github_trending",
    version: 1,
    targetUrl: TARGET,
    interaction: [],                   // fully server-rendered; no interaction needed
    createdAt: "2026-08-21T00:00:00.000Z",
    supersedes: null,
    fields: [
      { name: "repo", description: "the repository identifier in owner/name form, from the row heading link", type: "string", required: true },
      { name: "description", description: "the one-line repository description under the heading", type: "string", required: false },
      { name: "language", description: "the primary programming language label in the row footer", type: "string", required: false },
      { name: "stars", description: "total star count shown in the row footer", type: "number", required: true },
      { name: "forks", description: "total fork count shown in the row footer", type: "number", required: false },
      { name: "starsToday", description: "the 'N stars today' figure at the right of the row footer", type: "number", required: true },
    ],
  },

  expectations: {
    rowRange: [20, 25],
    watchKeys: ["language", "description"],
    // NOTE: these name NORMALIZED record fields (resolved by fieldValue), not raw spec
    // fields. `repo` becomes `title`/`nativeId` during normalization.
    requiredFields: ["title", "stars", "starsToday"],
    presenceCanaries: ["title", "stars"],
    liveCanaries: [],                  // turnover is high; pinned live canaries are meaningless here
    turnover: { lo: 0.4, hi: 0.9 },
    overlapWeight: 0.5,                // wide band — informational-leaning
    rankNoiseFloor: 2,
    metricDeltaFloors: { stars: 50, starsToday: 10, forks: 10 },
  },

  nativeId(row: RawRow): string | null {
    const repo = str(pick(row, "nativeId", "repo", "name", "fullName", "full_name", "repository", "title"));
    if (!repo) return null;
    const m = repo.match(/([\w.-]+)\s*\/\s*([\w.-]+)/);
    if (m) return `${m[1]}/${m[2]}`;
    try {
      const u = new URL(repo);
      const parts = u.pathname.split("/").filter(Boolean);
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
    } catch { return null; }
  },

  normalize(rows: RawRow[], capturedAt: string): NormalizedRecord[] {
    const out: NormalizedRecord[] = [];
    let rank = 0;
    for (const row of rows) {
      const nativeId = this.nativeId(row);
      if (!nativeId) continue;
      rank++;

      const stars = parseNumber(pick(row, "stars", "starsTotal", "stargazers", "totalStars"));
      const starsToday = parseNumber(pick(row, "starsToday", "stars_today", "todayStars", "starsSince"));
      const forks = parseNumber(pick(row, "forks", "forkCount"));

      const metrics: Record<string, Metric> = {};
      if (stars !== null) metrics["stars"] = { name: "stars", value: stars, unit: "total" };
      if (starsToday !== null) metrics["starsToday"] = { name: "starsToday", value: starsToday, unit: "today" };
      if (forks !== null) metrics["forks"] = { name: "forks", value: forks, unit: "total" };

      const url = normalizeUrl(`https://github.com/${nativeId}`);
      out.push({
        source: "github_trending",
        entityType: "repo",
        nativeId,
        entityId: `github_trending:${nativeId}`,
        title: nativeId,
        url,
        canonicalUrl: url,
        rank,
        metrics,
        attributes: {
          language: str(pick(row, "language", "lang", "primaryLanguage")),
          description: str(pick(row, "description", "desc", "about", "summary")),
        },
        capturedAt,
      });
    }
    return out;
  },
};
