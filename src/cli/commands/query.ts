import type { Command } from "commander";
import { queryEvents, blameEntity, timeline, countEvents } from "../../core/query/index.ts";
import type { ChangeType } from "../../core/types.ts";

const SIGN: Record<string, string> = {
  ENTERED: "+", LEFT: "-", RENAMED: "~", RANK_UP: "▲", RANK_DOWN: "▼",
  METRIC_DELTA: "Δ", ATTRIBUTE_CHANGED: "*", TITLE_CHANGED: "T", URL_CHANGED: "U",
};

function fmtWhen(intervalStart: string, intervalEnd: string, gapCount: number): string {
  const end = intervalEnd.slice(0, 16).replace("T", " ");
  // With a gap, timing is a RANGE. Printing a precise timestamp would be a lie.
  return gapCount > 0 ? `between ${intervalStart.slice(0, 10)} and ${end} (${gapCount} gap)` : end;
}

export function registerQuery(program: Command): void {
  program
    .command("log [source]")
    .description("Change history, newest first — git log for the leaderboard")
    .option("--channel <channel>", "restrict to one channel (default: all)")
    .option("--type <type>", "filter by change type")
    .option("--field <field>", "filter by field")
    .option("--since <iso>", "only changes at or after this time")
    .option("--limit <n>", "max rows", "40")
    .option("--json", "machine-readable output")
    .action(async (source: string | undefined, opts: Record<string, string | undefined>) => {
      const events = await queryEvents({
        ...(source ? { source } : {}), ...(opts["channel"] ? { channel: opts["channel"] } : {}),
        ...(opts["type"] ? { changeType: opts["type"] as ChangeType } : {}),
        ...(opts["field"] ? { field: opts["field"] } : {}),
        ...(opts["since"] ? { since: opts["since"] } : {}),
        limit: Number(opts["limit"] ?? 40),
      });
      if (opts["json"]) { console.log(JSON.stringify(events, null, 2)); return; }
      if (!events.length) { console.log("\n  no change events yet.\n"); return; }

      console.log("");
      for (const e of events) {
        const sign = SIGN[e.changeType] ?? "?";
        const what = e.field ? `${e.field}: ${e.from} → ${e.to}` : `${e.changeType.toLowerCase()}`;
        const conf = e.confidence < 1 ? `  (confidence ${e.confidence})` : "";
        console.log(`  ${sign} ${e.entityTitle}`);
        console.log(`      ${what}${conf}`);
        console.log(`      ${fmtWhen(e.intervalStart, e.intervalEnd, e.gapCount)}  ·  ${e.source}  ·  ${e.eventId}`);
      }
      console.log(`\n  ${events.length} events\n`);
    });

  program
    .command("blame <entityId>")
    .description("When each field of one entity last changed")
    .option("--json", "machine-readable output")
    .action(async (entityId: string, opts: { json?: boolean }) => {
      const b = await blameEntity(entityId);
      if (opts.json) { console.log(JSON.stringify(b, null, 2)); return; }
      console.log(`\n  ${b.entityId}   (${b.totalEvents} events)\n`);
      if (!b.fields.length) { console.log("  no recorded changes.\n"); return; }
      for (const f of b.fields) {
        console.log(`  ${f.field.padEnd(18)} ${String(f.from)} → ${String(f.to)}`);
        console.log(`  ${"".padEnd(18)} ${fmtWhen(f.since, f.at, f.gapCount)}  ·  ${f.eventId}`);
      }
      console.log("");
    });

  program
    .command("timeline <source>")
    .description("Snapshot history for a source, with status and event counts")
    .option("--channel <channel>", "restrict to one channel")
    .option("--limit <n>", "max rows", "30")
    .option("--json", "machine-readable output")
    .action(async (source: string, opts: Record<string, string | undefined>) => {
      const rows = await timeline(source, {
        ...(opts["channel"] ? { channel: opts["channel"] } : {}),
        limit: Number(opts["limit"] ?? 30),
      });
      if (opts["json"]) { console.log(JSON.stringify(rows, null, 2)); return; }
      if (!rows.length) { console.log(`\n  no snapshots for ${source}.\n`); return; }
      console.log(`\n  ${"captured".padEnd(22)}${"channel".padEnd(16)}${"status".padEnd(14)}${"rows".padEnd(7)}events`);
      console.log(`  ${"─".repeat(68)}`);
      for (const r of rows) {
        console.log(`  ${r.capturedAt.slice(0, 19).replace("T", " ").padEnd(22)}${r.channel.padEnd(16)}${r.status.padEnd(14)}${String(r.rows).padEnd(7)}${r.events}`);
      }
      console.log("");
    });

  program
    .command("summary [source]")
    .description("Event counts by change type")
    .option("--since <iso>", "window start")
    .action(async (source: string | undefined, opts: { since?: string }) => {
      const counts = await countEvents({ ...(source ? { source } : {}), ...(opts.since ? { since: opts.since } : {}) });
      console.log("");
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (!entries.length) { console.log("  no events.\n"); return; }
      for (const [k, v] of entries) console.log(`  ${k.padEnd(20)} ${v}`);
      console.log("");
    });
}
