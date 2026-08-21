import type { Command } from "commander";
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { collections } from "../../core/db.ts";
import { getAdapter } from "../../core/sources/index.ts";
import { TUNING, HELD_OUT } from "../../core/fixtures/mutate.ts";
import type { Snapshot } from "../../core/types.ts";

const ROOT = () => resolve(process.cwd(), "fixtures");

/**
 * Labeled break/change pairs.
 * Fixtures run on their OWN channel and require their OWN collector: channel isolation in Mongo
 * does not protect shared remote state, and there is no clone command.
 */
export function registerFixture(program: Command): void {
  const g = program.command("fixture").description("Capture and mutate fixtures for the eval harness");

  g.command("capture <source>")
    .description("Snapshot the latest stored records into a versioned fixture")
    .option("--channel <channel>", "channel to capture from", "live")
    .option("--name <name>", "fixture variant name", "v1")
    .action(async (source: string, opts: { channel: string; name: string }) => {
      const c = await collections();
      const snap = await c.snapshots.findOne(
        { source, channel: opts.channel } as Partial<Snapshot>, { sort: { capturedAt: -1 } });
      if (!snap) throw new Error(`no snapshot for ${source} on ${opts.channel}`);

      const dir = resolve(ROOT(), source);
      mkdirSync(dir, { recursive: true });
      const path = resolve(dir, `${opts.name}.json`);
      writeFileSync(path, JSON.stringify(snap.records, null, 2));
      console.log(`\n  captured ${snap.records.length} records → fixtures/${source}/${opts.name}.json\n`);
    });

  g.command("mutate <source> <variant>")
    .description("Apply a mutation operator to a fixture, producing a labeled case")
    .option("--kind <operator>", "operator name (see `fixture operators`)", "column_swap")
    .option("--field <field>", "field to mutate (default: first watch key)")
    .option("--out <name>", "output variant name")
    .action(async (source: string, variant: string, opts: { kind: string; field?: string; out?: string }) => {
      const base = resolve(ROOT(), source, `${variant}.json`);
      if (!existsSync(base)) throw new Error(`fixture not found: ${base}`);

      const op = [...TUNING, ...HELD_OUT].find((o) => o.name === opts.kind);
      if (!op) throw new Error(`unknown operator "${opts.kind}". see: driftwatch fixture operators`);

      const field = opts.field ?? getAdapter(source).expectations.watchKeys[0] ?? "category";
      const records = JSON.parse(readFileSync(base, "utf8")) as Parameters<typeof op.apply>[0];
      const mutated = op.apply(records, field);

      const out = opts.out ?? `${variant}-${op.name}`;
      writeFileSync(resolve(ROOT(), source, `${out}.json`), JSON.stringify(mutated, null, 2));
      console.log(`\n  ${op.name} on "${field}"  →  fixtures/${source}/${out}.json`);
      console.log(`  kind: ${op.kind}   ground truth: ${op.truth}   rows: ${mutated.length}\n`);
    });

  g.command("reset <source>")
    .description("Clear all stored state for a fixture channel, so a demo can be re-run from scratch")
    .option("--channel <channel>", "fixture channel to clear", "fixture:demo")
    .action(async (source: string, opts: { channel: string }) => {
      // Refuse anything that is not a fixture channel. This command deletes history, and a typo
      // like `--channel live` would destroy real captures with no way back.
      if (!opts.channel.startsWith("fixture:")) {
        throw new Error(`refusing to reset "${opts.channel}": only fixture:* channels may be cleared`);
      }
      const c = await collections();
      const filter = { source, channel: opts.channel } as Record<string, unknown>;
      const counts: Record<string, number> = {};
      for (const [name, col] of Object.entries({
        snapshots: c.snapshots, changeEvents: c.changeEvents,
        candidates: c.candidates, baselines: c.baselines,
      })) {
        counts[name] = (await col.deleteMany(filter as never)).deletedCount ?? 0;
      }
      console.log(`\n  cleared ${opts.channel} for ${source}`);
      for (const [k, v] of Object.entries(counts)) console.log(`    ${k.padEnd(14)} ${v}`);
      console.log("");
    });

  g.command("operators")
    .description("List mutation operators and their ground-truth labels")
    .action(() => {
      const show = (title: string, ops: typeof TUNING) => {
        console.log(`\n  ${title}`);
        for (const o of ops) console.log(`    ${o.name.padEnd(26)} ${o.kind.padEnd(11)} truth=${o.truth}`);
      };
      show("TUNING (validator may be developed against these)", TUNING);
      show("HELD OUT (never used while tuning)", HELD_OUT);
      console.log("");
    });

  g.command("list")
    .description("List captured fixtures")
    .action(() => {
      if (!existsSync(ROOT())) { console.log("\n  no fixtures captured yet.\n"); return; }
      console.log("");
      for (const src of readdirSync(ROOT())) {
        const files = readdirSync(resolve(ROOT(), src)).filter((f) => f.endsWith(".json"));
        console.log(`  ${src}`);
        for (const f of files) console.log(`    ${f.replace(/\.json$/, "")}`);
      }
      console.log("");
    });
}
