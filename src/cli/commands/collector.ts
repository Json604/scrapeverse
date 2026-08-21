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
 * Two hard-won constraints:
 *  - It must demand a FLAT row-per-item schema. The first generated collector produced a nested
 *    shape (one row per page, empty inner array), and `scraper heal` fixes selectors, not schemas.
 *  - It must be short and single-line, or create fails with "Invalid description".
 */
export function describeForCreate(source: SourceId): string {
  const a = getAdapter(source);
  const lead = `Return one flat row per item in the ranked list, not one row for the whole page. Fields: `;
  const tail = ` Take all values from the list page itself.`;

  // Shrink field blurbs until the WHOLE description fits. Hard-slicing the composed string
  // instead would clip the trailing instruction, which is the part that prevents detail-page visits.
  for (let perField = 80; perField >= 16; perField -= 4) {
    const fields = a.spec.fields.map((f) => `${f.name} (${shorten(f.description, perField)})`).join("; ");
    const out = `${lead}${fields}.${tail}`;
    if (out.length <= MAX_CREATE_DESCRIPTION) return out;
  }
  // Last resort: names only. Still a valid instruction, just without the hints.
  return `${lead}${a.spec.fields.map((f) => f.name).join(", ")}.${tail}`;
}

/** Trim on a word boundary — a description cut mid-word reads as noise to the generator. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).trim();
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
