/**
 * Driftwatch core types
 *
 * Design notes worth preserving (each was a defect in an earlier draft):
 *  - `channel` is on EVERYTHING. Live / replay / fixture state must never mix, or a 2024
 *    backfill silently becomes the baseline for a 2026 live run.
 *  - There is no `attributesHash`. Hashing hid the money field (pricingModel) and turned every
 *    copy tweak into an event. Diffing is by explicit per-source `watchKeys`.
 *  - `payloadHash` and `transport` are SEPARATE. Semantic equality is not evidence of a stale
 *    fetch: a quiet StackShare day is byte-identical and completely honest.
 */

// ─── identity ────────────────────────────────────────────────────────────────

/** Isolation boundary. Live, archival replay, and fixture runs share no state. */
export type Channel = "live" | `replay:${string}` | `fixture:${string}`;

export type SourceId =
  | "github_trending" | "hf_trending" | "producthunt"
  | "hackernews" | "futurepedia" | "stackshare"
  | "tiobe" | "pypl" | "tech_radar";          // monthly overlay

export type EntityType =
  | "repo" | "model" | "product" | "story" | "tool"
  | "language" | "technology";                // monthly overlay

export type ScalarOrNull = string | number | null;
export type AttributeValue = string | number | string[] | null;

// ─── records & snapshots ─────────────────────────────────────────────────────

export interface Metric {
  name: string;
  value: number;
  unit?: "total" | "today" | "weekly";
}

/** One ranked item as seen in one scrape. `nativeId` is NEVER a person. */
export interface NormalizedRecord {
  source: SourceId;
  entityType: EntityType;
  nativeId: string;                    // "owner/repo", slug, item id
  entityId: string;                    // `${source}:${nativeId}` — the diff key
  title: string;
  url: string;
  canonicalUrl: string;
  rank: number;
  /** Keyed map, not a headline + array: v1 silently never diffed secondaryMetrics. */
  metrics: Record<string, Metric>;
  attributes: Record<string, AttributeValue>;
  capturedAt: string;
}

export type SnapshotStatus =
  | "calibrating"    // no signed baseline yet — emit nothing, write no baseline
  | "healthy"
  | "degraded"       // exactly one uncorroborated soft signal → quarantine, never the event stream
  | "broken"         // hard signal, or 2+ soft, or same soft × 3 runs
  | "stale";         // transport says cached AND payload unchanged

/** Evidence that a field still MEANS that field — the fix for circular verification. */
export interface FieldEvidence {
  field: string;
  coverage: number;
  /** Fraction of persisting entities whose value changed. Sparse ⇒ content, universal ⇒ structure. */
  breadth: number;
  /** max over other columns G of row-wise agreement(F_curr, G_lastHealthy). */
  maxConfusion: number;
  confusedWith: string | null;
  distinctCount: number;
}

export interface ExtractionHealth {
  rowCount: number;
  expectedRowRange: [number, number];
  fieldCoverage: Record<string, number>;
  schemaValid: boolean;
  /** 1 − jaccard(prev, curr). Informational until a source is past calibration. */
  observedReplacement: number | null;
  evidence: FieldEvidence[];
  canaryHits: number;
  canaryMismatches: number;
  presenceCanariesMissing: number;
  anomalyScore: number;
  softSignals: string[];
  hardSignals: string[];
}

/** Transport-level freshness. Distinct from payload equality — conflating them froze quiet sources. */
export interface TransportMeta {
  providerJobId: string | null;
  fetchedAt: string;
  httpAge?: number;
  httpDate?: string;
  etag?: string;
  refetched: boolean;
}

export interface SnapshotProvenance {
  collectorId: string;
  collectorVersion: string;
  specVersion: number;
  inputUrl: string;
  baselineVersion: number;
  rawRef: string | null;
  /** sha256 over canonicalized normalized records, job meta and timestamps stripped. */
  payloadHash: string;
  transport: TransportMeta;
}

export interface Snapshot {
  snapshotId: string;
  /** Stable idempotency key, generated once per logical run and reused across retries.
   *  capturedAt is NOT stable under retry, so it cannot serve this purpose. */
  runId: string;
  source: SourceId;
  channel: Channel;
  capturedAt: string;                  // when the page was captured (archive ts for replay)
  ingestedAt: string;                  // when we wrote it — never the same for replay
  prevSnapshotId: string | null;
  comparisonSnapshotId: string | null; // the healthy snapshot we actually diffed against
  records: NormalizedRecord[];
  health: ExtractionHealth;
  status: SnapshotStatus;
  provenance: SnapshotProvenance;
}

// ─── change events ───────────────────────────────────────────────────────────

export type ChangeType =
  | "ENTERED" | "LEFT" | "RENAMED"           // RENAMED separates slug migration from disappearance
  | "RANK_UP" | "RANK_DOWN"
  | "METRIC_DELTA" | "ATTRIBUTE_CHANGED"
  | "TITLE_CHANGED" | "URL_CHANGED";

export interface ChangeEvent {
  eventId: string;                     // deterministic; includes channel
  source: SourceId;
  channel: Channel;
  entityId: string;
  entityTitle: string;
  changeType: ChangeType;
  field?: string;
  from: ScalarOrNull;
  to: ScalarOrNull;
  delta?: number;
  fromSnapshot: string;
  toSnapshot: string;
  /** Timing is a RANGE when snapshots were skipped — never a false precise timestamp. */
  intervalStart: string;
  intervalEnd: string;
  gapCount: number;
  confidence: number;
}

export type CandidatePromotion = "confirming_snapshot" | "oracle" | "review" | null;

/** Degraded output lands here, never in the event stream. Subsumed candidates are discarded. */
export interface CandidateChange extends ChangeEvent {
  promotedBy: CandidatePromotion;
  observedRuns: number;
  expiresAfterRun: number;
}

// ─── extraction spec & healing ───────────────────────────────────────────────

export interface SpecField {
  name: string;
  description: string;                 // plain language — seeds `scraper create` AND heal prompts
  type: "string" | "number" | "url" | "enum";
  enumValues?: string[];               // OPEN enum: unseen value ⇒ candidate change if breadth sparse
  required: boolean;
}

export interface ExtractionSpec {
  specId: string;
  source: SourceId;
  version: number;
  targetUrl: string;
  interaction: Array<{ action: "scroll" | "click" | "wait"; selector?: string; ms?: number }>;
  fields: SpecField[];
  createdAt: string;
  supersedes: string | null;
}

export interface SourceExpectations {
  rowRange: [number, number];
  watchKeys: string[];                 // futurepedia: ["pricingModel", "category"]
  requiredFields: string[];
  presenceCanaries: string[];          // K always-on structural slots
  liveCanaries: string[];              // entityIds; only meaningful where turnover.hi <= 0.1
  turnover: { lo: number; hi: number };
  /** Overlap weight — pinned to 0 for producthunt (full daily turnover by design). */
  overlapWeight: number;
  rankNoiseFloor: number;
  metricDeltaFloors: Record<string, number>;
}

export interface Diagnosis {
  verdict: SnapshotStatus;
  reasons: string[];
  brokenFields: Array<{
    field: string;
    baselineCoverage: number;
    observedCoverage: number;
    symptom: "missing" | "misaligned" | "malformed" | "empty";
    sampleBefore?: string;
    sampleAfter?: string;
  }>;
  suggestedHealPrompt: string;         // rendered, then truncated to the hard 1000-char API cap
}

export type HealState =
  | "proposed" | "preview_verified" | "approved"
  | "post_verified" | "active" | "rolled_back" | "rejected";

export interface HealAttempt {
  attemptId: string;
  source: SourceId;
  channel: Channel;
  collectorId: string;
  state: HealState;
  triggeredBy: Diagnosis;
  prompt: string;
  attempt: number;
  proposalId: string | null;
  /** Dumped BEFORE the heal — without this there is no rollback path. */
  priorTemplateRef: string | null;
  healthBefore: ExtractionHealth;
  healthAfter: ExtractionHealth | null;
  previewVerified: boolean;
  postVerified: boolean;
  at: string;
}

// ─── baselines ───────────────────────────────────────────────────────────────

export interface Baseline {
  source: SourceId;
  channel: Channel;
  version: number;
  signed: boolean;
  signedKeys: string[];                // per-watch-key signing, not one boolean over the snapshot
  rowCountMean: number;
  rowCountStd: number;
  fieldCoverage: Record<string, number>;
  /** Learned per-field value vocabularies, used for row-wise confusion scoring. */
  vocabularies: Record<string, string[]>;
  replacementSamples: number[];        // empirical band emerges from data, not a hand-typed table
  healthySnapshotIds: string[];
  updatedAt: string;
}
