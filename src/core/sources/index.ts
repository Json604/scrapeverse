import type { SourceId } from "../types.ts";
import type { SourceAdapter } from "./types.ts";
import { githubTrending } from "./github-trending.ts";
import { futurepedia } from "./futurepedia.ts";
import { hackernews } from "./hackernews.ts";
import { producthunt } from "./producthunt.ts";
import { hfTrending } from "./hf-trending.ts";
import { stackshare } from "./stackshare.ts";
import { tiobe, pypl, techRadar } from "./monthly/index.ts";

const REGISTRY = new Map<SourceId, SourceAdapter>();
function register(a: SourceAdapter) { REGISTRY.set(a.id, a); }

register(githubTrending);
register(hfTrending);
register(producthunt);
register(hackernews);
register(futurepedia);
register(stackshare);

// Monthly overlay — run on a separate cadence, never in the daily loop.
register(tiobe);
register(pypl);
register(techRadar);

export const MONTHLY_SOURCES = new Set(["tiobe", "pypl", "tech_radar"]);
export const DAILY_SOURCES = () => allSourceIds().filter((id) => !MONTHLY_SOURCES.has(id));

export function getAdapter(id: string): SourceAdapter {
  const a = REGISTRY.get(id as SourceId);
  if (!a) {
    throw new Error(`unknown source "${id}". known: ${[...REGISTRY.keys()].join(", ")}`);
  }
  return a;
}
export function allAdapters(): SourceAdapter[] { return [...REGISTRY.values()]; }
export function allSourceIds(): SourceId[] { return [...REGISTRY.keys()]; }
