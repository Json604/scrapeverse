/**
 * Diff between two snapshots.
 *
 * Diffs title, canonicalUrl, EVERY keyed metric, and the source's watchKeys. An earlier draft
 * hashed "slow-moving attributes" and diffed the hash, which both hid the money field
 * (pricingModel was excluded from the hash) and turned every copy tweak into an event.
 */
import type {
  NormalizedRecord, ChangeEvent, ChangeType, Snapshot, SourceExpectations, ScalarOrNull,
} from "./types.ts";
import { fieldValue } from "./validate/schema.ts";
import { shortHash, canonical } from "./util.ts";

export interface DiffContext {
  fromSnapshot: string;
  toSnapshot: string;
  intervalStart: string;
  intervalEnd: string;
  gapCount: number;
  confidence: number;
  channel: string;
}

export function eventId(
  channel: string, source: string, entityId: string,
  changeType: ChangeType, field: string | undefined,
  from: ScalarOrNull, to: ScalarOrNull, toSnapshot: string,
): string {
  return `ev_${shortHash(canonical({ channel, source, entityId, changeType, field: field ?? null, from, to, toSnapshot }), 20)}`;
}

function mk(
  rec: NormalizedRecord, changeType: ChangeType,
  from: ScalarOrNull, to: ScalarOrNull, ctx: DiffContext,
  field?: string, delta?: number,
): ChangeEvent {
  return {
    eventId: eventId(ctx.channel, rec.source, rec.entityId, changeType, field, from, to, ctx.toSnapshot),
    source: rec.source,
    channel: ctx.channel as ChangeEvent["channel"],
    entityId: rec.entityId,
    entityTitle: rec.title,
    changeType,
    ...(field ? { field } : {}),
    from, to,
    ...(delta !== undefined ? { delta } : {}),
    fromSnapshot: ctx.fromSnapshot,
    toSnapshot: ctx.toSnapshot,
    intervalStart: ctx.intervalStart,
    intervalEnd: ctx.intervalEnd,
    gapCount: ctx.gapCount,
    confidence: ctx.confidence,
  };
}

/** A slug migration is a RENAME, not a disappearance plus an arrival. */
function matchRenames(
  entered: NormalizedRecord[], left: NormalizedRecord[],
): Array<{ before: NormalizedRecord; after: NormalizedRecord }> {
  const pairs: Array<{ before: NormalizedRecord; after: NormalizedRecord }> = [];
  const usedLeft = new Set<string>();
  for (const a of entered) {
    const m = left.find((b) =>
      !usedLeft.has(b.entityId) &&
      (b.canonicalUrl === a.canonicalUrl ||
        (b.title.length > 3 && b.title.toLowerCase() === a.title.toLowerCase())));
    if (m) { usedLeft.add(m.entityId); pairs.push({ before: m, after: a }); }
  }
  return pairs;
}

export function diffRecords(
  prev: NormalizedRecord[], curr: NormalizedRecord[],
  exp: SourceExpectations, ctx: DiffContext,
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const p = new Map(prev.map((r) => [r.entityId, r]));
  const c = new Map(curr.map((r) => [r.entityId, r]));

  const entered = curr.filter((r) => !p.has(r.entityId));
  const left = prev.filter((r) => !c.has(r.entityId));
  const renames = matchRenames(entered, left);
  const renamedIn = new Set(renames.map((r) => r.after.entityId));
  const renamedOut = new Set(renames.map((r) => r.before.entityId));

  for (const { before, after } of renames) {
    events.push(mk(after, "RENAMED", before.entityId, after.entityId, ctx, "entityId"));
  }
  for (const r of entered) if (!renamedIn.has(r.entityId)) events.push(mk(r, "ENTERED", null, r.rank, ctx));
  for (const r of left) if (!renamedOut.has(r.entityId)) events.push(mk(r, "LEFT", r.rank, null, ctx));

  for (const cur of curr) {
    const before = p.get(cur.entityId);
    if (!before) continue;

    const rankDelta = before.rank - cur.rank;              // positive = moved up
    if (Math.abs(rankDelta) >= exp.rankNoiseFloor) {
      events.push(mk(cur, rankDelta > 0 ? "RANK_UP" : "RANK_DOWN", before.rank, cur.rank, ctx, "rank", rankDelta));
    }

    if (before.title !== cur.title) events.push(mk(cur, "TITLE_CHANGED", before.title, cur.title, ctx, "title"));
    if (before.canonicalUrl !== cur.canonicalUrl) {
      events.push(mk(cur, "URL_CHANGED", before.canonicalUrl, cur.canonicalUrl, ctx, "canonicalUrl"));
    }

    for (const [name, metric] of Object.entries(cur.metrics)) {
      const prior = before.metrics[name];
      if (!prior) continue;
      const delta = metric.value - prior.value;
      const floor = exp.metricDeltaFloors[name] ?? 0;
      if (Math.abs(delta) > floor) {
        events.push(mk(cur, "METRIC_DELTA", prior.value, metric.value, ctx, name, delta));
      }
    }

    for (const key of exp.watchKeys) {
      const a = fieldValue(before, key), b = fieldValue(cur, key);
      if (String(a ?? "") !== String(b ?? "")) {
        events.push(mk(cur, "ATTRIBUTE_CHANGED", a, b, ctx, key));
      }
    }
  }
  return events;
}

export function diffSnapshots(prev: Snapshot, curr: Snapshot, exp: SourceExpectations, gapCount: number, confidence = 1): ChangeEvent[] {
  return diffRecords(prev.records, curr.records, exp, {
    fromSnapshot: prev.snapshotId, toSnapshot: curr.snapshotId,
    intervalStart: prev.capturedAt, intervalEnd: curr.capturedAt,
    gapCount, confidence, channel: curr.channel,
  });
}
