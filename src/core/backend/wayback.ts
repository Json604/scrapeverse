/**
 * Archival history seeding. SERVER-RENDERED SOURCES ONLY.
 *
 * Verified empirically before building this:
 *   GitHub Trending, Jan-2025 capture  → 15 repo rows, 15 "stars today"  ✓ usable
 *   Futurepedia capture                → 0 pricing tokens, 0 __NEXT_DATA__, 0 tool links  ✗ empty shell
 *
 * Two consequences baked in below:
 *  1. Use `if_`, NOT `id_`. `id_` performs zero URL rewriting (measured: 0 archive-rewritten refs
 *     vs 179 for `if_`), so JS-rendering an `id_` document executes LIVE scripts against an old page.
 *     We additionally never execute JS here at all.
 *  2. NO HEALING during replay. Healing against 2024 markup would leave the collector wrong for
 *     2026, and there is no clone command to isolate it.
 */
import { nowIso, sleep, parseNumber } from "../util.ts";
import type { ExtractionBackend, FetchResult, RawRow } from "./types.ts";

const CDX = "https://web.archive.org/cdx/search/cdx";

export interface Capture { timestamp: string; original: string; digest: string }

export async function listCaptures(opts: {
  url: string; from?: string; to?: string; collapseDigits?: number; limit?: number;
}): Promise<Capture[]> {
  const q = new URLSearchParams({
    url: opts.url, output: "json",
    filter: "statuscode:200",
    collapse: `timestamp:${opts.collapseDigits ?? 8}`,   // 8 digits = one capture per day
    fl: "timestamp,original,digest",
  });
  if (opts.from) q.set("from", opts.from);
  if (opts.to) q.set("to", opts.to);
  if (opts.limit) q.set("limit", String(opts.limit));

  const res = await fetch(`${CDX}?${q}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`CDX ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = (await res.json()) as string[][];
  if (rows.length <= 1) return [];

  const seenDigest = new Set<string>();
  const out: Capture[] = [];
  for (const r of rows.slice(1)) {
    const [timestamp, original, digest] = r;
    if (!timestamp || !original) continue;
    // Byte-identical captures cost a fetch and add nothing.
    if (digest && seenDigest.has(digest)) continue;
    if (digest) seenDigest.add(digest);
    out.push({ timestamp, original, digest: digest ?? "" });
  }
  return out;
}

export function captureUrl(timestamp: string, original: string): string {
  return `https://web.archive.org/web/${timestamp}if_/${original}`;
}

/** ISO from a Wayback 14-digit timestamp. */
export function captureIso(ts: string): string {
  const p = (a: number, b: number) => ts.slice(a, b);
  return `${p(0, 4)}-${p(4, 6)}-${p(6, 8)}T${p(8, 10) || "00"}:${p(10, 12) || "00"}:${p(12, 14) || "00"}.000Z`;
}

// ── minimal server-rendered extractors ───────────────────────────────────────
// Replay-only, deliberately dumb, and never healed. Kept narrow so it cannot quietly become a
// second general extraction engine competing with the Scraper Studio collector.
export type ArchiveParser = (html: string) => RawRow[];

const decode = (s: string): string =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/**
 * `if_` rewrites every href to `/web/<ts>/https://origin/path`, so an archived link must be
 * unwrapped before it means anything. (This is the cost of using `if_` — but `id_` does no
 * rewriting at all, which is far worse: it leaves subresources pointing at the LIVE origin.)
 */
export function unwrapArchiveHref(href: string): string {
  const m = href.match(/\/web\/\d+[a-z_]*\/(https?:\/\/.+)$/i);
  const raw = m?.[1] ?? href;
  try { return new URL(raw, "https://github.com").pathname.replace(/^\/+/, ""); }
  catch { return raw.replace(/^\/+/, ""); }
}

export const parseGithubTrending: ArchiveParser = (html) => {
  const rows: RawRow[] = [];
  const articles = html.split(/<article\b/i).slice(1);
  for (const a of articles) {
    const href = a.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i)?.[1];
    if (!href) continue;
    const repo = unwrapArchiveHref(href).split(/[?#]/)[0]!;
    if (repo.split("/").length !== 2 || !repo.split("/").every(Boolean)) continue;
    rows.push({
      repo: decode(repo),
      description: decode(a.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<[^>]+>/g, "") ?? ""),
      language: decode(a.match(/itemprop="programmingLanguage"[^>]*>([\s\S]*?)</i)?.[1] ?? ""),
      stars: parseNumber(a.match(/href="[^"]*\/stargazers"[^>]*>([\s\S]*?)<\/a>/i)?.[1]?.replace(/<[^>]+>/g, "") ?? ""),
      forks: parseNumber(a.match(/href="[^"]*\/forks"[^>]*>([\s\S]*?)<\/a>/i)?.[1]?.replace(/<[^>]+>/g, "") ?? ""),
      starsToday: parseNumber(a.match(/([\d,]+)\s*stars?\s*(?:today|this)/i)?.[1] ?? ""),
    });
  }
  return rows;
};

export const parseHackerNews: ArchiveParser = (html) => {
  const rows: RawRow[] = [];
  const items = html.split(/<tr[^>]*class="[^"]*athing/i).slice(1);
  for (const it of items) {
    const id = it.match(/id="(\d+)"/)?.[1] ?? it.match(/item\?id=(\d+)/)?.[1];
    const link = it.match(/class="[^"]*titlelink[^"]*"[^>]*href="([^"]+)"/i)
      ?? it.match(/<span class="titleline"><a [^>]*href="([^"]+)"/i)
      ?? it.match(/class="storylink"[^>]*href="([^"]+)"/i);
    const title = it.match(/class="[^"]*(?:titlelink|storylink)[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      ?? it.match(/<span class="titleline"><a [^>]*>([\s\S]*?)<\/a>/i);
    if (!id) continue;
    rows.push({
      itemId: id,
      title: decode(title?.[1]?.replace(/<[^>]+>/g, "") ?? ""),
      url: link?.[1] ?? "",
      points: parseNumber(it.match(/(\d+)\s*points?/i)?.[1] ?? ""),
      comments: parseNumber(it.match(/(\d+)(?:&nbsp;|\s)*comments?/i)?.[1] ?? ""),
    });
  }
  return rows;
};

export const ARCHIVE_PARSERS: Record<string, ArchiveParser> = {
  github_trending: parseGithubTrending,
  hackernews: parseHackerNews,
};

export class WaybackBackend implements ExtractionBackend {
  readonly id = "wayback";
  constructor(private readonly parser: ArchiveParser, private readonly capture: Capture) {}

  async fetch(opts: { collectorId: string; url: string }): Promise<FetchResult> {
    const url = captureUrl(this.capture.timestamp, this.capture.original);
    let html = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, {
        headers: { "User-Agent": "driftwatch/0.1 (+archival replay; contact via repo)" },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * 2 ** attempt); continue; }
      if (!res.ok) throw new Error(`wayback ${res.status} for ${url}`);
      html = await res.text();
      break;
    }
    if (!html) throw new Error(`wayback rate-limited after retries: ${url}`);

    return {
      rows: this.parser(html),
      raw: { captureUrl: url, bytes: html.length, digest: this.capture.digest },
      inputUrl: url,
      collectorId: opts.collectorId,
      collectorVersion: `wayback:${this.capture.timestamp}`,
      transport: { providerJobId: this.capture.digest || this.capture.timestamp, fetchedAt: nowIso(), refetched: true },
    };
  }
}

/** Preflight three eras and require records, so a dead source fails fast and loudly. */
export async function preflight(
  source: string, targetUrl: string, window: { from?: string; to?: string } = {},
): Promise<{ ok: boolean; detail: string }> {
  const parser = ARCHIVE_PARSERS[source];
  if (!parser) return { ok: false, detail: `no archive parser for ${source} (client-rendered sources are not replayable)` };

  // Probe the window we will actually replay. Probing all of recorded time hits 2013-era markup
  // that no current parser understands, which says nothing about the requested range.
  const caps = await listCaptures({ url: targetUrl, collapseDigits: 6, limit: 60, ...window });
  if (caps.length < 3) return { ok: false, detail: `only ${caps.length} captures found` };

  const probes = [caps[0]!, caps[Math.floor(caps.length / 2)]!, caps[caps.length - 1]!];
  const counts: number[] = [];
  for (const c of probes) {
    try {
      const r = await new WaybackBackend(parser, c).fetch({ collectorId: "preflight", url: targetUrl });
      counts.push(r.rows.length);
    } catch { counts.push(0); }
    await sleep(1500);
  }
  const ok = counts.filter((n) => n >= 5).length >= 2;
  return { ok, detail: `probe row counts across eras: ${counts.join(", ")}` };
}
