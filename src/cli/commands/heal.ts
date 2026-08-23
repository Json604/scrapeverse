import type { Command } from "commander";
import { healSource } from "../../core/heal/saga.ts";
import { CliCollectorAdmin } from "../../core/heal/admin.ts";
import { BrightDataBackend } from "../../core/backend/brightdata.ts";
import { FixtureBackend } from "../../core/backend/fixture.ts";
import { lastSnapshot } from "../../core/store/snapshots.ts";
import { collections } from "../../core/db.ts";
import { diagnosisFromSnapshot } from "../../core/heal/diagnose.ts";
import type { SourceId, Channel } from "../../core/types.ts";

export function registerHeal(program: Command): void {
  program
    .command("heal <source>")
    .description("Diagnose → heal → verify preview → approve|reject → post-verify → active|rollback")
    .option("--channel <channel>", "isolation channel", "live")
    .option("--collector <id>", "collector id")
    .option("--fixture <path>", "use the fixture backend for verification")
    .option("--dry-run", "stop after building the heal prompt; mutate nothing")
    .option("--json", "machine-readable output")
    .action(async (source: string, opts: {
      channel: string; collector?: string; fixture?: string; dryRun?: boolean; json?: boolean;
    }) => {
      const channel = opts.channel as Channel;
      const before = await lastSnapshot(source as SourceId, channel);
      if (!before) throw new Error(`no snapshot for ${source} on ${channel}. Run \`driftwatch run ${source}\` first.`);

      const c = await collections();
      const spec = await c.specs.findOne({ source } as Record<string, unknown>, { sort: { version: -1 } });
      const collectorId = opts.collector ?? opts.fixture ?? (spec as unknown as { collectorId?: string })?.collectorId;
      if (!collectorId) throw new Error(`no collector for ${source}`);

      const diagnosis = diagnosisFromSnapshot(before);

      const outcome = await healSource({
        source: source as SourceId, channel, collectorId, diagnosis, before,
        admin: new CliCollectorAdmin(),
        backend: opts.fixture ? new FixtureBackend() : new BrightDataBackend(),
        ...(opts.dryRun ? { dryRun: true } : {}),
      });

      if (opts.json) { console.log(JSON.stringify(outcome, null, 2)); return; }
      console.log(`\n  heal ${source}`);
      console.log(`  ${"─".repeat(56)}`);
      console.log(`  state    ${outcome.state}`);
      console.log(`  ${outcome.message}\n`);
    });
}
