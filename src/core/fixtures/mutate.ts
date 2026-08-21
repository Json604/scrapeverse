/**
 * Mutation operators.
 *
 * Split into TUNING and HELD_OUT. The validator may be developed against tuning operators; held-out
 * operators are never used while tuning, so the eval can report a number that is not self-fulfilling.
 *
 * Crucially, a mutation is NOT automatically a break. Ground truth is whether the EXTRACTED records
 * differ from the canonical ones — if extraction survives a DOM change, that is successful
 * adaptation, and labelling it BREAK would teach the classifier the wrong thing.
 */
import type { NormalizedRecord } from "../types.ts";

export type TruthLabel = "BREAK" | "CHANGE" | "STALE" | "UNKNOWN";

export interface MutationOperator {
  name: string;
  kind: "structure" | "content" | "both" | "benign";
  truth: TruthLabel;
  apply(records: NormalizedRecord[], field: string): NormalizedRecord[];
}

const clone = (rs: NormalizedRecord[]): NormalizedRecord[] => rs.map((r) => ({
  ...r, metrics: { ...r.metrics }, attributes: { ...r.attributes },
}));

const OTHER_VOCAB = ["Cloud", "API", "Self-hosted", "Extension", "On-prem"];

// ── TUNING ───────────────────────────────────────────────────────────────────
export const TUNING: MutationOperator[] = [
  {
    name: "drop_field", kind: "structure", truth: "BREAK",
    apply: (rs, f) => clone(rs).map((r) => ({ ...r, attributes: { ...r.attributes, [f]: null } })),
  },
  {
    name: "column_swap", kind: "structure", truth: "BREAK",
    apply: (rs, f) => clone(rs).map((r) => {
      const other = Object.keys(r.attributes).find((k) => k !== f);
      return other ? { ...r, attributes: { ...r.attributes, [f]: r.attributes[other] ?? null } } : r;
    }),
  },
  {
    name: "untracked_column_swap", kind: "structure", truth: "BREAK",
    // The killer case: the drifted-to column is not tracked, so no vocabulary check can see it.
    apply: (rs, f) => clone(rs).map((r, i) => ({ ...r, attributes: { ...r.attributes, [f]: OTHER_VOCAB[i % OTHER_VOCAB.length]! } })),
  },
  {
    name: "truncate_list", kind: "structure", truth: "BREAK",
    apply: (rs) => clone(rs).slice(0, Math.max(1, Math.floor(rs.length * 0.7))),
  },
  {
    name: "single_value_flip", kind: "content", truth: "CHANGE",
    apply: (rs, f) => clone(rs).map((r, i) => (i === 3 ? { ...r, attributes: { ...r.attributes, [f]: "Paid" } } : r)),
  },
  {
    name: "rank_shuffle", kind: "content", truth: "CHANGE",
    apply: (rs) => { const c = clone(rs).reverse(); return c.map((r, i) => ({ ...r, rank: i + 1 })); },
  },
];

// ── HELD OUT — never used while tuning ───────────────────────────────────────
export const HELD_OUT: MutationOperator[] = [
  {
    name: "off_by_one_alignment", kind: "structure", truth: "BREAK",
    // Every row takes its NEIGHBOUR's value: coverage stays 100%, values stay in-vocabulary.
    apply: (rs, f) => { const c = clone(rs); return c.map((r, i) => ({ ...r, attributes: { ...r.attributes, [f]: rs[(i + 1) % rs.length]!.attributes[f] ?? null } })); },
  },
  {
    name: "partial_field_loss", kind: "structure", truth: "BREAK",
    apply: (rs, f) => clone(rs).map((r, i) => (i % 2 === 0 ? { ...r, attributes: { ...r.attributes, [f]: null } } : r)),
  },
  {
    name: "constant_collapse", kind: "structure", truth: "BREAK",
    apply: (rs, f) => clone(rs).map((r) => ({ ...r, attributes: { ...r.attributes, [f]: "Free" } })),
  },
  {
    name: "whitespace_noise", kind: "benign", truth: "CHANGE",
    // Cosmetic only. Must NOT read as a break — otherwise every re-render is an incident.
    apply: (rs, f) => clone(rs).map((r) => ({ ...r, attributes: { ...r.attributes, [f]: `${String(r.attributes[f] ?? "").trim()}` } })),
  },
  {
    name: "full_turnover", kind: "content", truth: "CHANGE",
    apply: (rs) => clone(rs).map((r, i) => ({
      ...r, nativeId: `fresh-${i}`, entityId: `${r.source}:fresh-${i}`, title: `Fresh ${i}`,
    })),
  },
  {
    name: "structure_and_content", kind: "both", truth: "BREAK",
    // The genuinely hard case an earlier draft excluded by construction.
    apply: (rs, f) => clone(rs).slice(0, Math.floor(rs.length * 0.75))
      .map((r, i) => ({ ...r, attributes: { ...r.attributes, [f]: OTHER_VOCAB[i % OTHER_VOCAB.length]! } })),
  },
];

export const ALL_OPERATORS = [...TUNING, ...HELD_OUT];
