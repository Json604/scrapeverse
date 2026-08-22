import type { Command } from "commander";
import { ask } from "../../core/query/agent.ts";

export function registerAsk(program: Command): void {
  program
    .command("ask <question>")
    .description("Natural-language questions over the change history (provider-agnostic)")
    .option("--provider <id>", "anthropic | openai (default: DRIFTWATCH_LLM_PROVIDER)")
    .option("--model <id>", "model id (required for openai)")
    .option("--json", "machine-readable output, including the full tool-call trace")
    .action(async (question: string, opts: { provider?: string; model?: string; json?: boolean }) => {
      let res;
      try {
        res = await ask(question, {
          ...(opts.provider ? { provider: opts.provider } : {}),
          ...(opts.model ? { model: opts.model } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/authentication|apiKey|api key|authToken|credentials/i.test(msg)) {
          throw new Error(
            "LLM provider is not configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY " +
            "(and optionally DRIFTWATCH_LLM_PROVIDER). See .env.example.",
          );
        }
        throw e;
      }
      if (opts.json) { console.log(JSON.stringify(res, null, 2)); return; }
      console.log(`\n${res.answer}\n`);
      console.log(`  ── ${res.provider}/${res.model} · ${res.toolCalls.length} tool calls`);
      for (const t of res.toolCalls as Array<{ tool: string; input: unknown }>) {
        console.log(`     ${t.tool}(${JSON.stringify(t.input).slice(0, 70)})`);
      }
      console.log("");
    });
}
