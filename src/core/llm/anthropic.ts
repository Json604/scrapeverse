import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { AgentRequest, AgentResponse, LlmProvider, ToolCallTrace } from "./types.ts";

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly defaultModel = "claude-opus-5";
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async runAgent(req: AgentRequest): Promise<AgentResponse> {
    const traces: ToolCallTrace[] = [];

    // betaTool takes raw JSON Schema, so our neutral ToolDef passes straight through — no Zod
    // dependency and no provider-specific schema dialect leaking into core/query.
    const tools = req.tools.map((t) =>
      betaTool({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as never,
        run: async (input: unknown) => {
          const output = await t.run((input ?? {}) as Record<string, unknown>);
          traces.push({ tool: t.name, input, output });
          return output;
        },
      }),
    );

    const model = req.model ?? this.defaultModel;
    const final = await this.client.beta.messages.toolRunner({
      model,
      max_tokens: 16000,
      system: req.system,
      thinking: { type: "adaptive" },
      tools: tools as never,
      messages: [{ role: "user", content: req.userMessage }],
      max_iterations: req.maxIterations,
      ...(req.providerOptions ?? {}),
    } as never);

    const text = (final.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();

    return { text, toolCalls: traces, model, provider: this.id };
  }
}
