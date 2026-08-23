"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { LiquidGlass } from "./liquid-glass";
import {
  driftwatchHeroArtwork,
  filterPulseEvents,
  summarizePulse,
  type PulseEvent,
  type PulseFilter,
} from "../src/ui/pulse.ts";
import type { DashboardData, DashboardSource } from "../src/ui/dashboard-data.ts";

const filterLabels: Record<PulseFilter, string> = {
  all: "All changes",
  entered: "Entered",
  moved: "Moved",
  changed: "Attributes",
};

function AsciiArrow({ direction = "out" }: { direction?: "out" | "down" }) {
  return <span className="ascii-arrow" aria-hidden="true">{direction === "down" ? "↓" : "↗"}</span>;
}

function EventRow({ event, featured = false }: { event: PulseEvent; featured?: boolean }) {
  const kindLabel = event.kind === "changed" ? "Attribute" : event.kind;

  return (
    <article className={`event-row ${featured ? "event-row--featured" : ""}`}>
      <div className="event-row__kind">
        <span className={`event-token event-token--${event.kind}`}>{kindLabel}</span><time>{event.observed}</time>
      </div>
      <div className="event-row__entity">
        <div className="event-row__titleline"><h3>{event.entity}</h3>{featured ? <span className="featured-tag">focus</span> : null}</div>
        <p>{event.detail} <span>/</span> {event.context}</p>
      </div>
      <div className="event-row__change">
        {event.previous ? <span>{event.previous}</span> : <span className="new-label">new</span>}
        <b aria-hidden="true">-&gt;</b><strong>{event.current}</strong>
      </div>
      <div className="event-row__source"><span>{event.source}</span><small>{event.cadence === "6h" ? "6 hour watch" : "monthly index"}</small></div>
      <button className="row-action pressable glass-button" aria-label={`Open ${event.entity} event`}><LiquidGlass><AsciiArrow /></LiquidGlass></button>
    </article>
  );
}

function SourceTape({ sources, followed, onToggle }: { sources: readonly DashboardSource[]; followed: readonly string[]; onToggle: (source: string) => void }) {
  const unhealthy = sources.find((source) => !["healthy", "quiet"].includes(source.status));
  const quiet = sources.find((source) => source.status === "quiet");
  const trustTitle = unhealthy ? `${unhealthy.name} is ${unhealthy.status}.` : quiet ? `${quiet.name} is verified quiet.` : "Latest live checks are healthy.";
  const trustCopy = unhealthy ? "Its event stream stays muted until a trusted snapshot returns." : quiet ? `${quiet.rows} usable rows returned with no meaningful movement.` : "Every shown source returned a usable live snapshot.";

  return (
    <aside className="content-panel sources-panel" id="sources">
      <div className="panel-heading">
        <h2>Healthy or honestly quiet.</h2>
      </div>
      <div className="source-list">
        {sources.map((source) => {
          const isFollowed = followed.includes(source.id);
          return (
            <div className="source-row" key={source.id}>
              <span className={`source-monogram source-monogram--${source.accent}`}>[{source.short}]</span>
              <div className="source-row__copy">
                <strong>{source.name}</strong><span><i className={`status-dot status-dot--${source.status}`} />{source.status} / {source.note}</span>
              </div>
              <div className="source-row__cadence">
                <span>{source.cadence}</span>
                <button className={`follow-toggle pressable ${isFollowed ? "is-on" : ""}`} onClick={() => onToggle(source.id)} aria-label={`${isFollowed ? "Unfollow" : "Follow"} ${source.name}`} aria-pressed={isFollowed}>
                  <LiquidGlass className="follow-toggle__thumb" tone={isFollowed ? "light" : "dark"} strength={5} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="trust-note">
        <span className="trust-note__icon">{unhealthy ? "[!]" : "[ok]"}</span>
        <div><strong>{trustTitle}</strong><p>{trustCopy}</p></div>
      </div>
    </aside>
  );
}

function HeroArtwork() {
  return (
    <figure className="hero-art">
      <img
        className="hero-art__scene"
        src={driftwatchHeroArtwork}
        alt="A monumental mechanical eye watching a screen-printed coastal landscape"
        width="1672"
        height="941"
        decoding="async"
        fetchPriority="high"
      />
      <img
        className="hero-art__wind"
        src={driftwatchHeroArtwork}
        alt=""
        width="1672"
        height="941"
        decoding="async"
        aria-hidden="true"
      />
    </figure>
  );
}

export function PulseDashboard({ initialData, initialError = null }: { initialData: DashboardData; initialError?: string | null }) {
  const [data, setData] = useState(initialData);
  const [filter, setFilter] = useState<PulseFilter>("all");
  const [activeNavigation, setActiveNavigation] = useState("pulse");
  const [refreshing, setRefreshing] = useState(false);
  const [dataError, setDataError] = useState<string | null>(initialError);
  const [followedSources, setFollowedSources] = useState<string[]>(initialData.sources.map((source) => source.id));

  const visibleEvents = useMemo(
    () => filterPulseEvents(data.events, filter).filter((event) => followedSources.includes(event.sourceId)),
    [data.events, filter, followedSources],
  );
  const summary = summarizePulse(data.events);
  const navigationItems = ["pulse", "boards", "sources"] as const;
  const navigationIndex = navigationItems.indexOf(activeNavigation as (typeof navigationItems)[number]);
  const filterItems = Object.keys(filterLabels) as PulseFilter[];
  const glassSelectionStyle = (index: number) => ({ "--glass-selection-index": index } as CSSProperties);

  async function refreshSnapshot() {
    if (refreshing) return;
    setRefreshing(true);
    setDataError(null);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const payload = await response.json() as unknown;
      if (!response.ok || typeof payload !== "object" || payload === null || !("events" in payload) || !("sources" in payload) || !("boards" in payload)) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Live data request failed";
        throw new Error(message);
      }
      const nextData = payload as DashboardData;
      setData(nextData);
      setFollowedSources((current) => current.length === 0
        ? nextData.sources.map((source) => source.id)
        : current.filter((sourceId) => nextData.sources.some((source) => source.id === sourceId)));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Live data is temporarily unavailable.");
    } finally {
      setRefreshing(false);
    }
  }

  function toggleSource(source: string) {
    setFollowedSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source]);
  }

  return (
      <main className="dashboard" id="top">
        <section className="hero">
          <HeroArtwork />
          <header className="topbar glass-control">
            <a className="brand" href="#top" aria-label="Driftwatch home"><span>driftwatch</span></a>
            <nav aria-label="Primary navigation" style={glassSelectionStyle(navigationIndex)}>
              <LiquidGlass className="topbar__selection" tone="dark" strength={7} />
              {navigationItems.map((item) => (
                <a key={item} className={activeNavigation === item ? "is-active" : ""} href={`#${item}`} onClick={() => setActiveNavigation(item)} aria-current={activeNavigation === item ? "page" : undefined}>{item}</a>
              ))}
            </nav>
            <div className="topbar__actions">
              <button className={`refresh-button pressable glass-button ${refreshing ? "is-refreshing" : ""}`} onClick={refreshSnapshot}>
                <LiquidGlass tone="dark"><span className="refresh-glyph" aria-hidden="true">↻</span><span>{refreshing ? "Checking..." : "Check now"}</span></LiquidGlass>
              </button>
            </div>
          </header>
          <div className="hero__copy">
            <h1>Watch the lists.<br />Ignore the <em>noise.</em></h1>
            <p>The public builder leaderboards you already check—organized as changes to things, not a dump of pages.</p>
            <div className="hero__actions">
              <a className="primary-button pressable glass-button" href="#pulse"><LiquidGlass tone="dark">See what moved <span className="hero-button__arrow" aria-hidden="true">→</span></LiquidGlass></a>
              <a className="secondary-button pressable glass-button" href="#sources"><LiquidGlass>Browse sources</LiquidGlass></a>
            </div>
          </div>
        </section>

        <div className="main-surface">
          <div className="main-surface__inner">
        {dataError ? <div className="data-error" role="status">[offline] {dataError}</div> : null}
        <div className="content-grid">
          <section className="content-panel pulse-panel" id="pulse">
            <div className="panel-heading panel-heading--feed">
              <h2>What moved between checks.</h2>
              <div className="filter-bar" role="group" aria-label="Filter changes" style={glassSelectionStyle(filterItems.indexOf(filter))}>
                <LiquidGlass className="filter-bar__selection" tone="dark" strength={7} />
                {filterItems.map((item) => <button key={item} className={filter === item ? "is-active" : ""} onClick={() => setFilter(item)} aria-pressed={filter === item}>{filterLabels[item]}</button>)}
              </div>
            </div>
            <div className="event-columns" aria-hidden="true"><span>Event / observed</span><span>Entity / evidence</span><span>Change</span><span>Source</span><span /></div>
            <div className="event-list" role="region" aria-label="Change event feed" tabIndex={0}>
              {visibleEvents.map((event, index) => <EventRow key={event.id} event={event} featured={filter === "all" && index === 0} />)}
              {visibleEvents.length === 0 ? <div className="empty-state"><span>[ ø ]</span><h3>No followed source matches this view.</h3><p>Turn a source back on, or choose another event type.</p></div> : null}
            </div>
            <div className="feed-footer">
              <span>Showing {visibleEvents.length} / {summary.total} meaningful changes</span>
              {visibleEvents.length > 4 ? <span className="scroll-indicator" aria-hidden="true">Scroll <AsciiArrow direction="down" /></span> : null}
              <button className="pressable glass-button"><LiquidGlass>Open full changelog <AsciiArrow /></LiquidGlass></button>
            </div>
          </section>
          <SourceTape sources={data.sources} followed={followedSources} onToggle={toggleSource} />
        </div>

        <section className="content-panel boards" id="boards">
          <div className="panel-heading"><div><span className="eyebrow">Boards now / trusted snapshot</span><h2>The current state, without the chrome.</h2></div><button className="text-button pressable glass-button"><LiquidGlass>Browse all boards <AsciiArrow /></LiquidGlass></button></div>
          <div className="board-strip">
            {data.boards.map((board) => <div key={board.sourceId}><span>[{board.short}] / {String(board.rank).padStart(2, "0")}</span><strong>{board.title}</strong><small>{board.detail}</small></div>)}
            {data.boards.length === 0 ? <div className="board-strip__empty"><strong>No trusted board snapshots yet.</strong><small>Run the live collectors, then check again.</small></div> : null}
          </div>
        </section>

          </div>
        </div>
      </main>
  );
}
