/**
 * Provider-agnostic agent contract.
 *
 * Tools are declared ONCE as plain JSON Schema so they are portable across providers, and each
 * adapter owns its own loop because the SDKs genuinely differ.
 *
 * NOTE: `temperature` / `top_p` / `top_k` are deliberately ABSENT. They are rejected with a 400 on
 * Claude Opus 5 and Sonnet 5, so the obvious "neutral" interface that includes them would break
 * Anthropic on the first call. Provider-specific knobs live behind `providerOptions`.
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<string>;
}

export interface ToolCallTrace { tool: string; input: unknown; output: string }

export interface AgentRequest {
  system: string;
  userMessage: string;
  tools: ToolDef[];
  maxIterations: number;
  model?: string;
  providerOptions?: Record<string, unknown>;
}

export interface AgentResponse { text: string; toolCalls: ToolCallTrace[]; model: string; provider: string }

export interface LlmProvider {
  readonly id: string;
  readonly defaultModel: string | null;
  runAgent(req: AgentRequest): Promise<AgentResponse>;
}
