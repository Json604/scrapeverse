import type { Command } from "commander";
import { collections } from "../../core/db.ts";
import type { Snapshot, Baseline, SourceId } from "../../core/types.ts";

const ALL_SOURCES: SourceId[] = [
  "github_trending", "hf_trending", "producthunt",
  "hackernews", "futurepedia", "stackshare",
  "tiobe", "pypl", "tech_radar",
];

const STATUS_GLYPH: Record<string, string> = {
  healthy: "ok", degraded: "degraded", broken: "BROKEN",
  calibrating: "calibrating", stale: "stale", none: "—",
};

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Per-source health, last run, baseline state, and pending candidates")
    .option("--channel <channel>", "channel to report on", "live")
    .option("--json", "machine-readable output")
    .action(async (opts: { channel: string; json?: boolean }) => {
      const c = await collections();
      const rows = [];

      for (const source of ALL_SOURCES) {
        const last = await c.snapshots.findOne(
          { source, channel: opts.channel } as Partial<Snapshot>,
          { sort: { capturedAt: -1 } },
        );
        const baseline = await c.baselines.findOne(
          { source, channel: opts.channel } as Partial<Baseline>,
        );
        const candidates = await c.candidates.countDocuments({
          source, channel: opts.channel, promotedBy: null,
        } as Record<string, unknown>);
        const events = await c.changeEvents.countDocuments({
          source, channel: opts.channel,
        } as Record<string, unknown>);

        rows.push({
          source,
          status: last?.status ?? "none",
          rows: last?.records.length ?? 0,
          lastRun: last?.capturedAt ?? null,
          baseline: baseline ? `v${baseline.version}${baseline.signed ? " signed" : " UNSIGNED"}` : "none",
          events,
          candidates,
        });
      }

      if (opts.json) { console.log(JSON.stringify({ channel: opts.channel, sources: rows }, null, 2)); return; }

      console.log(`\n  driftwatch status  ·  channel: ${opts.channel}\n`);
      console.log(`  ${"source".padEnd(17)}${"status".padEnd(13)}${"rows".padEnd(6)}${"baseline".padEnd(14)}${"events".padEnd(8)}cand`);
      console.log(`  ${"─".repeat(64)}`);
      for (const r of rows) {
        console.log(
          `  ${r.source.padEnd(17)}${(STATUS_GLYPH[r.status] ?? r.status).padEnd(13)}` +
          `${String(r.rows).padEnd(6)}${r.baseline.padEnd(14)}${String(r.events).padEnd(8)}${r.candidates}`,
        );
      }
      const configured = rows.filter((r) => r.status !== "none").length;
      console.log(`\n  ${configured}/${rows.length} sources have snapshots.\n`);
    });
}
