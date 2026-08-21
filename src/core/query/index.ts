/**
 * Deterministic query functions: these are the substrate, and the agent's tools are
 * these exact functions — so every natural-language answer is reproducible by re-running a command.
 *
 * Query surfaces UNION channels by default (an earlier draft wrote `replay:*` events that
 * timeline/ask never read, making the entire backfill invisible).
 */
import { collections } from "../db.ts";
import type { ChangeEvent, ChangeType, Snapshot, SourceId } from "../types.ts";

export interface EventQuery {
  source?: string;
  channel?: string;          // omit to union all channels
  changeType?: ChangeType;
  entityId?: string;
  field?: string;
  since?: string;
  until?: string;
  limit?: number;
}

function toFilter(q: EventQuery): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (q.source) f["source"] = q.source;
  if (q.channel) f["channel"] = q.channel;
  if (q.changeType) f["changeType"] = q.changeType;
  if (q.entityId) f["entityId"] = q.entityId;
  if (q.field) f["field"] = q.field;
  if (q.since || q.until) {
    const r: Record<string, string> = {};
    if (q.since) r["$gte"] = q.since;
    if (q.until) r["$lte"] = q.until;
    f["intervalEnd"] = r;
  }
  return f;
}

export async function queryEvents(q: EventQuery = {}): Promise<ChangeEvent[]> {
  const c = await collections();
  return c.changeEvents.find(toFilter(q) as Partial<ChangeEvent>)
    .sort({ intervalEnd: -1 }).limit(Math.min(q.limit ?? 50, 500)).toArray();
}

export async function countEvents(q: EventQuery = {}): Promise<Record<string, number>> {
  const c = await collections();
  const rows = await c.changeEvents.aggregate([
    { $match: toFilter(q) },
    { $group: { _id: "$changeType", n: { $sum: 1 } } },
  ]).toArray();
  return Object.fromEntries(rows.map((r) => [String(r["_id"]), Number(r["n"])]));
}

/** git-blame for a leaderboard entity: when did each field last change, and by how much. */
export async function blameEntity(entityId: string): Promise<{
  entityId: string;
  fields: Array<{ field: string; from: unknown; to: unknown; at: string; since: string; gapCount: number; eventId: string }>;
  totalEvents: number;
}> {
  const c = await collections();
  const events = await c.changeEvents.find({ entityId } as Partial<ChangeEvent>)
    .sort({ intervalEnd: -1 }).limit(500).toArray();

  const seen = new Set<string>();
  const fields = [];
  for (const e of events) {
    const key = e.field ?? e.changeType;
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({ field: key, from: e.from, to: e.to, at: e.intervalEnd, since: e.intervalStart, gapCount: e.gapCount, eventId: e.eventId });
  }
  return { entityId, fields, totalEvents: events.length };
}

export async function timeline(source: string, opts: { channel?: string; limit?: number } = {}): Promise<Array<{
  snapshotId: string; capturedAt: string; channel: string; status: string; rows: number; events: number;
}>> {
  const c = await collections();
  const f: Record<string, unknown> = { source };
  if (opts.channel) f["channel"] = opts.channel;
  const snaps = await c.snapshots.find(f as Partial<Snapshot>)
    .sort({ capturedAt: -1 }).limit(opts.limit ?? 30).toArray();

  const out = [];
  for (const s of snaps) {
    const events = await c.changeEvents.countDocuments({ toSnapshot: s.snapshotId } as Record<string, unknown>);
    out.push({
      snapshotId: s.snapshotId, capturedAt: s.capturedAt, channel: s.channel,
      status: s.status, rows: s.records.length, events,
    });
  }
  return out;
}

export async function sourceHealth(source?: SourceId): Promise<Array<Record<string, unknown>>> {
  const c = await collections();
  const match = source ? { source } : {};
  return c.snapshots.aggregate([
    { $match: match },
    { $sort: { capturedAt: -1 } },
    { $group: {
      _id: { source: "$source", channel: "$channel" },
      lastStatus: { $first: "$status" }, lastRun: { $first: "$capturedAt" },
      rows: { $first: { $size: "$records" } }, snapshots: { $sum: 1 },
    } },
  ]).toArray();
}
