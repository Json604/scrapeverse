import type { Channel, SnapshotStatus, SourceId } from "../types.ts";
import type { GateAction } from "../gate.ts";

/** One source after `run`. Cron heals from this, not from a second Mongo round-trip. */
export interface RunHealCandidate {
  source: SourceId;
  channel: Channel;
  status: SnapshotStatus;
  action: GateAction;
  collectorId: string;
}

/**
 * Cron may fire the heal saga. Local `run` does not, unless `--heal-on-break`.
 *
 * Constraints, each from a real failure:
 *  - live channel only — Mongo isolation does not protect the shared Studio collector
 *  - `c_*` collectors only — fixture paths are not Studio ids
 *  - `action === "heal"` only — degraded quarantines; it does not mutate the scraper
 *  - cap per tick — a saga is ~15 minutes; Actions is 45 and still has the scrape loop
 */
export function pickHealTargets<T extends RunHealCandidate>(
  results: readonly T[],
  opts: { enabled: boolean; limit: number },
): T[] {
  if (!opts.enabled || opts.limit <= 0) return [];
  return results
    .filter((row) =>
      row.channel === "live" &&
      row.status === "broken" &&
      row.action === "heal" &&
      /^c_[a-z0-9]+$/i.test(row.collectorId),
    )
    .slice(0, opts.limit);
}
