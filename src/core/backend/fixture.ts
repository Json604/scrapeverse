/**
 * Local fixture backend. Implements the same contract as Bright Data so the eval harness
 * can run the full pipeline deterministically and without spending page loads.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { nowIso, uuid } from "../util.ts";
import type { ExtractionBackend, FetchResult, RawRow } from "./types.ts";

export class FixtureBackend implements ExtractionBackend {
  readonly id = "fixture";
  constructor(private readonly root = resolve(process.cwd(), "fixtures")) {}

  /** `collectorId` is the fixture path: `<source>/<variant>.json` */
  async fetch(opts: { collectorId: string; url: string }): Promise<FetchResult> {
    const p = resolve(this.root, `${opts.collectorId}.json`);
    if (!existsSync(p)) throw new Error(`fixture not found: ${p}`);
    const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
    const rows = (Array.isArray(parsed) ? parsed : (parsed as { rows?: RawRow[] }).rows ?? []) as RawRow[];
    return {
      rows, raw: parsed,
      inputUrl: opts.url,
      collectorId: opts.collectorId,
      collectorVersion: `fixture:${opts.collectorId}`,
      // A fixture read IS a genuine fetch, so it gets a fresh job id. Reusing one would make the
      // freshness check (correctly) classify every repeat read as `stale`, and a fixture channel
      // could never accumulate the consecutive runs calibration needs.
      transport: { providerJobId: `fixture_${uuid()}`, fetchedAt: nowIso(), refetched: true },
    };
  }
}
