import type { Command } from "commander";
import { collections } from "../../core/db.ts";
import { diffSnapshots } from "../../core/diff.ts";
import { getAdapter } from "../../core/sources/index.ts";
import type { CandidateChange } from "../../core/types.ts";

/** Quarantined `degraded` output is promoted only deliberately, never automatically. */
export function registerReview(program: Command): void {
  program
    .command("review [source]")
    .description("Inspect quarantined candidate changes; promote or discard them")
    .option("--channel <channel>", "isolation channel", "live")
    .option("--promote <eventId>", "promote one candidate into the event stream")
    .option("--discard <eventId>", "discard one candidate")
    .option("--discard-all", "discard every pending candidate for this source/channel")
    .option("--json", "machine-readable output")
    .action(async (source: string | undefined, opts: Record<string, string | boolean | undefined>) => {
      const c = await collections();
      const filter: Record<string, unknown> = { promotedBy: null, channel: opts["channel"] };
      if (source) filter["source"] = source;

      if (opts["promote"]) {
        const cand = await c.candidates.findOne({ eventId: opts["promote"] } as Record<string, unknown>);
        if (!cand) throw new Error(`no pending candidate ${String(opts["promote"])}`);
        const { promotedBy: _p, observedRuns: _o, expiresAfterRun: _e, ...event } = cand as CandidateChange;
        await c.changeEvents.insertOne({ ...event, confidence: 1 } as never).catch(() => {});
        await c.candidates.deleteOne({ eventId: cand.eventId } as Record<string, unknown>);
        console.log(`\n  promoted ${cand.eventId} → event stream (confidence raised to 1.0)\n`);
        return;
      }
      if (opts["discard"]) {
        const r = await c.candidates.deleteOne({ eventId: opts["discard"] } as Record<string, unknown>);
        console.log(`\n  discarded ${r.deletedCount} candidate\n`);
        return;
      }
      if (opts["discardAll"]) {
        const r = await c.candidates.deleteMany(filter);
        console.log(`\n  discarded ${r.deletedCount} candidates\n`);
        return;
      }

      const pending = await c.candidates.find(filter).sort({ intervalEnd: -1 }).limit(60).toArray();
      if (opts["json"]) { console.log(JSON.stringify(pending, null, 2)); return; }
      if (!pending.length) { console.log("\n  no quarantined candidates.\n"); return; }

      console.log(`\n  ${pending.length} quarantined candidates (degraded output — NOT published)\n`);
      for (const p of pending) {
        console.log(`  ${p.changeType.padEnd(19)} ${p.entityTitle}`);
        console.log(`  ${"".padEnd(19)} ${p.field ? `${p.field}: ` : ""}${String(p.from)} → ${String(p.to)}`);
        console.log(`  ${"".padEnd(19)} ${p.eventId}  expires after run ${p.expiresAfterRun}`);
      }
      console.log(`\n  promote: driftwatch review --promote <eventId>\n  discard: driftwatch review --discard <eventId>\n`);
    });

  program
    .command("diff <snapshotA> <snapshotB>")
    .description("Explicit diff between two snapshots")
    .option("--json", "machine-readable output")
    .action(async (a: string, b: string, opts: { json?: boolean }) => {
      const c = await collections();
      const [sa, sb] = await Promise.all([
        c.snapshots.findOne({ snapshotId: a } as Record<string, unknown>),
        c.snapshots.findOne({ snapshotId: b } as Record<string, unknown>),
      ]);
      if (!sa) throw new Error(`snapshot ${a} not found`);
      if (!sb) throw new Error(`snapshot ${b} not found`);

      const events = diffSnapshots(sa, sb, getAdapter(sa.source).expectations, 0, 1);
      if (opts.json) { console.log(JSON.stringify(events, null, 2)); return; }
      console.log(`\n  ${sa.capturedAt.slice(0, 19)} (${sa.status}) → ${sb.capturedAt.slice(0, 19)} (${sb.status})`);
      console.log(`  ${events.length} differences\n`);
      for (const e of events.slice(0, 60)) {
        console.log(`  ${e.changeType.padEnd(19)} ${e.entityTitle}  ${e.field ? `${e.field}: ` : ""}${String(e.from)} → ${String(e.to)}`);
      }
      console.log("");
    });
}
