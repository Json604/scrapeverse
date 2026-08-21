/**
 * An oracle VALIDATES a scrape; it is never the scrape target.
 *
 * Algolia's `front_page` tag is CLOSE TO but not identical with the rendered front page (window and
 * ranking lag differ). So a mismatch we cannot align reports `available: false` — "unavailable" is
 * never negative evidence, or the oracle manufactures permanent false breaks.
 */
import type { NormalizedRecord } from "../types.ts";
import type { OracleResult } from "../sources/types.ts";

const ENDPOINT = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50";

export async function hnOracle(
  records: NormalizedRecord[],
  jaccardFn: (a: Set<string>, b: Set<string>) => number,
): Promise<OracleResult> {
  try {
    const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { available: false, agreement: null, detail: `algolia ${res.status}` };
    const body = (await res.json()) as { hits?: Array<{ objectID?: string }> };
    const oracleIds = new Set((body.hits ?? []).map((h) => String(h.objectID)).filter(Boolean));
    if (oracleIds.size < 10) return { available: false, agreement: null, detail: "oracle returned too few hits to compare" };

    const scraped = new Set(records.map((r) => r.nativeId));
    const agreement = jaccardFn(scraped, oracleIds);
    return {
      available: true, agreement,
      detail: `${scraped.size} scraped vs ${oracleIds.size} oracle ids, jaccard ${agreement.toFixed(2)}`,
    };
  } catch (e) {
    return { available: false, agreement: null, detail: `oracle unreachable: ${(e as Error).message}` };
  }
}
