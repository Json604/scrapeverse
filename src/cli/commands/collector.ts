import type { Command } from "commander";
import { getAdapter, allSourceIds } from "../../core/sources/index.ts";
import { CliCollectorAdmin } from "../../core/heal/admin.ts";
import { collections } from "../../core/db.ts";
import { nowIso } from "../../core/util.ts";
import type { SourceId } from "../../core/types.ts";

/** Scraper Studio rejects long descriptions with "Invalid description". Measured: ~480 chars OK, 700 not. */
export const MAX_CREATE_DESCRIPTION = 500;

/**
 * The plain-language description handed to Scraper Studio, rendered from our portable spec.
 *
 * Three hard-won constraints:
 *  - It must FORBID navigation. Left to itself the generator treats a ranked page as a product
 *    listing and builds a two-stage listing→detail collector: stage one collects item URLs into a
 *    `product_page_url` field, stage two never fills the payload, and the result is rows of empty
 *    arrays. Everything we want is on the list page, so say so explicitly.
 *  - It must demand a FLAT row-per-item schema; `scraper heal` fixes selectors, not schemas.
 *  - It must fit the length cap WITHOUT truncating a field blurb. A cut mid-phrase — "the
 *    repository identifier in owner/name form, from the" — reads as a broken instruction and is
 *    worse input than no blurb at all. So blurbs are dropped whole, never clipped.
 */
export function describeForCreate(source: SourceId): string {
  const a = getAdapter(source);
  const lead =
    `Return one row for each item in the list on this page. Do not open or follow any link — ` +
    `every value is visible on this page. Fields: `;

  // Drop blurbs from the LONGEST field first: a complete instruction carrying fewer hints beats a
  // truncated one. Field NAMES are load-bearing and are never dropped.
  const byLength = [...a.spec.fields].sort((x, y) => y.description.length - x.description.length);
  const dropped = new Set<string>();

  for (let i = 0; i <= byLength.length; i++) {
    const body = a.spec.fields
      .map((f) => (dropped.has(f.name) ? f.name : `${f.name} (${f.description})`))
      .join("; ");
    const out = `${lead}${body}.`;
    if (out.length <= MAX_CREATE_DESCRIPTION) return out;
    if (i < byLength.length) dropped.add(byLength[i]!.name);
  }
  // Unreachable in practice: names alone are far under the cap for every source we ship.
  return `${lead}${a.spec.fields.map((f) => f.name).join(", ")}.`.slice(0, MAX_CREATE_DESCRIPTION);
}

export function registerCollector(program: Command): void {
  const g = program.command("collector").description("Manage Scraper Studio collectors");

  g.command("create <source>")
    .description("Create a custom Scraper Studio collector from this source's extraction spec")
    .option("--channel <channel>", "channel this collector belongs to", "live")
    .option("--print", "print the generated description without calling Bright Data")
    .action(async (source: string, opts: { channel: string; print?: boolean }) => {
      const adapter = getAdapter(source);
      const description = describeForCreate(source as SourceId);

      if (opts.print) {
        console.log(`\n  url:  ${adapter.targetUrl}\n  desc: ${description}\n`);
        return;
      }

      console.log(`\n  creating collector for ${source} …`);
      console.log(`  this is an AI generation against a live page and can take several minutes.\n`);
      const { collectorId } = await new CliCollectorAdmin()
        .create(adapter.targetUrl, description, `driftwatch-${source}-${opts.channel}`);

      const c = await collections();
      await c.specs.updateOne(
        { specId: adapter.spec.specId },
        { $set: { ...adapter.spec, collectorId, channel: opts.channel, createdAt: nowIso() } },
        { upsert: true },
      );
      console.log(`  collector_id  ${collectorId}\n  stored against spec ${adapter.spec.specId}\n`);
    });

  g.command("list")
    .description("Show stored collector ids per source")
    .action(async () => {
      const c = await collections();
      console.log("");
      for (const id of allSourceIds()) {
        const doc = await c.specs.findOne({ source: id } as Record<string, unknown>, { sort: { version: -1 } });
        const cid = (doc as unknown as { collectorId?: string })?.collectorId;
        console.log(`  ${id.padEnd(18)} ${cid ?? "— not created —"}`);
      }
      console.log("");
    });
}
