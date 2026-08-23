import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAsciiSourceMap,
  driftwatchHeroArtwork,
  filterPulseEvents,
  summarizePulse,
  type PulseEvent,
} from "./pulse.ts";

const events: PulseEvent[] = [
  {
    id: "entered",
    kind: "entered",
    entity: "openai/codex",
    sourceId: "github_trending",
    source: "GitHub Trending",
    detail: "Entered the list",
    current: "#4",
    previous: null,
    observed: "12 min ago",
    cadence: "6h",
  },
  {
    id: "moved",
    kind: "moved",
    entity: "Show HN: Driftwatch",
    sourceId: "hackernews",
    source: "Hacker News",
    detail: "Climbed 14 places",
    current: "#3",
    previous: "#17",
    observed: "24 min ago",
    cadence: "6h",
  },
  {
    id: "changed",
    kind: "changed",
    entity: "Python",
    sourceId: "pypl",
    source: "PYPL",
    detail: "Share changed",
    current: "28.20%",
    previous: "28.11%",
    observed: "Aug 01",
    cadence: "monthly",
  },
];

test("summarizePulse counts each meaningful event kind", () => {
  assert.deepEqual(summarizePulse(events), {
    total: 3,
    entered: 1,
    moved: 1,
    changed: 1,
  });
});

test("filterPulseEvents returns every event for the all filter", () => {
  assert.equal(filterPulseEvents(events, "all").length, 3);
});

test("filterPulseEvents narrows the feed without mutating its order", () => {
  const filtered = filterPulseEvents(events, "moved");

  assert.deepEqual(filtered.map((event) => event.id), ["moved"]);
  assert.deepEqual(events.map((event) => event.id), ["entered", "moved", "changed"]);
});

test("buildAsciiSourceMap connects every watched list to one entity changelog", () => {
  const sources = [{ short: "HN" }, { short: "GH" }, { short: "SS" }];
  const map = buildAsciiSourceMap(sources);

  for (const source of sources) assert.match(map, new RegExp(`\\[${source.short}\\]`));
  assert.match(map, /ENTITY CHANGELOG/);
  assert.match(map, /things, not pages/);
});

test("the print-theme hero uses the project-bound SVG artwork", () => {
  assert.equal(driftwatchHeroArtwork, "/driftwatch-eye-hero-v1.svg");
});

test("the hero uses Inter, borderless glass, and isolated foreground wind", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(dashboard, /next\/image/);
  assert.match(dashboard, /hero-art__wind/);
  assert.match(styles, /--font-sans:\s*"Inter Variable"/);
  assert.match(styles, /\.glass-control\s*{/);
  assert.match(styles, /\.hero-art__wind/);
  assert.match(styles, /prefers-reduced-motion:[^)]+[\s\S]+\.hero-art__wind/);
});

test("the app uses only the supplied warm-neutral palette", () => {
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const colors = [...styles.matchAll(/#[\da-f]{3,8}/gi)].map(([color]) => color.toUpperCase());

  assert.deepEqual([...new Set(colors)].sort(), ["#1B1D1F", "#6C6962", "#F7F4EC", "#FCFBF7"]);
  assert.match(styles, /--page:\s*#f7f4ec/i);
  assert.match(styles, /--surface:\s*#fcfbf7/i);
  assert.match(styles, /--text-primary:\s*#1b1d1f/i);
  assert.match(styles, /--text-secondary:\s*#6c6962/i);
  assert.match(styles, /body\s*{[\s\S]*?background:\s*var\(--page\)/);
  assert.match(styles, /\.content-panel\s*{[\s\S]*?background:\s*var\(--surface\)/);
});

test("the hero artwork fills the viewport without the dashboard gutter", () => {
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const hero = styles.match(/\.hero\s*{([^}]*)}/)?.[1] ?? "";

  assert.match(hero, /width:\s*100vw/);
  assert.match(hero, /min-height:\s*100svh/);
  assert.match(hero, /margin-inline:\s*calc\(50% - 50vw\)/);
  assert.match(styles, /\.hero-art img\s*{[^}]*object-fit:\s*cover/);
});

test("the hero keeps only essential chrome and uses a faster smooth wind cycle", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const hero = dashboard.match(/<section className="hero">([\s\S]*?)<\/section>/)?.[1] ?? "";
  const navLink = styles.match(/\.topbar nav a\s*{([^}]*)}/)?.[1] ?? "";
  const wind = styles.match(/\.hero-art__wind\s*{([^}]*)}/)?.[1] ?? "";

  assert.doesNotMatch(hero, /<Mark|preview|account-button|status-pill|hero__proof/);
  assert.match(hero, />driftwatch<\/span>/);
  assert.match(navLink, /display:\s*grid/);
  assert.match(navLink, /place-items:\s*center/);
  assert.match(wind, /animation:\s*grass-wind 1\.45s var\(--ease-wind\) infinite alternate/);
  assert.match(styles, /--ease-wind:\s*cubic-bezier\(0\.45, 0, 0\.55, 1\)/);
});

test("the hero has continuous full-vegetation wind and dissolves into the content surface", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(dashboard, /figcaption|last trusted check/i);
  assert.doesNotMatch(dashboard, /hero-art__grass-zone/);
  assert.doesNotMatch(styles, /hero-art__grass-zone|:has\(/);
  assert.match(styles, /mask-image:\s*linear-gradient\(to bottom, transparent 0 48%/);
  assert.match(styles, /\.hero::before\s*{[\s\S]*?linear-gradient\([^;]+var\(--surface\)/);
  assert.match(styles, /\.main-surface\s*{[^}]*padding-top:\s*clamp\(/);
  assert.match(styles, /\.hero__actions\s*{[^}]*margin-top:\s*40px/);
  assert.match(styles, /\.hero__copy > p\s*{[^}]*font-size:\s*18px/);
});

test("the dashboard ships without a first-load animation", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(dashboard, /IntroOverlay|intro-seen|Replay opening/);
  assert.doesNotMatch(styles, /\.intro\b|eye-camera|reticle-lock|intro-exit/);
});

test("selectable and pressable controls share the liquid-glass lens system", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.match(dashboard, /import \{ LiquidGlass \} from "\.\/liquid-glass"/);
  assert.match(dashboard, /className="topbar__selection"/);
  assert.match(dashboard, /className="filter-bar__selection"/);
  assert.match(dashboard, /className="follow-toggle__thumb"/);
  assert.match(styles, /--glass-selection-index/);
  assert.match(styles, /cubic-bezier\(0\.22, 1\.15, 0\.36, 1\.06\)/);
  assert.match(styles, /\.liquid-glass__rim/);
  assert.match(styles, /prefers-reduced-motion:[^)]+[\s\S]+\.topbar__selection/);
});

test("the main content starts with the pulse and uses flat Inter panels", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const contentPanel = styles.match(/\.content-panel\s*{([^}]*)}/)?.[1] ?? "";

  assert.doesNotMatch(dashboard, /MetricCard|className="metrics"/);
  assert.match(styles, /--font-display:\s*"Inter Variable"/);
  assert.match(contentPanel, /box-shadow:\s*none/);
  assert.doesNotMatch(styles, /\.content-panel\s*{[^}]*box-shadow:\s*6px 6px/);
  assert.doesNotMatch(styles, /\.trust-note\s*{[^}]*box-shadow:\s*3px 3px/);
});

test("the main content uses black glass, ivory surfaces, and readable type", () => {
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const darkGlass = styles.match(/\.liquid-glass\[data-tone="dark"\] \.liquid-glass__refraction\s*{([^}]*)}/)?.[1] ?? "";
  const contentPanel = styles.match(/\.content-panel\s*{([^}]*)}/)?.[1] ?? "";
  const entityTitle = styles.match(/\.event-row h3\s*{([^}]*)}/)?.[1] ?? "";

  assert.match(darkGlass, /--text-primary-rgb/);
  assert.doesNotMatch(darkGlass, /--text-secondary-rgb/);
  assert.match(contentPanel, /background:\s*var\(--surface\)/);
  assert.match(entityTitle, /font-size:\s*15px/);
  assert.match(styles, /\.source-monogram--coral\s*{[^}]*color:\s*var\(--paper-light\)/);
  assert.match(styles, /\.event-token--moved\s*{[^}]*color:\s*var\(--paper-light\)/);
});

test("the full post-hero canvas uses the hero fade's soft white", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const mainSurface = styles.match(/\.main-surface\s*{([^}]*)}/)?.[1] ?? "";

  assert.match(dashboard, /className="main-surface"/);
  assert.match(mainSurface, /width:\s*100vw/);
  assert.match(mainSurface, /background:\s*var\(--surface\)/);
});

test("the content removes redundant badges, eyebrows, and footer chrome", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(dashboard, /4 healthy|Collective pulse|Source tape|<footer|<Mark/);
});

test("the dashboard is server-seeded and refreshes from the live dashboard API", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(dashboard, /pulseEvents|sourceTape/);
  assert.match(dashboard, /initialData/);
  assert.match(dashboard, /fetch\("\/api\/dashboard"/);
  assert.match(page, /getDashboardData/);
  assert.match(page, /dynamic = "force-dynamic"/);
});

test("the change feed exposes scrolling without decorative row rails", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.match(dashboard, /className="event-list" role="region" aria-label="Change event feed" tabIndex=\{0\}/);
  assert.match(dashboard, /className="scroll-indicator"/);
  assert.match(styles, /\.event-list\s*{[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.event-list::\-webkit-scrollbar-thumb/);
  assert.doesNotMatch(dashboard, /event-row__rail/);
  assert.doesNotMatch(styles, /\.event-row__rail/);
  assert.match(styles, /prefers-reduced-motion:[^)]+[\s\S]+\.scroll-indicator \.ascii-arrow\s*{\s*animation:\s*none/);
});
