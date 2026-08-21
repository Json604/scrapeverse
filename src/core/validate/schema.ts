/** Layer 1. Loud breakage, no baseline required. */
import type { NormalizedRecord, SourceExpectations } from "../types.ts";

export interface SchemaVerdict {
  valid: boolean;
  problems: string[];
  coverage: Record<string, number>;
}

export function checkSchema(
  records: NormalizedRecord[],
  exp: SourceExpectations,
  expectedHost?: string,
): SchemaVerdict {
  const problems: string[] = [];
  const n = records.length;

  if (n === 0) problems.push("zero rows extracted");
  else if (n < exp.rowRange[0]) problems.push(`row count ${n} below expected minimum ${exp.rowRange[0]}`);
  else if (n > exp.rowRange[1] * 1.5) problems.push(`row count ${n} far above expected maximum ${exp.rowRange[1]}`);

  // Ranks must be unique and ascending. NOT assumed contiguous: PH promotes ads, HN injects job
  // rows, GH has sponsored slots — demanding 1..n makes a healthy page look broken.
  const ranks = records.map((r) => r.rank);
  if (new Set(ranks).size !== ranks.length) problems.push("duplicate ranks");
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i]! < ranks[i - 1]!) { problems.push("ranks not monotonically increasing"); break; }
  }

  const coverage: Record<string, number> = {};
  const fields = new Set<string>([...exp.requiredFields, ...exp.watchKeys]);
  for (const f of fields) {
    const filled = records.filter((r) => fieldValue(r, f) !== null && fieldValue(r, f) !== "").length;
    coverage[f] = n === 0 ? 0 : filled / n;
  }
  for (const f of exp.requiredFields) {
    if ((coverage[f] ?? 0) === 0 && n > 0) problems.push(`required field "${f}" is empty on every row`);
  }

  if (expectedHost) {
    const bad = records.filter((r) => {
      try { return !new URL(r.canonicalUrl).host.endsWith(expectedHost); } catch { return true; }
    }).length;
    if (n > 0 && bad / n > 0.2) problems.push(`${bad}/${n} rows have a url outside ${expectedHost}`);
  }

  return { valid: problems.length === 0, problems, coverage };
}

export function fieldValue(r: NormalizedRecord, field: string): string | number | null {
  if (field in r.attributes) {
    const v = r.attributes[field] ?? null;
    return Array.isArray(v) ? v.join("|") : v;
  }
  if (field in r.metrics) return r.metrics[field]!.value;
  if (field === "title") return r.title;
  if (field === "url" || field === "canonicalUrl") return r.canonicalUrl;
  if (field === "rank") return r.rank;
  return null;
}
