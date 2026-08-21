import type { Command } from "commander";
import { ensureIndexes, ping, collections } from "../../core/db.ts";
import { config, loadWeights } from "../../core/config.ts";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Create collections and indexes, and verify the Atlas connection")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      const p = await ping();
      const indexes = await ensureIndexes();
      const c = await collections();
      const weights = loadWeights();

      const counts: Record<string, number> = {};
      for (const [name, col] of Object.entries(c)) {
        counts[name] = await (col as { countDocuments(): Promise<number> }).countDocuments();
      }

      if (opts.json) {
        console.log(JSON.stringify({ ok: true, host: p.host, db: config.dbName, pingMs: p.ms,
          indexes, counts, weightsVersion: weights.version }, null, 2));
        return;
      }

      console.log(`\n  driftwatch init`);
      console.log(`  ─────────────────────────────────────────────`);
      console.log(`  atlas      ${p.host} (${p.ms}ms)`);
      console.log(`  database   ${config.dbName}`);
      console.log(`  indexes    ${indexes.length} ensured`);
      console.log(`  weights    ${weights.version}`);
      console.log(`  brightdata ${config.brightDataKeyOptional ? "key present" : "not set (needed at milestone 2)"}`);
      console.log(`\n  collections`);
      for (const [name, n] of Object.entries(counts)) {
        console.log(`    ${name.padEnd(14)} ${n}`);
      }
      console.log(`\n  ready.\n`);
    });
}
