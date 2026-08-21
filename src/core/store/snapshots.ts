import { collections } from "../db.ts";
import { canonical, sha256, uuid, nowIso } from "../util.ts";
import { stripPii } from "../sources/types.ts";
import type { Snapshot, NormalizedRecord, Channel, SourceId, ChangeEvent, CandidateChange } from "../types.ts";

/** Hash over normalized records only — job ids and timestamps deliberately excluded. */
export function payloadHash(records: NormalizedRecord[]): string {
  return sha256(canonical(records.map((r) => ({
    entityId: r.entityId, rank: r.rank, title: r.title, canonicalUrl: r.canonicalUrl,
    metrics: r.metrics, attributes: r.attributes,
  }))));
}

export async function lastSnapshot(source: SourceId, channel: Channel): Promise<Snapshot | null> {
  const c = await collections();
  return c.snapshots.findOne({ source, channel } as Partial<Snapshot>, { sort: { capturedAt: -1 } });
}

export async function lastHealthySnapshot(source: SourceId, channel: Channel): Promise<Snapshot | null> {
  const c = await collections();
  return c.snapshots.findOne(
    { source, channel, status: "healthy" } as Partial<Snapshot>,
    { sort: { capturedAt: -1 } },
  );
}

export async function recentSnapshots(source: SourceId, channel: Channel, limit: number, status?: string) {
  const c = await collections();
  const q: Record<string, unknown> = { source, channel };
  if (status) q["status"] = status;
  return c.snapshots.find(q as Partial<Snapshot>).sort({ capturedAt: -1 }).limit(limit).toArray();
}

/** Count snapshots skipped between two healthy points — makes event timing an honest range. */
export async function countGap(source: SourceId, channel: Channel, fromIso: string, toIso: string): Promise<number> {
  const c = await collections();
  return c.snapshots.countDocuments({
    source, channel,
    capturedAt: { $gt: fromIso, $lt: toIso },
    status: { $ne: "healthy" },
  } as Record<string, unknown>);
}

/**
 * Atomic-ish write: snapshot + outbox in one path, then commit derived rows.
 * Unique indexes make a retry a no-op rather than duplicated history.
 */
export async function saveSnapshot(
  snapshot: Snapshot,
  derived: { events?: ChangeEvent[]; candidates?: CandidateChange[]; raw?: unknown } = {},
): Promise<{ inserted: boolean; events: number; candidates: number }> {
  const c = await collections();

  try {
    await c.snapshots.insertOne(snapshot);
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      return { inserted: false, events: 0, candidates: 0 };   // already ingested; idempotent
    }
    throw e;
  }

  if (derived.raw !== undefined) {
    // PII is stripped BEFORE storage — the README cannot claim exclusion while raw retains bylines.
    await c.rawCaptures.insertOne({
      rawRef: snapshot.provenance.rawRef ?? snapshot.snapshotId,
      snapshotId: snapshot.snapshotId,
      source: snapshot.source, channel: snapshot.channel,
      capturedAt: snapshot.capturedAt,
      payload: stripPii(derived.raw),
    });
  }

  const events = derived.events ?? [];
  const candidates = derived.candidates ?? [];
  if (events.length || candidates.length) {
    await c.outbox.insertOne({
      outboxId: uuid(), runId: snapshot.runId,
      source: snapshot.source, channel: snapshot.channel,
      kind: events.length ? "events" : "candidates",
      payload: [...events, ...candidates],
      committed: false, createdAt: nowIso(),
    });
  }

  let wroteEvents = 0, wroteCandidates = 0;
  if (events.length) wroteEvents = await insertIgnoringDupes(c.changeEvents, events);
  if (candidates.length) wroteCandidates = await insertIgnoringDupes(c.candidates, candidates);

  await c.outbox.updateMany({ runId: snapshot.runId, committed: false }, { $set: { committed: true } });
  return { inserted: true, events: wroteEvents, candidates: wroteCandidates };
}

async function insertIgnoringDupes<T>(
  col: { insertMany(d: T[], o: { ordered: boolean }): Promise<{ insertedCount: number }> },
  docs: T[],
): Promise<number> {
  try {
    const r = await col.insertMany(docs, { ordered: false });
    return r.insertedCount;
  } catch (e) {
    // Duplicate key on a retry is the DESIGNED outcome, not a failure: the unique index is what
    // makes re-running a partially-written run safe. Count what actually landed and move on.
    const err = e as { result?: { insertedCount?: number; nInserted?: number }; code?: number };
    if (err.code === 11000 || err.result) {
      return err.result?.insertedCount ?? err.result?.nInserted ?? 0;
    }
    throw e;
  }
}
