/** Rolling baseline. Updated from HEALTHY snapshots only; never from a break. */
import { collections } from "../db.ts";
import { mean, stddev, percentile, jaccard } from "../util.ts";
import { fieldValue } from "./schema.ts";
import type { Baseline, Snapshot, SourceId, Channel, NormalizedRecord, SourceExpectations } from "../types.ts";
import { nowIso } from "../util.ts";

export async function getBaseline(source: SourceId, channel: Channel): Promise<Baseline | null> {
  const c = await collections();
  return c.baselines.findOne({ source, channel } as Partial<Baseline>);
}

export function entityIds(records: NormalizedRecord[]): Set<string> {
  return new Set(records.map((r) => r.entityId));
}

/** Empirical replacement band from the source's own history — no hand-typed constants. */
export function replacementBand(samples: number[], minSamples: number): [number, number] | null {
  if (samples.length < minSamples) return null;
  return [percentile(samples, 5), percentile(samples, 95)];
}

export async function recomputeBaseline(
  source: SourceId, channel: Channel, exp: SourceExpectations, window: number,
): Promise<Baseline> {
  const c = await collections();
  const healthy = await c.snapshots
    .find({ source, channel, status: "healthy" } as Partial<Snapshot>)
    .sort({ capturedAt: -1 }).limit(window).toArray();

  const rowCounts = healthy.map((s) => s.records.length);
  const coverage: Record<string, number> = {};
  const vocab: Record<string, Set<string>> = {};
  const fields = new Set<string>([...exp.watchKeys, ...exp.requiredFields, "title"]);

  for (const f of fields) {
    const per: number[] = [];
    vocab[f] = new Set<string>();
    for (const s of healthy) {
      const n = s.records.length;
      if (!n) continue;
      per.push(s.records.filter((r) => fieldValue(r, f) !== null).length / n);
      for (const r of s.records) {
        const v = fieldValue(r, f);
        if (v !== null && vocab[f]!.size < 500) vocab[f]!.add(String(v));
      }
    }
    coverage[f] = mean(per);
  }

  // Replacement samples: consecutive healthy pairs, newest first.
  const samples: number[] = [];
  for (let i = 0; i + 1 < healthy.length; i++) {
    samples.push(1 - jaccard(entityIds(healthy[i]!.records), entityIds(healthy[i + 1]!.records)));
  }

  const existing = await getBaseline(source, channel);
  const baseline: Baseline = {
    source, channel,
    version: existing ? existing.version : 1,
    signed: existing?.signed ?? false,
    signedKeys: existing?.signedKeys ?? [],
    rowCountMean: mean(rowCounts),
    rowCountStd: stddev(rowCounts),
    fieldCoverage: coverage,
    vocabularies: Object.fromEntries(Object.entries(vocab).map(([k, v]) => [k, [...v]])),
    replacementSamples: samples,
    healthySnapshotIds: healthy.map((s) => s.snapshotId),
    updatedAt: nowIso(),
  };

  await c.baselines.updateOne({ source, channel } as Partial<Baseline>, { $set: baseline }, { upsert: true });
  return baseline;
}

export async function signBaseline(
  source: SourceId, channel: Channel, keys: string[],
): Promise<Baseline | null> {
  const c = await collections();
  const b = await getBaseline(source, channel);
  if (!b) return null;
  const merged = [...new Set([...b.signedKeys, ...keys])];
  await c.baselines.updateOne(
    { source, channel } as Partial<Baseline>,
    { $set: { signedKeys: merged, signed: true, updatedAt: nowIso() } },
  );
  return { ...b, signedKeys: merged, signed: true };
}
