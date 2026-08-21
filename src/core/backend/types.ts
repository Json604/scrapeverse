import type { TransportMeta } from "../types.ts";

/** One raw extracted row, exactly as the backend returned it. */
export type RawRow = Record<string, unknown>;

export interface FetchResult {
  rows: RawRow[];
  transport: TransportMeta;
  raw: unknown;
  inputUrl: string;
  collectorId: string;
  collectorVersion: string;
}

/**
 * Scraper Studio is ONE implementation, not the architecture.
 * The fixture backend implements the same contract, which is what makes fixture and replay channels possible.
 */
export interface ExtractionBackend {
  readonly id: string;
  fetch(opts: { collectorId: string; url: string; timeoutMs?: number }): Promise<FetchResult>;
}
