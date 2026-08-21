# Explaining Driftwatch

Everything you need to present this: the pitch, a demo that runs from a clean checkout, the
questions people will ask, and the things that don't work.

---

## 1. The one-liner

> **Driftwatch is version control for the web.** It watches public ranking pages and commits a
> history of what actually changed — while absorbing the site redesigns that make ordinary scrapers
> lie.

If you get one more sentence:

> The hard part isn't scraping. It's that when a page changes, you can't tell whether the *data*
> moved or the *DOM* moved — and if you guess wrong, a redesign becomes forty fake price changes.

---

## 2. The problem, in thirty seconds

Point at any leaderboard — GitHub Trending, Product Hunt, an AI-tools directory. Then:

> Scrape it today, scrape it tomorrow, diff the two. You get a list of differences. Now: which of
> those differences are real?
>
> If the site shipped a redesign overnight, your selector is now reading the wrong column — and
> every single row "changed." Your monitoring tool reports forty price changes. None of them
> happened.
>
> That ambiguity is the entire problem. **A changed page is either the data moving, which is
> signal, or the structure moving, which is noise. Telling those apart is the product.**

Why existing tools don't solve it: changedetection.io, Distill and Visualping diff raw text or one
manually-pinned selector. A redesign floods them with false positives *and* breaks the selector.
They have no concept of an entity, so they can't even ask the question.

---

## 3. The insight — change breadth

This is the part to slow down on. It's one idea, and it fits on a napkin.

> A real content change is **sparse**. A structure change is **universal**.
>
> When one tool actually flips from Free to Paid, exactly one row moves — 1 in 40.
> When your selector drifts onto the next column, every row moves — 40 out of 40.
>
> So we don't ask *"is this value plausible?"* We ask *"how many rows moved at once?"*

| | rows changed | verdict |
|---|---|---|
| one repo's language edited | 1 / 25 | content — **publish it** |
| column drifts to a sibling | 25 / 25 | structure — **publish nothing, heal instead** |

**Why this beats the obvious alternatives** — worth having ready, because smart people propose both:

- *"Just learn the valid values for each column."* Tried it. Defeated by drift onto an **untracked**
  column: `pricingModel` starts reading a `deployment` chip of `{Cloud, API, Self-hosted}`. Those
  aren't in any tracked vocabulary, so the check says "new values — must be a content change" and
  **fails open**. Breadth needs no vocabulary, so it catches drift onto columns we don't even track.
- *"Pin some known values as canaries."* Tried it. Those canaries **reject the money demo** — a
  genuine Free → Paid flip is, by definition, a canary mismatch. The check fires hardest exactly
  where the product is working.

Breadth survives both because it measures the one property that actually differs between the two
cases. It's fourteen lines of code in `src/core/validate/evidence.ts`.

---

## 4. The live demo

Reproducible from a clean checkout. Takes about a minute. **Run `fixture reset` first** — the demo
is stateful, and a half-calibrated channel produces a confusing second run.

```bash
npx tsx src/cli/index.ts fixture reset github_trending
```

### Setup narration

> These are three snapshots of GitHub Trending. `v1` is real — 25 rows captured live through a
> Bright Data collector. `v2` is `v1` with the language column drifted onto a sibling: the DOM moved,
> the data didn't. `v3` is `v1` with exactly one row's value edited: the data moved, the DOM didn't.
>
> A text differ sees "something changed" in both. Watch what this does.

### Step 1 — calibrate

```bash
for i in 1 2 3; do
  npx tsx src/cli/index.ts run github_trending --channel fixture:demo --fixture github_trending/v1
done
npx tsx src/cli/index.ts calibrate github_trending --channel fixture:demo --sign
```

```
v1 (calibration 1)   calibrating   events=0   store_only
v1 (calibration 2)   calibrating   events=0   store_only
v1 (calibration 3)   calibrating   events=0   store_only
baseline signed
```

> Note it refuses to say anything at all yet. A first extraction that looks plausible but is wrong
> would install itself as truth forever, so nothing publishes until a human signs the baseline.

### Step 2 — a healthy reference

```bash
npx tsx src/cli/index.ts run github_trending --channel fixture:demo --fixture github_trending/v1
```

```
v1 (reference)       healthy       events=0   store_only
```

### Step 3 — the structure change

```bash
npx tsx src/cli/index.ts run github_trending --channel fixture:demo --fixture github_trending/v2-structure
```

```
v2 STRUCTURE changed  broken       events=0   heal
```

> 25 of 25 rows moved. Universal ⇒ structure. It publishes **nothing** and routes to the heal path.
> A normal differ would have emitted 25 change events here, and every one would be false.

### Step 4 — the content change

```bash
npx tsx src/cli/index.ts run github_trending --channel fixture:demo --fixture github_trending/v3-content
npx tsx src/cli/index.ts log github_trending --channel fixture:demo
```

```
v3 CONTENT changed    healthy      events=1   emit

  * danielmiessler/fabric
      language: Python → Paid
      between 2026-08-21 and 2026-08-21 18:42 (1 gap)  ·  github_trending  ·  ev_8394ffccef…
```

> 1 of 25 rows moved. Sparse ⇒ content. Exactly one event.
>
> **Same machine, two opposite answers, and the difference is measured, not guessed.**

Two details worth pointing at if you have the room:

- **"between … (1 gap)"** — the broken snapshot sits between the two healthy ones, so the timing is
  reported as a *range*, not a false precise timestamp. The system will not claim to know something
  it doesn't.
- The literal value `Paid` looks odd on a `language` field. That's the mutation operator: it's shared
  with the Futurepedia pricing case and writes a fixed value. What matters is the *count* — one row
  out of twenty-five.

### If you have another minute

```bash
npx tsx src/cli/index.ts eval          # confusion matrix over 12 labeled operators
npx tsx src/cli/index.ts timeline github_trending --channel replay:hist3
```

The replay channel holds 14 real Wayback captures of GitHub Trending (2024–2025) producing 50 real
change events with gap-aware intervals.

---

## 5. How Bright Data is used — and why it isn't a wrapper

**Say the honest version first; it lands better than a claim.**

> Scraper Studio does the extraction and the repair. We create a **custom collector** per source from
> our own portable spec, drive it through `/dca/trigger` and `/dca/dataset`, and when it breaks we
> call `scraper heal`.
>
> Scraper Studio already ships plain-language self-healing. A nicer prompt is not a contribution.
> **The contribution is the loop around it** — knowing *when* to fire a heal, *what* to say, and
> above all *whether it actually worked*.

Four things a prompt wrapper does not do:

1. **Classification you can check.** `driftwatch eval` prints a multiclass confusion matrix over
   labeled transitions. Not a claim that it self-heals — a number.
2. **Breadth as the discriminator.** Needs no vocabulary, so it catches drift onto untracked columns.
3. **Verification before approval.** `scraper heal` doesn't commit; it halts at an approval gate
   returning `preview_result`. Driftwatch validates, then approves *or rejects*. It never passes
   `--auto-approve` — that flag would surrender the entire gate.
4. **Refusing to emit when broken.** The full-table `ENTERED`/`LEFT` storm is suppressed by design.

Also worth stating plainly: this uses the **custom collector** API (`/dca/*`), not the pre-built
scraper library (`/datasets/v3/*`). Every collector is authored in Scraper Studio from our spec.

---

## 6. The strongest thing you can show

If someone is skeptical that any of this is real, show them the heal log:

```
01:39:16  active       preview=true  post=true
01:51:58  rolled_back  preview=true  post=false
```

> Same collector, same empty result, opposite outcomes.
>
> The first line is a bug I shipped. Post-verification accepted a status of `calibrating` as proof
> the heal worked — but `calibrating` means *"not enough history to classify yet."* It isn't
> evidence. So a collector that was still returning **zero rows** got marked healthy.
>
> The second line is the fixed code refusing the same situation. Post-verify now also demands valid
> schema, no hard signals, and a non-zero row count.
>
> That's the exact failure this whole system exists to prevent — an assurance that can't be
> falsified — and it got past me in design *and* in code review. The runtime caught it. It's a
> regression test now.

Leading with a bug you found is a stronger move than claiming you had none. It demonstrates the
verification actually runs.

---

## 7. Questions you will get

**"Isn't this just a diff tool?"**
A diff tool emits whatever it finds. The gate decides whether it has earned the right to emit at
all. Broken extraction publishes nothing; uncertain extraction is quarantined, never published at
half confidence — halving a number doesn't make a false event true.

**"What if the site changes structure and content on the same day?"**
That's the `structure_and_content` operator in the eval set — labeled BREAK, and deliberately
included because an earlier design excluded it by construction. When structure moves, we can't trust
the content read, so we suppress and heal. We'd rather miss a real change than publish a fake one.

**"How do you know a heal worked?"**
We don't take the heal's word for it. Preview is schema-only — honestly, because a preview is a
sample of a handful of rows and breadth or canaries mean nothing at that size. The real gate is a
full run afterwards, and if it fails we roll back to the template dumped *before* anything mutated.

**"Your thresholds are made up."**
Yes, and the file says so: `config/weights.json` is versioned `0.1.0-uncalibrated`. They're starting
points meant to be refit from real history. We'd rather ship a number labeled uncalibrated than
quote it as tuned.

**"100% precision and recall? Really?"**
On 12 fixture cases, which is a **regression suite, not an accuracy claim** — the `eval` command
prints that disclaimer itself. A generalization number needs the wayback and live-shadow sets. The
fixture cases exist to stop old bugs coming back, and every one of them is a design that nearly
shipped.

**"Why a CLI instead of running it on Vercel?"**
Vercel Hobby cron is once a day with a 10-second function timeout. It cannot hold a scrape-and-poll
cycle across six sources. The CLI is the runtime, GitHub Actions is the scheduler, and Vercel serves
the read API.

**"What about personal data?"**
Excluded at two levels. No `author`/`maker`/`hunter`/`username` field exists in any spec, and
`stripPii()` removes them from raw captures *before* storage — a README can't claim exclusion while
the database still holds bylines. Driftwatch tracks repos, models, products, tools and stories.
Things, not people.

---

## 8. What doesn't work — know this before someone finds it

Have these ready. Being first to your own limitations is worth more than hoping nobody checks.

**The live GitHub Trending collector returns no usable rows.** Four generations were built:

| | outcome |
|---|---|
| v1 | 17 rows, nested schema — one row per *page* with an empty `repositories[]` |
| v2, v3 | rejected at creation: `Invalid description` (undocumented length limit, ~480 chars OK, 700 not) |
| v4 | generated cleanly, **0 rows** |
| v5 | same two-step shape; heal proposed a correct 1-step template that `approve` did not activate |

The mechanism is now known, and it isn't the description. `scraper create` plans the page as a
listing→detail pipeline: step one collects repository URLs, step two visits each repository page and
emits nothing. The URLs come back correct and in rank order, so the listing parses fine — the
payload just never fills. **This shape is invariant across three different create descriptions**,
including one that explicitly forbids following links.

`scraper heal` *can* fix it. Asked for flat top-level fields, it proposed a **one-step** template
whose preview emitted every field with real values:

```json
{"repo": "modular / modular", "description": "The Modular Platform (includes MAX & Mojo)",
 "language": "", "stars": "28,632", "forks": "3,048", "starsToday": "905"}
```

But `scraper approve` reports `status: done` and the live collector keeps serving the old two-step
template — verified on a freshly triggered collection, so it isn't caching. The healed template
exists and is correct; it just isn't the one being served. Activating it is a browser-IDE action.

If someone asks why you didn't just fix it: the fix isn't reachable from the API surface
(`create`, `run`, `heal`, `approve` are the only commands, and there is no endpoint that returns a
collector's steps). Worth adding that the system's own post-verify catches this — it sees zero
usable rows and rolls back instead of marking the collector healthy.

What this does and doesn't cost: the engine, classifier, gate, heal saga, replay and query layer all
run on identical code paths in the fixture and replay channels. The gap is collector *authoring*,
sitting in front of a working pipeline — not a gap in the pipeline.

**Futurepedia cannot be backfilled.** Its archived captures are client-rendered shells. Verified
empty: 0 pricing tokens, 0 `__NEXT_DATA__`, 0 tool links. So the money-demo source has no
real-redesign labels, and the pricing demo runs on fixtures.

**Thresholds ship uncalibrated.** As above.

**Fixture heal accuracy doesn't transfer to live.** A fixture collector learns fixture selectors. The
two are reported separately, never pooled.

---

## 9. Numbers

| | |
|---|---|
| source files / lines | 63 / ~4,950 |
| tests | 44, all passing |
| CLI commands | 16 |
| sources | 9 (6 daily + 3 monthly overlay) |
| Mongo collections / indexes | 10 / 17 |
| real change events | 50 from Wayback replay, 1 from the fixture gate demo |
| real heal sagas | 5 logged against live Scraper Studio |

---

## 10. Thirty-second version

> Driftwatch is version control for the web. The hard problem is that a changed page is ambiguous —
> either the data moved or the DOM moved, and guessing wrong turns a redesign into forty fake price
> changes.
>
> The trick is that real changes are sparse and structural breaks are universal. One tool flipping to
> Paid moves one row in forty. A drifted column moves all forty. So we measure how *many* rows moved,
> not whether the values look plausible.
>
> Bright Data does the scraping and the healing. We do the deciding: when a page breaks we publish
> nothing, fire a heal, verify it against evidence, and roll back if it fails. The system's actual
> job is knowing when not to speak.
