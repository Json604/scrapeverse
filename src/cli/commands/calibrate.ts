import type { Command } from "commander";
import { collections } from "../../core/db.ts";
import { recomputeBaseline, signBaseline, getBaseline } from "../../core/validate/baseline.ts";
import { fieldValue } from "../../core/validate/schema.ts";
import { getAdapter } from "../../core/sources/index.ts";
import { loadWeights } from "../../core/config.ts";
import { truncate } from "../../core/util.ts";
import type { SourceId, Channel, Snapshot } from "../../core/types.ts";

/**
 * Signing must be inspectable.
 * An earlier draft made `--sign` one boolean over a whole snapshot, asking a human to certify an
 * extraction they had no tool to examine. This prints raw↔normalized side by side, per watch key.
 */
export function registerCalibrate(program: Command): void {
  program
    .command("calibrate <source>")
    .description("Inspect genesis extraction and sign a baseline, per watch key")
    .option("--channel <channel>", "isolation channel", "live")
    .option("--sign", "sign the baseline (promotes the source out of `calibrating`)")
    .option("--keys <keys>", "comma-separated watch keys to sign (default: all)")
    .action(async (source: string, opts: { channel: string; sign?: boolean; keys?: string }) => {
      const channel = opts.channel as Channel;
      const adapter = getAdapter(source);
      const w = loadWeights();
      const c = await collections();

      const snaps = await c.snapshots
        .find({ source, channel } as Partial<Snapshot>)
        .sort({ capturedAt: -1 }).limit(w.calibrationRuns).toArray();

      if (snaps.length === 0) throw new Error(`no snapshots for ${source}. Run \`driftwatch run ${source}\` first.`);

      // Predicate is NOT record equality — GH/PH never repeat rows day to day, so requiring that
      // would deadlock. It is: schema valid ∧ coverage ≥ threshold on every watch key.
      const fields = [...new Set([...adapter.expectations.watchKeys, ...adapter.expectations.requiredFields])];
      const checks = snaps.map((s) => ({
        id: s.snapshotId,
        schemaValid: s.health.schemaValid,
        lowKeys: fields.filter((f) => (s.health.fieldCoverage[f] ?? 0) < w.calibrationMinCoverage),
      }));
      const consistent = snaps.length >= w.calibrationRuns && checks.every((x) => x.schemaValid && x.lowKeys.length === 0);

      const latest = snaps[0]!;
      console.log(`\n  calibrate ${source}  ·  channel ${channel}`);
      console.log(`  ${"─".repeat(64)}`);
      console.log(`  runs        ${snaps.length}/${w.calibrationRuns} required`);
      console.log(`  consistent  ${consistent ? "yes" : "no"}`);
      for (const x of checks) {
        console.log(`    ${x.id.slice(0, 14)}  schema=${x.schemaValid ? "ok" : "INVALID"}` +
          `${x.lowKeys.length ? `  low coverage: ${x.lowKeys.join(", ")}` : ""}`);
      }

      console.log(`\n  extraction sample — verify these values are what the page actually shows:\n`);
      for (const f of fields) {
        const vals = latest.records.slice(0, 5).map((r) => fieldValue(r, f)).map((v) => truncate(String(v ?? "∅"), 22));
        console.log(`    ${f.padEnd(16)} ${vals.join("  │  ")}`);
      }
      console.log(`\n  raw input   ${latest.provenance.inputUrl}`);
      console.log(`  collector   ${latest.provenance.collectorId} (${latest.provenance.collectorVersion})`);
      console.log(`  rows        ${latest.records.length}`);

      if (!opts.sign) {
        const ch = channel !== "live" ? ` --channel ${channel}` : "";
        console.log(`\n  review the sample above, then sign with:`);
        console.log(`    driftwatch calibrate ${source}${ch} --sign\n`);
        return;
      }
      if (!consistent) {
        // A schema-INVALID genesis may still heal — an earlier draft forbade healing while
        // calibrating, so a broken genesis could never become signable at all.
        console.log(`\n  refusing to sign: ${w.calibrationRuns} consistent runs required.`);
        if (checks.some((x) => !x.schemaValid)) console.log(`  genesis is schema-invalid — run \`driftwatch heal ${source}\` first.`);
        console.log("");
        return;
      }

      await recomputeBaseline(source as SourceId, channel, adapter.expectations, w.baselineWindow);
      const keys = opts.keys ? opts.keys.split(",").map((k) => k.trim()) : fields;
      await signBaseline(source as SourceId, channel, keys);
      const b = await getBaseline(source as SourceId, channel);
      console.log(`\n  signed keys: ${b?.signedKeys.join(", ")}`);
      console.log(`  baseline v${b?.version} active — ${source} will now classify normally.\n`);
    });
}
