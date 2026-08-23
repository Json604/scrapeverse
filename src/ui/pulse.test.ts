import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import {
  buildAsciiSourceMap,
  driftwatchHeroArtwork,
  filterPulseEvents,
  summarizePulse,
  type PulseEvent,
} from "./pulse.ts";
import { fitTooltipPosition } from "./tooltip-position.ts";

const events: PulseEvent[] = [
  {
    id: "entered",
    entityId: "github_trending:openai/codex",
    kind: "entered",
    entity: "openai/codex",
    url: "https://github.com/openai/codex",
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
    entityId: "hackernews:show-hn-driftwatch",
    kind: "moved",
    entity: "Show HN: Driftwatch",
    url: "https://news.ycombinator.com/",
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
    entityId: "pypl:python",
    kind: "changed",
    entity: "Python",
    url: "https://pypl.github.io/PYPL.html",
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

test("the print-theme hero uses the optimized project artwork", () => {
  assert.equal(driftwatchHeroArtwork, "/driftwatch-eye-hero-v1.webp");
});

test("the hero uses a small eagerly preloaded raster for its first paint", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const nextConfig = readFileSync(new URL("../../next.config.mjs", import.meta.url), "utf8");
  const artwork = statSync(new URL("../../public/driftwatch-eye-hero-v1.webp", import.meta.url));

  assert.ok(artwork.size < 500_000);
  assert.match(dashboard, /fetchPriority="high"/);
  assert.match(dashboard, /loading="eager"/);
  assert.match(nextConfig, /source:\s*"\/"/);
  assert.match(nextConfig, /<\/driftwatch-eye-hero-v1\.webp>; rel=preload; as=image; type=image\/webp; fetchpriority=high/);
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
  const navLink = styles.match(/\.topbar nav > a, \.source-menu > summary\s*{([^}]*)}/)?.[1] ?? "";
  const wind = styles.match(/\.hero-art__wind\s*{([^}]*)}/)?.[1] ?? "";

  assert.doesNotMatch(hero, /<Mark|preview|account-button|status-pill|hero__proof/);
  assert.match(dashboard, />driftwatch<\/span>/);
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
  assert.match(dashboard, /className="filter-bar__selection"/);
  assert.match(dashboard, /className="follow-toggle__thumb"/);
  assert.match(styles, /--glass-selection-index/);
  assert.match(styles, /cubic-bezier\(0\.22, 1\.15, 0\.36, 1\.06\)/);
  assert.match(styles, /\.liquid-glass__rim/);
  assert.match(styles, /prefers-reduced-motion:[^)]+[\s\S]+\.filter-bar__selection/);
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

test("the change feed exposes a real scrollbar without decorative prompts or row rails", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const eventList = styles.match(/\.event-list\s*{([^}]*)}/)?.[1] ?? "";

  assert.match(dashboard, /className="event-list" role="region" aria-label="Change event feed" tabIndex=\{0\}/);
  assert.match(eventList, /overflow-y:\s*auto/);
  assert.match(eventList, /overscroll-behavior-y:\s*auto/);
  assert.doesNotMatch(eventList, /overscroll-behavior:\s*contain/);
  assert.match(styles, /\.event-list::\-webkit-scrollbar-thumb/);
  assert.doesNotMatch(dashboard, /scroll-indicator|>Scroll</i);
  assert.doesNotMatch(styles, /\.scroll-indicator|scroll-nudge/);
  assert.doesNotMatch(dashboard, /event-row__rail/);
  assert.doesNotMatch(styles, /\.event-row__rail/);
});

test("actions use packaged icons and the board explains that it shows list leaders", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /from "lucide-react"/);
  assert.doesNotMatch(dashboard, /function AsciiArrow|className="ascii-arrow"|>↻<|>→<|\[ok\]|\[!\]|\[ ø \]/);
  assert.match(dashboard, /What's #1 on each watched list\./);
  assert.match(dashboard, /View all rankings/);
  assert.match(dashboard, /\{board\.source\} · #\{board\.rank\}/);
});

test("every arrow action has a real destination and the header blurs its backdrop", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const changelog = readFileSync(new URL("../../app/changelog/page.tsx", import.meta.url), "utf8");
  const rankings = readFileSync(new URL("../../app/rankings/page.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const topbar = styles.match(/\.topbar\s*{([^}]*)}/)?.[1] ?? "";
  const topbarGlass = styles.match(/\.topbar::before\s*{([^}]*)}/)?.[1] ?? "";

  assert.match(dashboard, /href=\{event\.url\}/);
  assert.match(dashboard, /target="_blank"/);
  assert.match(dashboard, /rel="noopener noreferrer"/);
  assert.match(dashboard, /href="\/changelog"/);
  assert.match(dashboard, /href="\/rankings"/);
  assert.match(changelog, /getDashboardData/);
  assert.match(changelog, /getDashboardData\(300\)/);
  assert.match(rankings, /getDashboardData/);
  assert.match(topbar, /background:\s*transparent/);
  assert.match(topbar, /backdrop-filter:\s*none/);
  assert.match(topbarGlass, /backdrop-filter:\s*blur\(18px\)/);
  assert.match(topbarGlass, /--surface-rgb\) \/ 0\.34/);
  assert.match(styles, /\.topbar--compact::before\s*{\s*opacity:\s*1/);
});

test("all page headers use the shared collapse behavior", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const explorerHeader = readFileSync(new URL("../../app/explorer-header.tsx", import.meta.url), "utf8");
  const collapseHook = readFileSync(new URL("../../app/use-collapsing-header.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.match(dashboard, /useCollapsingHeader/);
  assert.match(explorerHeader, /useCollapsingHeader/);
  assert.match(explorerHeader, /explorer-nav--compact/);
  assert.match(explorerHeader, /header-collapse-sentinel/);
  assert.match(collapseHook, /IntersectionObserver/);
  assert.match(styles, /\.explorer-nav--compact\s*{/);
});

test("domain terms expose fast black contextual tooltips", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const changelog = readFileSync(new URL("../../app/changelog/page.tsx", import.meta.url), "utf8");
  const tooltip = readFileSync(new URL("../../app/context-tip.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.match(dashboard, /ContextTip/);
  assert.match(changelog, /ContextTip/);
  assert.match(tooltip, /role="tooltip"/);
  assert.match(tooltip, /aria-describedby/);
  assert.match(styles, /\.context-tip__bubble\s*{[^}]*background:\s*var\(--text-primary\)/);
  assert.match(styles, /\.context-tip__bubble\s*{[^}]*transition:[^;]*125ms var\(--ease-out\)/);
  assert.match(styles, /\.context-tip__bubble\[data-open="true"\]/);
});

test("contextual tooltips clamp to the viewport and flip below crowded anchors", () => {
  const tooltip = readFileSync(new URL("../../app/context-tip.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.match(tooltip, /getBoundingClientRect/);
  assert.match(tooltip, /innerWidth/);
  assert.match(tooltip, /data-placement/);
  assert.match(styles, /\.context-tip__bubble\s*{[^}]*width:\s*min\(260px, calc\(100vw - 24px\)\)/);
  assert.match(styles, /\.context-tip__bubble\[data-placement="below"\]/);
});

test("a changelog tooltip stays readable beside the left viewport edge", () => {
  const position = fitTooltipPosition({ top: 196, bottom: 222, left: 94, width: 89 }, 514);

  assert.deepEqual(position, { left: 142, top: 188, placement: "above" });
});

test("a tooltip flips below when the anchor is too close to the top edge", () => {
  const position = fitTooltipPosition({ top: 48, bottom: 74, left: 16, width: 80 }, 320);

  assert.deepEqual(position, { left: 142, top: 82, placement: "below" });
});

test("rankings use a responsive bento with independently scrollable live lists", () => {
  const rankings = readFileSync(new URL("../../app/rankings/page.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.match(rankings, /ranking-panel--\$\{ranking\.sourceId\}/);
  assert.match(rankings, /aria-label=\{`\$\{ranking\.source\} rankings`\}/);
  assert.match(rankings, /tabIndex=\{0\}/);
  assert.match(styles, /\.ranking-grid\s*{[^}]*grid-template-areas:/);
  assert.match(styles, /\.ranking-panel--hackernews\s*{[^}]*grid-area:\s*hn/);
  assert.match(styles, /\.ranking-list\s*{[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.ranking-list\s*{[^}]*overscroll-behavior-y:\s*auto/);
});

test("ranking separators use quiet structural lines instead of black rules", () => {
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const panelHeading = styles.match(/\.panel-heading\s*{([^}]*)}/)?.[1] ?? "";
  const boardCell = styles.match(/\.board-strip > div\s*{([^}]*)}/)?.[1] ?? "";

  assert.match(panelHeading, /border-bottom:\s*1px solid var\(--line\)/);
  assert.match(boardCell, /border-right:\s*1px solid var\(--line\)/);
  assert.doesNotMatch(boardCell, /2px solid var\(--ink\)/);
});

test("rankings appear before the pulse and source panels", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const rankingsPosition = dashboard.indexOf('<section className="content-panel boards"');
  const pulsePosition = dashboard.indexOf('<div className="content-grid">');

  assert.notEqual(rankingsPosition, -1);
  assert.notEqual(pulsePosition, -1);
  assert.ok(rankingsPosition < pulsePosition);
});

test("the header collapses into a centered compact island after leaving the hero top", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const topbar = styles.match(/\.topbar\s*{([^}]*)}/)?.[1] ?? "";
  const compact = styles.match(/\.topbar--compact\s*{([^}]*)}/)?.[1] ?? "";

  assert.match(dashboard, /useCollapsingHeader/);
  assert.match(dashboard, /header-collapse-sentinel/);
  assert.match(dashboard, /topbar--compact/);
  assert.doesNotMatch(dashboard, /addEventListener\(["']scroll/);
  assert.match(topbar, /position:\s*fixed/);
  assert.match(topbar, /left:\s*50%/);
  assert.match(topbar, /border-radius:\s*0/);
  assert.match(topbar, /transition:[^;]*280ms var\(--ease-move\)/);
  assert.match(compact, /width:\s*min\(670px,/);
  assert.match(compact, /border-radius:\s*999px/);
  assert.match(styles, /\.topbar:not\(\.topbar--compact\) nav\s*{[^}]*background:\s*transparent/);
  assert.match(styles, /\.topbar--compact \.brand/);
  assert.match(styles, /prefers-reduced-motion:[^)]+[\s\S]+\.topbar, \.topbar::before, \.explorer-nav\s*{[^}]*transition:\s*none/);
});

test("the header routes to real destinations and exposes sources as a status popover", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  assert.match(dashboard, /href="\/changelog"[^>]*>Changes</);
  assert.match(dashboard, /href="\/rankings"[^>]*>Rankings</);
  assert.match(dashboard, /function SourceMenu/);
  assert.match(dashboard, /<details className="source-menu">/);
  assert.match(dashboard, /aria-label="Watched sources"/);
  assert.match(dashboard, /source-menu__status/);
  assert.doesNotMatch(dashboard, /navigationItems|activeNavigation|topbar__selection/);
  assert.match(styles, /\.source-menu__popover\s*{[^}]*backdrop-filter:\s*blur\(/);
  assert.match(styles, /\.source-menu__row\s*{/);
});

test("the dashboard keeps primary navigation reachable through a mobile menu", () => {
  const dashboard = readFileSync(new URL("../../app/pulse-dashboard.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const mobileBreakpoint = styles.match(/@media \(max-width: 880px\)\s*{([\s\S]*?)(?=@media \(max-width: 620px\))/)?.[1] ?? "";

  assert.match(dashboard, /Menu,/);
  assert.match(dashboard, /X,/);
  assert.match(dashboard, /aria-expanded=\{mobileMenuOpen\}/);
  assert.match(dashboard, /className="mobile-nav__popover"/);
  assert.match(dashboard, /href="\/changelog"/);
  assert.match(dashboard, /href="\/rankings"/);
  assert.match(dashboard, /href="#sources"/);
  assert.match(styles, /\.mobile-nav\s*{[^}]*display:\s*none/);
  assert.match(mobileBreakpoint, /\.mobile-nav\s*{[^}]*display:\s*block/);
  assert.match(styles, /\.mobile-nav__popover\s*{[^}]*transition:[^;]*180ms var\(--ease-out\)/);
  assert.match(styles, /prefers-reduced-motion:[^)]+[\s\S]+\.mobile-nav__popover/);
});
