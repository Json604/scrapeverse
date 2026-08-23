export type PulseEventKind = "entered" | "moved" | "changed";
export type PulseFilter = "all" | PulseEventKind;

export const driftwatchHeroArtwork = "/driftwatch-eye-hero-v1.webp";

export interface PulseEvent {
  id: string;
  entityId: string;
  kind: PulseEventKind;
  entity: string;
  url: string;
  sourceId: string;
  source: string;
  detail: string;
  current: string;
  previous: string | null;
  observed: string;
  cadence: "6h" | "monthly";
  context?: string;
  accent?: "coral" | "mint" | "sky" | "gold";
}

export interface PulseSummary {
  total: number;
  entered: number;
  moved: number;
  changed: number;
}

interface SourceMapItem {
  short: string;
}

export function buildAsciiSourceMap(sources: readonly SourceMapItem[]): string {
  const middleIndex = Math.floor(sources.length / 2);
  const branches = sources.map((source, index) => {
    if (index === 0) return `[${source.short.padEnd(2)}] -------.`;
    if (index === sources.length - 1) return `[${source.short.padEnd(2)}] -------'`;
    if (index === middleIndex) return `[${source.short.padEnd(2)}] -------+----> [ ENTITY CHANGELOG ]`;
    return `[${source.short.padEnd(2)}] -------|`;
  });

  return `${branches.join("\n")}\n                         things, not pages`;
}

export function summarizePulse(events: readonly PulseEvent[]): PulseSummary {
  return events.reduce<PulseSummary>((summary, event) => ({
    ...summary,
    total: summary.total + 1,
    [event.kind]: summary[event.kind] + 1,
  }), { total: 0, entered: 0, moved: 0, changed: 0 });
}

export function filterPulseEvents(
  events: readonly PulseEvent[],
  filter: PulseFilter,
): PulseEvent[] {
  if (filter === "all") return [...events];
  return events.filter((event) => event.kind === filter);
}
