import { collections } from "../db.ts";
import type { ChangeEvent, Snapshot } from "../types.ts";

export interface DashboardQueryState {
  events: ChangeEvent[];
  latestSnapshots: Snapshot[];
  trustedSnapshots: Snapshot[];
  eventCountsBySnapshot: Record<string, number>;
}

async function latestSnapshots(match: Record<string, unknown>): Promise<Snapshot[]> {
  const c = await collections();
  return c.snapshots.aggregate<Snapshot>([
    { $match: match },
    { $sort: { capturedAt: -1 } },
    { $group: { _id: "$source", snapshot: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$snapshot" } },
  ]).toArray();
}

export async function queryDashboardState(): Promise<DashboardQueryState> {
  const c = await collections();
  const [latest, trusted, events] = await Promise.all([
    latestSnapshots({ channel: "live" }),
    latestSnapshots({ channel: "live", status: "healthy" }),
    c.changeEvents.find({ channel: "live" } as Partial<ChangeEvent>)
      .sort({ intervalEnd: -1 }).limit(300).toArray(),
  ]);
  const snapshotIds = latest.map((snapshot) => snapshot.snapshotId);
  const counts = snapshotIds.length === 0 ? [] : await c.changeEvents.aggregate<{ _id: string; count: number }>([
    { $match: { channel: "live", toSnapshot: { $in: snapshotIds } } },
    { $group: { _id: "$toSnapshot", count: { $sum: 1 } } },
  ]).toArray();

  return {
    events,
    latestSnapshots: latest,
    trustedSnapshots: trusted,
    eventCountsBySnapshot: Object.fromEntries(counts.map((item) => [item._id, item.count])),
  };
}
