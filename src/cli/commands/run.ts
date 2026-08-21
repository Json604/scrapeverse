import type { Command } from "commander";
import { runSource } from "../../core/pipeline.ts";
import { getAdapter, allSourceIds, DAILY_SOURCES } from "../../core/sources/index.ts";
import { BrightDataBackend } from "../../core/backend/brightdata.ts";
import { FixtureBackend } from "../../core/backend/fixture.ts";
import { collections } from "../../core/db.ts";
import type { SourceId, Channel } from "../../core/types.ts";

export function registerRun(program: Command): void {
  program
    .command("run <source>")
    .description('Run the loop for a source (or "all"): fetch → validate → gate → diff → store')
    .option("--channel <channel>", "isolation channel", "live")
    .option("--collector <id>", "collector id (defaults to the stored one for this source)")
    .option("--fixture <path>", "use the local fixture backend instead of Bright Data")
    .option("--url <url>", "override the target url")
    .option("--monthly", 'with "all", include the slow monthly overlay sources')
    .option("--json", "machine-readable output")
    .action(async (source: string, opts: {
      channel: string; collector?: string; fixture?: string; url?: string; json?: boolean; monthly?: boolean;
    }) => {
      const ids: SourceId[] = source === "all"
        ? (opts.monthly ? allSourceIds() : DAILY_SOURCES())
        : [source as SourceId];
      const results = [];

      for (const id of ids) {
        const adapter = getAdapter(id);
        const backend = opts.fixture ? new FixtureBackend() : new BrightDataBackend();
        const collectorId = opts.fixture ?? opts.collector ?? (await storedCollector(id)) ?? "";
        if (!collectorId) {
          throw new Error(`no collector for "${id}". Run: driftwatch collector create ${id}`);
        }

        const r = await runSource({
          source: id,
          channel: opts.channel as Channel,
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

      if (opts.json) console.log(JSON.stringify(results, null, 2));
      else console.log("");
    });
}

async function storedCollector(source: SourceId): Promise<string | null> {
  const c = await collections();
  const doc = await c.specs.findOne({ source } as Record<string, unknown>, { sort: { version: -1 } });
  return (doc as unknown as { collectorId?: string })?.collectorId ?? null;
}
