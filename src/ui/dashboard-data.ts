import type { ChangeEvent, NormalizedRecord, Snapshot, SourceId } from "../core/types.ts";
import type { DashboardQueryState } from "../core/query/dashboard.ts";
import type { PulseEvent } from "./pulse.ts";

export const DASHBOARD_SOURCE_IDS = [
  "hackernews",
  "github_trending",
  "stackshare",
  "tiobe",
  "pypl",
] as const satisfies readonly SourceId[];

export type DashboardSourceId = (typeof DASHBOARD_SOURCE_IDS)[number];
export type DashboardAccent = "coral" | "mint" | "sky" | "gold";

interface SourcePresentation {
  name: string;
  short: string;
  url: string;
  cadence: "every 6h" | "monthly";
  eventCadence: "6h" | "monthly";
  accent: DashboardAccent;
}

const SOURCE_PRESENTATION: Record<DashboardSourceId, SourcePresentation> = {
  hackernews: { name: "Hacker News", short: "HN", url: "https://news.ycombinator.com/", cadence: "every 6h", eventCadence: "6h", accent: "coral" },
  github_trending: { name: "GitHub Trending", short: "GH", url: "https://github.com/trending", cadence: "every 6h", eventCadence: "6h", accent: "mint" },
  stackshare: { name: "StackShare", short: "SS", url: "https://stackshare.io/trending/tools", cadence: "every 6h", eventCadence: "6h", accent: "sky" },
  tiobe: { name: "TIOBE", short: "TI", url: "https://www.tiobe.com/tiobe-index/", cadence: "monthly", eventCadence: "monthly", accent: "gold" },
  pypl: { name: "PYPL", short: "PY", url: "https://pypl.github.io/PYPL.html", cadence: "monthly", eventCadence: "monthly", accent: "sky" },
};

export interface DashboardSource {
  id: DashboardSourceId;
  name: string;
  short: string;
  url: string;
  cadence: SourcePresentation["cadence"];
  accent: DashboardAccent;
  status: Snapshot["status"] | "quiet" | "unavailable";
  note: string;
  rows: number;
  lastRun: string | null;
}

export interface DashboardBoardItem {
  sourceId: DashboardSourceId;
  source: string;
  rank: number;
  title: string;
  detail: string;
  url: string;
  capturedAt: string;
}

export interface DashboardRankingItem {
  rank: number;
  title: string;
  detail: string;
  url: string;
}

export interface DashboardRankingGroup {
  sourceId: DashboardSourceId;
  source: string;
  capturedAt: string;
  items: DashboardRankingItem[];
}

export interface DashboardData {
  events: PulseEvent[];
  sources: DashboardSource[];
  boards: DashboardBoardItem[];
  rankings: DashboardRankingGroup[];
  generatedAt: string;
}

function isDashboardSource(source: SourceId): source is DashboardSourceId {
  return (DASHBOARD_SOURCE_IDS as readonly SourceId[]).includes(source);
}

function words(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
}

function relativeTime(value: string, now: Date) {
  const elapsed = Math.max(0, now.getTime() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit" }).format(new Date(value));
}

function scalar(value: ChangeEvent["to"], field?: string) {
  if (value === null) return "—";
  if (typeof value !== "number") return String(value);
  if (field === "rank") return `#${value}`;
  if (field === "ratings" || field === "rating" || field === "share") return `${value.toFixed(2)}%`;
  if (field === "points") return `${value.toLocaleString("en-US")} pts`;
  return value.toLocaleString("en-US");
}

function eventKind(changeType: ChangeEvent["changeType"]): PulseEvent["kind"] | null {
  if (changeType === "ENTERED") return "entered";
  if (changeType === "RANK_UP" || changeType === "RANK_DOWN") return "moved";
  if (changeType === "LEFT") return null;
  return "changed";
}

function eventDetail(event: ChangeEvent) {
  if (event.changeType === "ENTERED") return "Entered the list";
  if (event.changeType === "RANK_UP") return `Climbed ${Math.abs(Number(event.delta ?? 0))} places`;
  if (event.changeType === "RANK_DOWN") return `Dropped ${Math.abs(Number(event.delta ?? 0))} places`;
  if (event.changeType === "RENAMED") return "Entity renamed";
  if (event.changeType === "TITLE_CHANGED") return "Title changed";
  if (event.changeType === "URL_CHANGED") return "Destination changed";
  return `${words(event.field ?? "attribute")} changed`;
}

function eventContext(event: ChangeEvent) {
  if (event.gapCount > 0) return `observed across ${event.gapCount + 1} checks`;
  if (event.changeType === "ENTERED") return "trusted live snapshot";
  if (event.field === "rank") return "meaningful rank movement";
  if (typeof event.delta === "number" && event.field !== "rank") {
    return `${event.delta > 0 ? "+" : ""}${event.delta.toLocaleString("en-US")} ${words(event.field ?? "change")}`;
  }
  return event.field ? words(event.field) : "trusted live snapshot";
}

function toPulseEvent(event: ChangeEvent, now: Date, trustedUrl?: string): PulseEvent | null {
  if (!isDashboardSource(event.source) || event.channel !== "live") return null;
  const kind = eventKind(event.changeType);
  if (!kind) return null;
  const presentation = SOURCE_PRESENTATION[event.source];
  const field = event.field ?? (event.changeType.startsWith("RANK_") || event.changeType === "ENTERED" ? "rank" : undefined);

  return {
    id: event.eventId,
    entityId: event.entityId,
    kind,
    entity: event.entityTitle,
    url: trustedUrl ?? presentation.url,
    sourceId: event.source,
    source: presentation.name,
    detail: eventDetail(event),
    current: scalar(event.to, field),
    previous: event.from === null ? null : scalar(event.from, field),
    observed: relativeTime(event.intervalEnd, now),
    cadence: presentation.eventCadence,
    context: eventContext(event),
    accent: presentation.accent,
  };
}

function firstMetric(record: NormalizedRecord, names: string[]) {
  for (const name of names) {
    const metric = record.metrics[name];
    if (metric) return metric;
  }
  return Object.values(record.metrics)[0];
}

function boardDetail(source: DashboardSourceId, record: NormalizedRecord) {
  if (source === "github_trending") {
    const language = typeof record.attributes["language"] === "string" ? record.attributes["language"] : null;
    const stars = firstMetric(record, ["starsToday", "stars"]);
    return [language, stars ? `${stars.value.toLocaleString("en-US")} ${stars.name === "starsToday" ? "stars today" : "stars"}` : null].filter(Boolean).join(" / ");
  }
  if (source === "hackernews") {
    const points = firstMetric(record, ["points"]);
    return points ? `${points.value.toLocaleString("en-US")} points` : "Ranked story";
  }
  if (source === "stackshare") {
    const category = record.attributes["category"];
    return typeof category === "string" ? category : "Trending tool";
  }
  const metric = firstMetric(record, source === "tiobe" ? ["ratings", "rating"] : ["share"]);
  if (!metric) return "Current leader";
  return `${metric.value.toFixed(2)}% ${source === "tiobe" ? "rating" : "share"}`;
}

export function buildDashboardData(state: DashboardQueryState, now = new Date(), eventLimit = 50): DashboardData {
  const latestBySource = new Map(state.latestSnapshots.filter((snapshot) => isDashboardSource(snapshot.source)).map((snapshot) => [snapshot.source, snapshot]));
  const trustedBySource = new Map(state.trustedSnapshots.filter((snapshot) => isDashboardSource(snapshot.source)).map((snapshot) => [snapshot.source, snapshot]));
  const trustedRecordsByEntity = new Map(state.trustedSnapshots.flatMap((snapshot) => snapshot.records).map((record) => [record.entityId, record]));

  const events = state.events
    .map((event) => toPulseEvent(event, now, trustedRecordsByEntity.get(event.entityId)?.canonicalUrl))
    .filter((event): event is PulseEvent => event !== null)
    .slice(0, eventLimit);

  const sources = DASHBOARD_SOURCE_IDS.map((sourceId): DashboardSource => {
    const presentation = SOURCE_PRESENTATION[sourceId];
    const snapshot = latestBySource.get(sourceId);
    if (!snapshot) return { ...presentation, id: sourceId, status: "unavailable", note: "no live snapshot", rows: 0, lastRun: null };
    const latestEvents = state.eventCountsBySnapshot[snapshot.snapshotId] ?? 0;
    const status = snapshot.status === "healthy" && latestEvents === 0 ? "quiet" : snapshot.status;
    return {
      ...presentation,
      id: sourceId,
      status,
      note: status === "quiet" ? `${snapshot.records.length} rows / no movement` : `${snapshot.records.length} rows`,
      rows: snapshot.records.length,
      lastRun: snapshot.capturedAt,
    };
  });

  const boards = DASHBOARD_SOURCE_IDS.flatMap((sourceId): DashboardBoardItem[] => {
    const snapshot = trustedBySource.get(sourceId);
    const record = snapshot?.records.reduce<NormalizedRecord | null>((best, item) => !best || item.rank < best.rank ? item : best, null);
    if (!snapshot || !record) return [];
    return [{ sourceId, source: SOURCE_PRESENTATION[sourceId].name, rank: record.rank, title: record.title, detail: boardDetail(sourceId, record), url: record.canonicalUrl || SOURCE_PRESENTATION[sourceId].url, capturedAt: snapshot.capturedAt }];
  });

  const rankings = DASHBOARD_SOURCE_IDS.flatMap((sourceId): DashboardRankingGroup[] => {
    const snapshot = trustedBySource.get(sourceId);
    if (!snapshot) return [];
    const items = [...snapshot.records]
      .sort((left, right) => left.rank - right.rank)
      .map((record) => ({
        rank: record.rank,
        title: record.title,
        detail: boardDetail(sourceId, record),
        url: record.canonicalUrl || SOURCE_PRESENTATION[sourceId].url,
      }));
    return [{ sourceId, source: SOURCE_PRESENTATION[sourceId].name, capturedAt: snapshot.capturedAt, items }];
  });

  return { events, sources, boards, rankings, generatedAt: now.toISOString() };
}

export function emptyDashboardData(now = new Date()): DashboardData {
  return buildDashboardData({ events: [], latestSnapshots: [], trustedSnapshots: [], eventCountsBySnapshot: {} }, now);
}
