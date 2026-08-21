import type { Command } from "commander";
import { listCaptures, captureIso, preflight, ARCHIVE_PARSERS, WaybackBackend } from "../../core/backend/wayback.ts";
import { getAdapter } from "../../core/sources/index.ts";
import { runSource } from "../../core/pipeline.ts";
import { recomputeBaseline, signBaseline } from "../../core/validate/baseline.ts";
import { loadWeights } from "../../core/config.ts";
import { sleep, shortHash } from "../../core/util.ts";
import type { SourceId, Channel } from "../../core/types.ts";

export function registerBackfill(program: Command): void {
  program
    .command("backfill <source>")
    .description("Seed real history from the Wayback Machine (server-rendered sources only)")
    .option("--from <yyyymmdd>", "start date", "20250101")
    .option("--to <yyyymmdd>", "end date")
    .option("--limit <n>", "max captures", "40")
    .option("--per-day", "one capture per day (default: per month)")
    .option("--preflight", "probe three eras and exit")
    .option("--run <id>", "resume/label this backfill run")
    .action(async (source: string, opts: Record<string, string | boolean | undefined>) => {
      const adapter = getAdapter(source);
      const parser = ARCHIVE_PARSERS[source];

      if (!parser) {
        // Futurepedia et al: archived captures are app shells with no data in them at all.
        throw new Error(
          `"${source}" is not replayable. Its archived captures are client-rendered shells with no ` +
          `records in the HTML. Only server-rendered sources (${Object.keys(ARCHIVE_PARSERS).join(", ")}) can be seeded.`,
        );
      }

      if (opts["preflight"]) {
        const p = await preflight(source, adapter.targetUrl, {
          from: String(opts["from"]), ...(opts["to"] ? { to: String(opts["to"]) } : {}),
        });
        console.log(`\n  preflight ${source}: ${p.ok ? "OK" : "FAILED"}\n  ${p.detail}\n`);
        return;
      }

      const runLabel = String(opts["run"] ?? shortHash(`${source}${opts["from"]}${opts["to"]}`, 8));
      const channel = `replay:${runLabel}` as Channel;

      const captures = await listCaptures({
        url: adapter.targetUrl,
        from: String(opts["from"]),
        ...(opts["to"] ? { to: String(opts["to"]) } : {}),
        collapseDigits: opts["perDay"] ? 8 : 6,
        limit: Number(opts["limit"] ?? 40),
      });
      if (!captures.length) { console.log("\n  no captures found.\n"); return; }

      // Oldest → newest so the history reads forward, the way it actually happened.
      captures.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      console.log(`\n  backfill ${source}  ·  channel ${channel}`);
      console.log(`  ${captures.length} captures, ${captures[0]!.timestamp.slice(0, 8)} → ${captures.at(-1)!.timestamp.slice(0, 8)}\n`);

      const w = loadWeights();
      let ok = 0, empty = 0, events = 0;

      for (const [i, cap] of captures.entries()) {
        const capturedAt = captureIso(cap.timestamp);
        try {
          const r = await runSource({
            source: source as SourceId, channel,
            collectorId: `wayback:${source}`,
            backend: new WaybackBackend(parser, cap),
            url: adapter.targetUrl,
            capturedAt,
            runId: `replay_${cap.timestamp}`,
            storeRaw: false,
          });
          const n = r.snapshot.records.length;
          if (n === 0) empty++; else ok++;
          events += r.eventsWritten;
          console.log(`  ${String(i + 1).padStart(3)}/${captures.length}  ${cap.timestamp.slice(0, 8)}  rows=${String(n).padStart(3)}  ${r.snapshot.status.padEnd(12)} events=${r.eventsWritten}`);

          // Sign the replay baseline once enough clean history exists, so later captures
          // classify normally instead of sitting in `calibrating` forever.
          if (ok === w.calibrationRuns) {
            await recomputeBaseline(source as SourceId, channel, adapter.expectations, w.baselineWindow);
            await signBaseline(source as SourceId, channel, adapter.expectations.watchKeys);
            console.log(`         ↳ replay baseline signed after ${ok} clean captures`);
          }
        } catch (e) {
          console.log(`  ${String(i + 1).padStart(3)}/${captures.length}  ${cap.timestamp.slice(0, 8)}  error: ${(e as Error).message.slice(0, 60)}`);
        }
        await sleep(1200);   // archive.org rate-limits; be a good citizen
      }

      console.log(`\n  ${ok} captures ingested, ${empty} empty, ${events} change events.`);
      console.log(`  view: driftwatch timeline ${source} --channel ${channel}\n`);
    });
}
