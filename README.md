# Driftwatch

**Version control for the web, pointed at software-industry leaderboards.**

Driftwatch watches public ranking pages, extracts structured entities, and emits a versioned stream
of *real* change events — while absorbing the site redesigns that make ordinary scrapers lie.

```
$ driftwatch log futurepedia --type ATTRIBUTE_CHANGED

  * Perplexity
      pricingModel: Freemium → Paid
      2026-08-18 09:14  ·  futurepedia  ·  ev_9f2c1a44b7e0
```

---

## The problem

When a tracked page changes, that change is ambiguous. It is either:

- **a real content change** — the data actually moved (a price flipped, a rank shifted). This is the
  signal the product exists to capture; or
- **a structure change** — the DOM moved but the underlying data did not. This is noise the
  extraction must absorb.

**Telling these apart is the product.** Existing change-monitoring tools (changedetection.io,
Distill, Visualping) diff raw text or a manually-pinned selector, so a redesign produces a flood of
false "changes" and the pinned selector simply breaks. Driftwatch tracks structured entities,
self-heals through the redesign, and commits only real changes.

## How Bright Data Scraper Studio is used

Scraper Studio runs the extraction. A **custom collector** is created per source from that source's
portable extraction spec, and driven through the `/dca/*` API:

```
POST https://api.brightdata.com/dca/trigger?collector=c_…   → { collection_id }
GET  https://api.brightdata.com/dca/dataset?id=j_…          → rows
```

> This is the **custom** collector API. Driftwatch does **not** use the pre-built scraper library
> (`/datasets/v3/*`) for any source — every collector is created in Scraper Studio from our own spec.

Healing is driven autonomously through the CLI: `scraper heal` → verify preview →
`scraper approve --auto-save` (or `approve --reject`). Never `--auto-approve` — that flag
surrenders the gate. Cron passes `--heal-on-break` so a broken live run fires the same saga
while you sleep, capped at one heal per tick. Scraper Studio does the repair; Driftwatch
decides **when** to fire it, **what** to say, and — crucially — **whether it actually worked**.

## What makes this more than a wrapper

Scraper Studio already ships plain-language self-healing. A nicer prompt is not a contribution.
The contribution is the loop around it, and specifically four things that a prompt wrapper does not do:

**1. Break-vs-change classification, measured.** `driftwatch eval` reports a multiclass confusion
matrix over labeled transitions — not a claim that it self-heals, but a number you can check.

**2. Change breadth as the discriminator.** A real attribute change is *sparse*; a selector drift is
*universal*. One tool flipping to Paid changes 1 row in 40; a column drift changes 40 of 40. This
needs no vocabulary, so it catches drift onto columns we don't even track.

**3. Verification before approval.** `scraper heal` does not commit — it halts at an approval gate
returning `preview_result`. Driftwatch validates, then approves or **rejects**. It never approves a
heal it has not checked, and never uses `--auto-approve`.

**4. Refusing to emit when broken.** A broken extraction diffed against a healthy one produces a
full-table `ENTERED`/`LEFT` storm. That storm is suppressed by design.

## Quick start

```bash
npm install
cp .env.example .env.local          # add MONGODB_URI and BRIGHTDATA_API_KEY

npx tsx src/cli/index.ts init                        # collections + indexes
npx tsx src/cli/index.ts collector create github_trending
npx tsx src/cli/index.ts run github_trending         # genesis → `calibrating`
npx tsx src/cli/index.ts calibrate github_trending   # inspect the extraction
npx tsx src/cli/index.ts calibrate github_trending --sign
npx tsx src/cli/index.ts run github_trending         # now classifies normally
```

Seed real history from the archive (server-rendered sources only):

```bash
npx tsx src/cli/index.ts backfill github_trending --from 20240101 --limit 20
npx tsx src/cli/index.ts timeline github_trending
```

## Commands

| command | purpose |
|---|---|
| `init` · `status` | bootstrap; per-source health board |
| `collector create` · `collector list` | create/list custom Scraper Studio collectors |
| `run <source\|all>` | the loop: fetch → validate → gate → diff → store. Cron adds `--heal-on-break` |
| `calibrate <source> [--sign]` | inspect genesis extraction; sign a baseline per watch key |
| `heal <source> [--dry-run]` | diagnose → heal → verify preview → approve/reject → post-verify |
| `backfill <source>` | seed history from the Wayback Machine |
| `eval` · `fixture` | confusion matrix; capture, mutate and reset labeled fixtures |
| `log` · `diff` · `blame` · `timeline` · `summary` | git-shaped history queries |
| `ask "<question>"` | natural-language queries (provider-agnostic) |

Every command supports `--json`.

## Documentation

- [**docs/CODE_WALKTHROUGH.md**](docs/CODE_WALKTHROUGH.md) — a guided read of the whole codebase, in
  the order the data flows, including every design that was tried and abandoned.
- [**docs/EXPLAINER.md**](docs/EXPLAINER.md) — what this is and why it's hard, a demo that runs from
  a clean checkout, and the limitations up front.

## Architecture

```
CLI (local + GitHub Actions cron)  → trigger, poll, validate, gate, heal, diff, store
MongoDB Atlas                      → snapshots · changeEvents · candidates · baselines · healLog
Vercel / Next.js                   → read API over Mongo (+ UI)
```

The loop runs in the CLI because Vercel Hobby cron is capped at once-per-day with a 10s function
timeout — it cannot hold a scrape-and-poll cycle across six sources.

### Validation

Deterministic end to end. **No LLM anywhere in the scrape → validate → gate → heal path.**

1. **Freshness** — transport evidence (job id, refetch) separated from payload equality. A quiet
   source returning identical rows on a genuinely fresh fetch is *healthy*, not a fault.
2. **Schema** — types, coverage, rank monotonicity. Ranks are *not* assumed contiguous: Product Hunt
   promotes ads, HN injects job rows, GitHub has sponsored slots.
3. **Distributional** — coverage, row count vs the source's own historical floor, and an empirical
   replacement band learned from that source's healthy history.
4. **Evidence** — `breadth`, row-wise field confusion, canaries, presence canaries, cardinality.

Signals are **hard** (unary ⇒ broken) or **soft** (need corroboration, or the same signal on 3
consecutive runs). Baselines update from healthy snapshots only.

### The gate

```
stale       → no diff, no baseline update
calibrating → store only; emit nothing until a baseline is signed
broken      → emit NOTHING; enter the heal saga
degraded    → quarantine as CandidateChange; never the event stream
healthy     → diff against the last healthy snapshot → ChangeEvents
```

Events carry `intervalStart`/`intervalEnd`/`gapCount`, so when snapshots were skipped the timing is
reported as a range — "first observed between X and Y" — never a false precise timestamp.

## Sources

| source | layer | scrape-only | oracle |
|---|---|---|---|
| GitHub Trending | rising code | yes | — |
| Hugging Face trending | rising AI | no | HF API |
| Product Hunt | shipping | yes | — |
| Hacker News front page | pulse | no | Algolia |
| Futurepedia | shipping (tools) | yes | — |
| StackShare trending | adoption | yes | — |
| TIOBE · PYPL · Tech Radar | monthly overlay | yes | — |

Oracles **validate** a scrape; they are never the scrape target. An unalignable oracle reports
*unavailable* — never negative evidence, or it manufactures permanent false breaks.

Product Hunt turns over ~100% daily, so entity overlap is **disabled** as a break signal there.
StackShare barely moves, so the same signal is highly meaningful. Same measurement, opposite
interpretation — which is why bands are per-source and learned rather than hard-coded.

## Rules compliance

- [x] Custom Scraper Studio collectors are the core; the pre-built library is not used
- [x] All targets public, no-login, non-paywalled
- [x] **No personal data** — authors, makers, hunters and profile fields are excluded at the spec
      level *and stripped from raw captures at ingest*. Driftwatch tracks repos, models, products,
      tools and stories — things, not people.
- [x] No government sites

## Verified against live systems

Not aspirational — these were run, and the failures are reported as they happened:

- **Real custom collector created in Scraper Studio** from this repo's extraction spec via
  `brightdata scraper create`, then driven through `/dca/trigger` + `/dca/dataset`.
- **The first generated collector was wrong**, and the system caught it. It produced a *nested*
  output schema — one row per page with an empty `repositories` array — instead of one flat row per
  list item. Driftwatch classified it `schema invalid: zero rows extracted` and **emitted nothing**
  rather than recording 0 rows as truth.
- **`scraper create` prefers a listing→detail two-step.** Step one collects repository URLs, step
  two visits each repo page and emits nothing: 16 rows of `{ repositories: [], product_page_url }`
  with URLs in rank order. The listing parses; the payload never fills. Create descriptions now
  forbid following links; unwrap flattens a filled envelope; empty nested arrays still mean 0 rows.
- **`heal` produced the correct fix; `approve` without `--auto-save` did not make it live.** A
  heal prompt demanding flat top-level fields returned a one-step template whose preview had real
  values (`repo: "modular / modular", stars: "28,632", starsToday: "905"`). `scraper approve` reported
  `status: done` and kept serving the old two-step output. `--auto-save` is what activates the
  template; `approve` now always passes it (and still never `--auto-approve`). Live GitHub Trending
  has since been healthy with real repos.
- **The saga handles this correctly.** Post-verify sees zero usable rows and rolls back rather than
  marking the collector active — which is the behaviour the regression test below pins down.
- **Post-verification had a bug, and it is now a regression test.** The saga accepted a
  verification run whose status was `calibrating` as proof the heal worked. `calibrating` means
  *"not enough history to classify yet"* — it is not evidence, and accepting it let a collector
  that still returned zero rows be marked `active`. Post-verify now additionally requires valid
  schema, no hard signals, and a non-zero row count.
- **The decisive demonstration, run end-to-end through the real pipeline** (fixture channel, its own
  collector, its own baseline):

  ```
  v1 (calibration ×3)      calibrating  events=0   store_only
  baseline signed
  v1 (reference)           healthy      events=0   store_only

  v2 STRUCTURE changed     broken       events=0   heal      ← 25/25 rows moved
  v3 CONTENT changed       healthy      events=1   emit      ← 1/25 rows moved
  ```

  The structure case is a drift onto an **untracked** column — no vocabulary check can see it, and
  it is caught purely by change breadth. It emits **nothing**. The content case emits exactly one
  event. Same machine, two answers.

- **Real archived history replayed** from the Wayback Machine: 14 monthly GitHub Trending captures
  (2024–2025) producing 50 real change events with gap-aware intervals
  (`between 2024-04-01 and 2024-06-01 (1 gap)` — never a false precise timestamp).
- **Live MongoDB Atlas**, 17 indexes, idempotent `init`.
- **44 unit tests**, including every classifier case that defeated an earlier design of this system.

## Honest limitations

- **Futurepedia cannot be backfilled.** Its archived captures are client-rendered shells with zero
  records in the HTML (verified: 0 pricing tokens, 0 `__NEXT_DATA__`, 0 tool links). The money-demo
  source therefore has no real-redesign labels.
- **Fixture eval numbers are a regression suite, not accuracy.** A headline generalization number
  requires the `wayback` and `live-shadow` sets; fixture cases are small and synthetic.
- **Thresholds ship uncalibrated.** `config/weights.json` defaults are starting points, marked
  `0.1.0-uncalibrated`. They are meant to be refit from real history, not quoted as tuned values.
- **Heal accuracy measured on fixtures does not transfer to live.** A fixture collector learns
  fixture selectors; the two are reported separately.
