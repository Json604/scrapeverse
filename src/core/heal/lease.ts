/**
 * A collector is shared MUTABLE REMOTE state.
 *
 * Cron, manual runs, retries and backfill can all submit competing heals, and an `approve` could
 * otherwise commit another attempt's proposal. Bright Data's AI-Flow also returns a
 * concurrent-job 429. A TTL'd lease with a fencing token serializes this; the TTL means a dead
 * process cannot wedge a source permanently.
 */
import { getDb } from "../db.ts";
import { uuid, nowIso } from "../util.ts";

export interface Lease { collectorId: string; channel: string; token: string; expiresAt: string; holder: string }

const DEFAULT_TTL_MS = 20 * 60 * 1000;

export async function acquireLease(
  collectorId: string, channel: string, ttlMs = DEFAULT_TTL_MS,
): Promise<Lease | null> {
  const col = (await getDb()).collection("leases");
  await col.createIndex({ collectorId: 1, channel: 1 }, { unique: true }).catch(() => {});
  const now = new Date().toISOString();
  const lease: Lease = {
    collectorId, channel, token: uuid(),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    holder: `${process.pid}@${process.env["HOSTNAME"] ?? "local"}`,
  };

  // CAS: take it only if free or expired.
  const res = await col.findOneAndUpdate(
    { collectorId, channel, $or: [{ expiresAt: { $lt: now } }, { expiresAt: { $exists: false } }] },
    { $set: lease },
    { upsert: false, returnDocument: "after" },
  );
  if (res) return lease;

  try {
    await col.insertOne(lease as unknown as Record<string, unknown>);
    return lease;
  } catch {
    return null;   // someone else holds a live lease
  }
}

/** Every mutating step re-checks the token: a stale holder must never commit. */
export async function holdsLease(lease: Lease): Promise<boolean> {
  const col = (await getDb()).collection("leases");
  const cur = await col.findOne({ collectorId: lease.collectorId, channel: lease.channel });
  return !!cur && cur["token"] === lease.token && String(cur["expiresAt"]) > nowIso();
}

export async function releaseLease(lease: Lease): Promise<void> {
  const col = (await getDb()).collection("leases");
  await col.deleteOne({ collectorId: lease.collectorId, channel: lease.channel, token: lease.token });
}
