import type {
  SourceId, EntityType, NormalizedRecord, SourceExpectations, ExtractionSpec,
} from "../types.ts";
import type { RawRow } from "../backend/types.ts";

export interface OracleResult {
  available: boolean;              // "unavailable" is NEVER negative evidence
  agreement: number | null;        // entity-set agreement 0..1
  detail: string;
}

export interface SourceAdapter {
  id: SourceId;
  entityType: EntityType;
  targetUrl: string;
  spec: ExtractionSpec;
  expectations: SourceExpectations;
  /** Stable per-source key. MUST NOT identify a person. */
  nativeId(row: RawRow): string | null;
  normalize(rows: RawRow[], capturedAt: string): NormalizedRecord[];
  oracle?(records: NormalizedRecord[]): Promise<OracleResult>;
}

/** Fields stripped from raw captures before storage — hackathon rule: no personal data. */
export const PII_FIELDS = [
  "author", "by", "maker", "makers", "hunter", "submitter", "user",
  "username", "avatar", "avatar_url", "profile", "builtBy", "built_by", "contributors",
];

export function stripPii<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripPii) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_FIELDS.includes(k)) continue;
      out[k] = stripPii(v);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Tolerant field lookup — collector output keys drift, and that is not a break.
 *
 * Also reaches into `metrics` / `attributes`, which makes normalize() IDEMPOTENT: feeding an
 * already-normalized record back through an adapter yields the same record. That is what lets a
 * captured fixture replay through the real pipeline without a separate denormalizer per source.
 */
export function pick(row: RawRow, ...names: string[]): unknown {
  const norm = (k: string) => k.toLowerCase().replace(/[_\s-]/g, "");
  const metrics = row["metrics"] as Record<string, { value?: unknown }> | undefined;
  const attributes = row["attributes"] as Record<string, unknown> | undefined;

  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== "") return row[n];

    if (metrics && typeof metrics === "object") {
      const mk = Object.keys(metrics).find((k) => norm(k) === norm(n));
      if (mk && metrics[mk]?.value !== undefined && metrics[mk]?.value !== null) return metrics[mk]!.value;
    }
    if (attributes && typeof attributes === "object") {
      const ak = Object.keys(attributes).find((k) => norm(k) === norm(n));
      if (ak && attributes[ak] !== undefined && attributes[ak] !== null && attributes[ak] !== "") return attributes[ak];
    }

    const found = Object.keys(row).find((k) => norm(k) === norm(n));
    if (found && row[found] !== undefined && row[found] !== null && row[found] !== "") return row[found];
  }
  return null;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
