import type { RawRow } from "./types.ts";

/** Names Scraper Studio uses when it wraps a list as listing→detail instead of one flat row per item. */
const ENVELOPES = [
  "items", "repositories", "stories", "products", "tools", "models",
  "entries", "results", "records", "data", "ranking_items", "rankings",
  "languages", "list", "rows",
];

function isPlainObject(v: unknown): v is RawRow {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Scraper Studio often emits `{ items: [row], product_page_url, input }` instead of a flat row.
 * The engine diffs entities, not envelopes — unwrap so a nested-but-correct extraction is usable.
 * An empty nested array means the detail step filled nothing; that stays zero rows.
 */
export function unwrapCollectorRows(rows: RawRow[]): RawRow[] {
  const out: RawRow[] = [];
  for (const row of rows) {
    const key = ENVELOPES.find((k) => {
      const v = row[k];
      return Array.isArray(v) && (v.length === 0 || v.every(isPlainObject));
    });
    if (!key) { out.push(row); continue; }
    const nested = row[key] as RawRow[];
    for (const item of nested) out.push(item);
  }
  return out;
}
