import type { Command } from "commander";
import { runSource } from "../../core/pipeline.ts";
import { getAdapter, allSourceIds, DAILY_SOURCES } from "../../core/sources/index.ts";
import { BrightDataBackend } from "../../core/backend/brightdata.ts";
import { FixtureBackend } from "../../core/backend/fixture.ts";
import { collections } from "../../core/db.ts";
import { CliCollectorAdmin } from "../../core/heal/admin.ts";
import { healSource } from "../../core/heal/saga.ts";
import { diagnosisFromSnapshot } from "../../core/heal/diagnose.ts";
import { pickHealTargets, type RunHealCandidate } from "../../core/heal/cron.ts";
import type { SourceId, Channel, Snapshot } from "../../core/types.ts";
import type { GateAction } from "../../core/gate.ts";

export function registerRun(program: Command): void {
  program
    .command("run <source>")
    .description('Run the loop for a source (or "all"): fetch → validate → gate → diff → store')
    .option("--channel <channel>", "isolation channel", "live")
    .option("--collector <id>", "collector id (defaults to the stored one for this source)")
    .option("--fixture <path>", "use the local fixture backend instead of Bright Data")
    .option("--url <url>", "override the target url")
    .option("--monthly", 'with "all", include the slow monthly overlay sources')
    .option("--heal-on-break", "if the gate says heal, run the saga (cron). Never --auto-approve.")
    .option("--heal-limit <n>", "max heals this invocation (Actions is 45 minutes)", "1")
    .option("--json", "machine-readable output")
    .action(async (source: string, opts: {
      channel: string; collector?: string; fixture?: string; url?: string; json?: boolean; monthly?: boolean;
      healOnBreak?: boolean; healLimit?: string;
    }) => {
      const ids: SourceId[] = source === "all"
        ? (opts.monthly ? allSourceIds() : DAILY_SOURCES())
        : [source as SourceId];
      const channel = opts.channel as Channel;
      const results: Array<{
        source: SourceId;
        status: string;
        rows: number;
        action: GateAction;
        reason: string;
        events: number;
        candidates: number;
        snapshotId: string | null;
        inserted: boolean;
        heal?: { state: string; message: string };
      }> = [];
      const healCandidates: Array<RunHealCandidate & { snapshot: Snapshot | null }> = [];

      for (const id of ids) {
        const adapter = getAdapter(id);
        const backend = opts.fixture ? new FixtureBackend() : new BrightDataBackend();
        const collectorId = opts.fixture ?? opts.collector ?? (await storedCollector(id)) ?? "";
        if (!collectorId) {
          if (source === "all") {
            results.push({
              source: id, status: "skipped", rows: 0, action: "store_only",
              reason: "no collector created yet", events: 0, candidates: 0,
              snapshotId: null, inserted: false,
            });
            if (!opts.json) console.log(`\n  ${id}\n  skipped — no collector. driftwatch collector create ${id}`);
            continue;
          }
          throw new Error(`no collector for "${id}". Run: driftwatch collector create ${id}`);
        }

        const r = await runSource({
          source: id,
          channel,
          collectorId,
          backend,
          ...(opts.url ? { url: opts.url } : {}),
        });

        results.push({
          source: id, status: r.snapshot.status, rows: r.snapshot.records.length,
          action: r.gate.action, reason: r.gate.reason,
          events: r.eventsWritten, candidates: r.candidatesWritten,
          snapshotId: r.snapshot.snapshotId, inserted: r.inserted,
        });
        healCandidates.push({
          source: id, channel, status: r.snapshot.status,
          action: r.gate.action, collectorId, snapshot: r.snapshot,
        });

        if (!opts.json) {
          const s = results.at(-1)!;
          console.log(`\n  ${id}`);
          console.log(`  ${"─".repeat(52)}`);
          console.log(`  status     ${s.status}`);
          console.log(`  rows       ${s.rows}  (expected ${adapter.expectations.rowRange.join("–")})`);
          console.log(`  action     ${s.action}  — ${s.reason}`);
          console.log(`  events     ${s.events}${s.candidates ? `   candidates ${s.candidates}` : ""}`);
          if (r.snapshot.health.hardSignals.length) {
            console.log(`  hard       ${r.snapshot.health.hardSignals.slice(0, 3).join("\n             ")}`);
          }
          if (r.snapshot.health.softSignals.length) {
            console.log(`  soft       ${r.snapshot.health.softSignals.slice(0, 3).join("\n             ")}`);
          }
        }
      }

      const healLimit = Math.max(0, Number.parseInt(opts.healLimit ?? "1", 10) || 1);
      const targets = pickHealTargets(healCandidates, { enabled: Boolean(opts.healOnBreak), limit: healLimit });
      for (const target of targets) {
        if (!target.snapshot) continue;
        const row = results.find((r) => r.source === target.source);
        try {
          const outcome = await healSource({
            source: target.source,
            channel: target.channel,
            collectorId: target.collectorId,
            diagnosis: diagnosisFromSnapshot(target.snapshot),
            before: target.snapshot,
            admin: new CliCollectorAdmin(),
            backend: opts.fixture ? new FixtureBackend() : new BrightDataBackend(),
          });
          if (row) row.heal = { state: outcome.state, message: outcome.message };
          if (!opts.json) {
            console.log(`\n  heal ${target.source}`);
            console.log(`  ${"─".repeat(52)}`);
            console.log(`  state      ${outcome.state}`);
            console.log(`  ${outcome.message}`);
          }
        } catch (e) {
          const message = (e as Error).message;
          if (row) row.heal = { state: "rejected", message };
          if (!opts.json) console.log(`\n  heal ${target.source} failed — ${message}`);
        }
      }

      if (opts.json) console.log(JSON.stringify(results, null, 2));
      else console.log("");
    });
}

async function storedCollector(source: SourceId): Promise<string | null> {
  const c = await collections();
  const doc = await c.specs.findOne({ source } as Record<string, unknown>, { sort: { version: -1 } });
  return (doc as unknown as { collectorId?: string })?.collectorId ?? null;
}
