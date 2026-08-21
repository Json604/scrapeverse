import OpenAI from "openai";
import type { AgentRequest, AgentResponse, LlmProvider, ToolCallTrace } from "./types.ts";

/**
 * Manual tools/tool_calls loop. Honours OPENAI_BASE_URL, so any OpenAI-compatible endpoint works
 * (OpenRouter, Groq, vLLM, Ollama, LM Studio).
 */
export class OpenAiProvider implements LlmProvider {
  readonly id = "openai";
  /** No default: model ids change faster than this repo, and guessing one is a latent bug. */
  readonly defaultModel = null;
  private client: OpenAI;

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new OpenAI({
      ...(apiKey ? { apiKey } : {}),
      ...(baseURL ?? process.env["OPENAI_BASE_URL"] ? { baseURL: baseURL ?? process.env["OPENAI_BASE_URL"]! } : {}),
    });
  }

  async runAgent(req: AgentRequest): Promise<AgentResponse> {
    const model = req.model;
    if (!model) {
      throw new Error(
        "provider `openai` requires an explicit model id. " +
        "Pass --model <id> or set DRIFTWATCH_LLM_MODEL.",
      );
    }

    const traces: ToolCallTrace[] = [];
    const byName = new Map(req.tools.map((t) => [t.name, t]));
    const tools = req.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: req.system },
      { role: "user", content: req.userMessage },
    ];

    for (let i = 0; i < req.maxIterations; i++) {
      const res = await this.client.chat.completions.create({ model, messages, tools });
      const msg = res.choices[0]?.message;
      if (!msg) break;
      messages.push(msg);

      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) {
        return { text: (msg.content ?? "").trim(), toolCalls: traces, model, provider: this.id };
      }

      for (const call of calls) {
        if (call.type !== "function") continue;
        const tool = byName.get(call.function.name);
        let output: string;
        if (!tool) output = `error: unknown tool ${call.function.name}`;
        else {
          try {
            // Always JSON.parse tool inputs — never string-match the serialized form.
            const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
            output = await tool.run(args);
            traces.push({ tool: call.function.name, input: args, output });
          } catch (e) { output = `error: ${(e as Error).message}`; }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
    }
    return { text: "(reached max iterations without a final answer)", toolCalls: traces, model, provider: this.id };
  }
}
