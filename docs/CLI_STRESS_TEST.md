# CLI stress test — what was broken, what improved

Ran the unit suite, then every CLI product path (init, status, eval, fixture demo, log/blame/timeline/summary, review, calibrate, heal dry-run, collector print, backfill refusals, ask, error cases). **52 tests pass.** The fixture gate demo still holds: structure → `broken` + 0 events; content → `healthy` + 1 event.

## What was not working

### 1. `eval --source` scored the wrong product
Synthetic records were always Futurepedia-shaped (`pricingModel` / `category`, no metrics). Evaluating under `github_trending` (required `stars` / `starsToday`) classified **every CHANGE operator as BREAK** — coverage collapse on missing metrics, then field-confusion once metrics were added with identical values.

`--set nope` printed `n=0 precision 1.000` instead of failing. `--source tiobe` (no `watchKeys`) printed a fake 0.250 recall.

### 2. `heal --dry-run` could not run the fixture demo
The saga treated any collector id that did not `startWith("fixture")` as live. Fixture paths are `github_trending/v2-structure`, so the demo heal was refused. Dry-run also dumped a Scraper Studio template *before* returning, so even a passing guard would have called Bright Data on a file path.

### 3. Copy-paste footguns
`calibrate` on a non-live channel suggested `driftwatch calibrate <source> --sign` with the channel flag dropped — that signs **live**. `ask` without an API key dumped a raw SDK auth error.

## What improved

| command | before | after |
|---|---|---|
| `eval --source github_trending` | CHANGE cases → BREAK | source-shaped synthetic; CHANGE stays CHANGE |
| `eval --set nope` / `--set wayback` | silent n=0, precision 1.000 | hard error with the legal sets |
| `eval --source tiobe` | misleading matrix | error: no watchKeys |
| `heal --channel fixture:* --fixture … --dry-run` | refused | prints the heal prompt, mutates nothing |
| `heal --channel fixture:*` (live `c_*`) | refused (correct) | still refused |
| `calibrate --channel fixture:…` | suggested `--sign` without channel | echoes `--channel` |
| `ask` with no key | SDK stack | “set ANTHROPIC_API_KEY or OPENAI_API_KEY” |

Guards are unit-tested (`src/core/heal/guard.test.ts`, `src/core/eval/runner.test.ts`).

## Still out of scope (honest, not silent)

- Live GitHub Trending is healthy (real repos). `approve --auto-save` is what activates a healed template; cron now passes `--heal-on-break` (one saga per tick). `scraper create` can still invent listing→detail if the description does not forbid following links.
- Wayback `replay:hist3` after mid-2024 is `broken` (row count vs a 25-row signed baseline). One healthy pair emitted 25 ENTERED + 25 LEFT — real monthly turnover, not a classifier false positive.
- `ask` needs a configured LLM key. `backfill futurepedia` correctly refuses client-rendered archives.
