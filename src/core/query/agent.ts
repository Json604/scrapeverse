/**
 * The agent's tools ARE the deterministic query functions, so every natural-language
 * answer is reproducible by re-running a CLI command by hand.
 */
import { queryEvents, blameEntity, timeline, countEvents, sourceHealth } from "./index.ts";
import { getProvider, resolveModel, type ToolDef } from "../llm/index.ts";
import { allSourceIds } from "../sources/index.ts";
import type { ChangeType } from "../types.ts";

const CHANGE_TYPES = [
  "ENTERED", "LEFT", "RENAMED", "RANK_UP", "RANK_DOWN",
  "METRIC_DELTA", "ATTRIBUTE_CHANGED", "TITLE_CHANGED", "URL_CHANGED",
];

export function buildTools(): ToolDef[] {
  return [
    {
      name: "query_events",
      description: "Query the change-event history. Returns individual change events with their entity, field, from/to values, and observation interval.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", enum: allSourceIds(), description: "restrict to one source" },
          changeType: { type: "string", enum: CHANGE_TYPES },
          field: { type: "string", description: "e.g. pricingModel, language, rank" },
          entityId: { type: "string", description: "e.g. futurepedia:perplexity" },
          since: { type: "string", description: "ISO8601 lower bound" },
          limit: { type: "number", description: "max events (default 50)" },
        },
        additionalProperties: false,
      },
      run: async (input) => JSON.stringify(await queryEvents(input as never), null, 1),
    },
    {
      name: "count_events",
      description: "Count change events grouped by change type. Use this before query_events to understand the shape of a period.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", enum: allSourceIds() },
          since: { type: "string", description: "ISO8601 lower bound" },
        },
        additionalProperties: false,
      },
      run: async (input) => JSON.stringify(await countEvents(input as never)),
    },
    {
      name: "blame_entity",
      description: "For one entity, when each of its fields last changed. Answers 'when did X flip to paid?'.",
      inputSchema: {
        type: "object",
        properties: { entityId: { type: "string", description: "e.g. futurepedia:perplexity" } },
        required: ["entityId"], additionalProperties: false,
      },
      run: async (input) => JSON.stringify(await blameEntity(String(input["entityId"])), null, 1),
    },
    {
      name: "get_timeline",
      description: "Snapshot history for a source: capture times, extraction status (healthy/degraded/broken/stale/calibrating), row counts, events per snapshot.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", enum: allSourceIds() },
          limit: { type: "number" },
        },
        required: ["source"], additionalProperties: false,
      },
      run: async (input) => JSON.stringify(await timeline(String(input["source"]), input as never), null, 1),
    },
    {
      name: "source_health",
      description: "Current extraction health across all sources and channels.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => JSON.stringify(await sourceHealth(), null, 1),
    },
  ];
}

const SYSTEM = `You answer questions about Driftwatch, a versioned history of software-industry leaderboards.

Use the tools to look up real data. Never invent an entity, a value, or a date.

Key domain facts you must respect when interpreting results:
- A snapshot's status matters. Only "healthy" snapshots produce change events. "broken" means the
  extraction failed and deliberately emitted nothing; "degraded" output is quarantined, not published;
  "stale" means the page was not refetched. Do not describe a broken snapshot as "no changes happened".
- Events carry an interval, not an instant. When gapCount > 0 the change happened somewhere BETWEEN
  intervalStart and intervalEnd — say "between X and Y", never a precise time.
- Cite the eventId (and snapshotId where relevant) for every claim you make.

Be concise and concrete. Lead with the answer.`;

export interface AskResult { question: string; answer: string; toolCalls: unknown[]; provider: string; model: string }

export async function ask(
  question: string, opts: { provider?: string; model?: string; maxIterations?: number } = {},
): Promise<AskResult> {
  const provider = getProvider(opts.provider);
  const model = resolveModel(provider, opts.model);
  const res = await provider.runAgent({
    system: SYSTEM,
    userMessage: question,
    tools: buildTools(),
    maxIterations: opts.maxIterations ?? 12,
    ...(model ? { model } : {}),
  });
  return { question, answer: res.text, toolCalls: res.toolCalls, provider: res.provider, model: res.model };
}
