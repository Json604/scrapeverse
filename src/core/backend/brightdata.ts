/**
 * Bright Data Scraper Studio — the CUSTOM collector API (`/dca/*`).
 *
 * Deliberately NOT `/datasets/v3/*`, which is the pre-built scraper library. The hackathon rule is
 * that a submission must include a custom scraper created in Scraper Studio; conflating the two
 * would undercut the "Use of Scraper Studio" judging criterion.
 */
import { config } from "../config.ts";
import { nowIso, sleep } from "../util.ts";
import type { ExtractionBackend, FetchResult, RawRow } from "./types.ts";

const API = "https://api.brightdata.com";

export interface TriggerResponse { collection_id: string }

export class BrightDataBackend implements ExtractionBackend {
  readonly id = "brightdata";
  constructor(private readonly apiKey: string = config.brightDataKey) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
  }

  async trigger(collectorId: string, inputs: Array<Record<string, unknown>>): Promise<string> {
    const url = `${API}/dca/trigger?collector=${encodeURIComponent(collectorId)}&queue_next=1`;
    const res = await fetch(url, { method: "POST", headers: this.headers(), body: JSON.stringify(inputs) });
    if (!res.ok) {
      throw new Error(`trigger failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as TriggerResponse;
    if (!body.collection_id) throw new Error(`trigger returned no collection_id: ${JSON.stringify(body)}`);
    return body.collection_id;
  }

  /**
   * Poll until the response flips from a status object to a JSON array.
   * That shape-change IS the completion signal — there is no separate progress endpoint on /dca.
   */
  async dataset(collectionId: string, timeoutMs = 300_000): Promise<{ rows: RawRow[]; raw: unknown }> {
    const deadline = Date.now() + timeoutMs;
    let delay = 3_000;
    let lastStatus = "unknown";
    while (Date.now() < deadline) {
      const res = await fetch(`${API}/dca/dataset?id=${encodeURIComponent(collectionId)}`, {
        headers: this.headers(),
      });
      if (res.status === 404) { await sleep(delay); continue; }
      if (!res.ok) throw new Error(`dataset failed ${res.status}: ${(await res.text()).slice(0, 300)}`);

      const body: unknown = await res.json();
      if (Array.isArray(body)) return { rows: body as RawRow[], raw: body };

      lastStatus = (body as { status?: string })?.status ?? "building";
      if (lastStatus === "failed") throw new Error(`collection ${collectionId} failed: ${JSON.stringify(body)}`);
      await sleep(delay);
      delay = Math.min(delay * 1.4, 15_000);
    }
    throw new Error(`timed out after ${timeoutMs}ms polling ${collectionId} (last status: ${lastStatus})`);
  }

  async fetch(opts: { collectorId: string; url: string; timeoutMs?: number }): Promise<FetchResult> {
    const collectionId = await this.trigger(opts.collectorId, [{ url: opts.url }]);
    const { rows, raw } = await this.dataset(collectionId, opts.timeoutMs);
    return {
      rows,
      raw,
      inputUrl: opts.url,
      collectorId: opts.collectorId,
      collectorVersion: collectionId,   // the collection id pins which run produced these rows
      transport: {
        providerJobId: collectionId,
        fetchedAt: nowIso(),
        refetched: true,                // a fresh trigger is by definition a real fetch
      },
    };
  }
}
