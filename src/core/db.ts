/**
 * MongoDB access.
 *
 * Cached-global client: Vercel's read API (Phase B) runs serverless, and a fresh pool per
 * invocation exhausts Atlas connection limits. Small pool, zero minimum.
 */
import { MongoClient, type Collection, type Db } from "mongodb";
import { config } from "./config.ts";
import type {
  Snapshot, ChangeEvent, CandidateChange, Baseline, HealAttempt, ExtractionSpec,
} from "./types.ts";

export interface OutboxRecord {
  outboxId: string;
  runId: string;
  source: string;
  channel: string;
  kind: "events" | "candidates";
  payload: unknown[];
  committed: boolean;
  createdAt: string;
}

export interface CanaryRecord {
  source: string;
  channel: string;
  entityId: string;
  field: string;
  expected: string | number | null;
  confirmedAt: string;
}

interface Cache { client: MongoClient | null; promise: Promise<MongoClient> | null }
const g = globalThis as unknown as { __driftwatch?: Cache };
const cache: Cache = (g.__driftwatch ??= { client: null, promise: null });

/** DNS SRV lookups for `mongodb+srv://` fail intermittently (ESERVFAIL/EAI_AGAIN). Retry them. */
const TRANSIENT = /ESERVFAIL|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|querySrv|queryTxt/i;

async function connectWithRetry(attempts = 4): Promise<MongoClient> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await new MongoClient(config.mongoUri, {
        maxPoolSize: 10,
        minPoolSize: 0,
        maxIdleTimeMS: 30_000,
        serverSelectionTimeoutMS: 10_000,
      }).connect();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? `${e.message}${(e as { code?: string }).code ?? ""}` : String(e);
      if (!TRANSIENT.test(msg) || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `could not connect to MongoDB after ${attempts} attempts: ${msg}\n` +
    `If this is a DNS error, it is usually transient — retry. ` +
    `Otherwise check MONGODB_URI and that Atlas Network Access allows your IP (0.0.0.0/0 for CI).`,
  );
}

export async function getClient(): Promise<MongoClient> {
  if (cache.client) return cache.client;
  if (!cache.promise) {
    // Clear the cached promise on failure so a transient error does not poison every later call.
    cache.promise = connectWithRetry().catch((e: unknown) => { cache.promise = null; throw e; });
  }
  cache.client = await cache.promise;
  return cache.client;
}

export async function getDb(): Promise<Db> {
  return (await getClient()).db(config.dbName);
}

export async function collections() {
  const db = await getDb();
  return {
    snapshots: db.collection("snapshots") as unknown as Collection<Snapshot>,
    changeEvents: db.collection("changeEvents") as unknown as Collection<ChangeEvent>,
    candidates: db.collection("candidates") as unknown as Collection<CandidateChange>,
    baselines: db.collection("baselines") as unknown as Collection<Baseline>,
    healLog: db.collection("healLog") as unknown as Collection<HealAttempt>,
    specs: db.collection("specs") as unknown as Collection<ExtractionSpec>,
    canaries: db.collection("canaries") as unknown as Collection<CanaryRecord>,
    outbox: db.collection("outbox") as unknown as Collection<OutboxRecord>,
    rawCaptures: db.collection("rawCaptures"),
    evalSet: db.collection("evalSet"),
  };
}

/**
 * Idempotency: unique keys make a retry after a partial write a no-op instead of
 * duplicated history. Every query index carries `channel` so live/replay/fixture never mix.
 */
export async function ensureIndexes(): Promise<string[]> {
  const c = await collections();
  const made: string[] = [];
  const add = async (name: string, fn: () => Promise<unknown>) => { await fn(); made.push(name); };

  await add("snapshots.snapshotId", () =>
    c.snapshots.createIndex({ snapshotId: 1 }, { unique: true }));
  await add("snapshots.runKey", () =>
    c.snapshots.createIndex({ source: 1, channel: 1, runId: 1 }, { unique: true }));
  await add("snapshots.timeline", () =>
    c.snapshots.createIndex({ source: 1, channel: 1, capturedAt: -1 }));
  await add("snapshots.health", () =>
    c.snapshots.createIndex({ source: 1, channel: 1, status: 1, capturedAt: -1 }));

  await add("changeEvents.eventId", () =>
    c.changeEvents.createIndex({ eventId: 1 }, { unique: true }));
  await add("changeEvents.timeline", () =>
    c.changeEvents.createIndex({ source: 1, channel: 1, intervalEnd: -1 }));
  await add("changeEvents.entity", () =>
    c.changeEvents.createIndex({ entityId: 1, field: 1, intervalEnd: -1 }));
  await add("changeEvents.byType", () =>
    c.changeEvents.createIndex({ source: 1, changeType: 1, intervalEnd: -1 }));

  await add("candidates.eventId", () =>
    c.candidates.createIndex({ eventId: 1 }, { unique: true }));
  await add("candidates.pending", () =>
    c.candidates.createIndex({ source: 1, channel: 1, promotedBy: 1, expiresAfterRun: 1 }));

  await add("baselines.key", () =>
    c.baselines.createIndex({ source: 1, channel: 1 }, { unique: true }));
  await add("healLog.recent", () =>
    c.healLog.createIndex({ source: 1, channel: 1, at: -1 }));
  await add("healLog.attemptId", () =>
    c.healLog.createIndex({ attemptId: 1 }, { unique: true }));
  await add("specs.version", () =>
    c.specs.createIndex({ source: 1, version: -1 }));
  await add("canaries.key", () =>
    c.canaries.createIndex({ source: 1, channel: 1, entityId: 1, field: 1 }, { unique: true }));
  await add("outbox.pending", () =>
    c.outbox.createIndex({ committed: 1, createdAt: 1 }));
  await add("outbox.outboxId", () =>
    c.outbox.createIndex({ outboxId: 1 }, { unique: true }));

  return made;
}

export async function ping(): Promise<{ ok: boolean; ms: number; host: string }> {
  const t0 = Date.now();
  const client = await getClient();
  await client.db("admin").command({ ping: 1 });
  const host = new URL(config.mongoUri).host;
  return { ok: true, ms: Date.now() - t0, host };
}

export async function closeClient(): Promise<void> {
  if (cache.client) {
    await cache.client.close();
    cache.client = null;
    cache.promise = null;
  }
}
