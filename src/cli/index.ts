#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { registerInit } from "./commands/init.ts";
import { registerStatus } from "./commands/status.ts";
import { registerRun } from "./commands/run.ts";
import { registerCollector } from "./commands/collector.ts";
import { registerHeal } from "./commands/heal.ts";
import { registerCalibrate } from "./commands/calibrate.ts";
import { registerEval } from "./commands/evalcmd.ts";
import { registerQuery } from "./commands/query.ts";
import { registerAsk } from "./commands/ask.ts";
import { registerBackfill } from "./commands/backfill.ts";
import { registerReview } from "./commands/review.ts";
import { registerFixture } from "./commands/fixture.ts";
import { closeClient } from "../core/db.ts";

const program = new Command();
program
  .name("driftwatch")
  .description("Version control for the web — structured leaderboard history with break-vs-change classification")
  .version("0.1.0");

registerInit(program);
registerStatus(program);
registerRun(program);
registerCollector(program);
registerHeal(program);
registerCalibrate(program);
registerEval(program);
registerQuery(program);
registerAsk(program);
registerBackfill(program);
registerReview(program);
registerFixture(program);

program.parseAsync(process.argv)
  .then(async () => { await closeClient(); })
  .catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  error: ${msg}\n`);
    await closeClient().catch(() => {});
    process.exitCode = 1;
  });
