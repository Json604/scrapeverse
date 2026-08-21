import { config } from "../config.ts";
import type { LlmProvider } from "./types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAiProvider } from "./openai.ts";

export type ProviderId = "anthropic" | "openai";

/** Resolution order: CLI flag → env → default. Adding a provider is one file. */
export function getProvider(id?: string): LlmProvider {
  const chosen = (id ?? config.llmProvider) as ProviderId;
  switch (chosen) {
    case "anthropic": return new AnthropicProvider();
    case "openai": return new OpenAiProvider();
    default:
      throw new Error(`unknown llm provider "${chosen}". supported: anthropic, openai`);
  }
}

export function resolveModel(provider: LlmProvider, flag?: string): string | undefined {
  return flag ?? config.llmModel ?? provider.defaultModel ?? undefined;
}
export type { ToolDef, LlmProvider, AgentResponse } from "./types.ts";
