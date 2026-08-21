# Code walkthrough

A guided read of the whole codebase, in the order the data actually flows.
63 TypeScript files, ~4,950 lines, 44 tests.

If you read only one thing, read [§5 Evidence](#5-evidence--the-crown-jewel). That file is the
product; everything else is plumbing around it.

---

## 0. The mental model

```
                    ┌─────────────┐
   a ranked page ──▶│  extraction │──▶ raw rows
                    └─────────────┘
                           │
                    ┌──────▼──────┐
                    │  normalize  │──▶ NormalizedRecord[]   (stable entity ids)
                    └──────┬──────┘
                    ┌──────▼──────┐
                    │  validate   │──▶ status: healthy | degraded | broken | stale | calibrating
                    └──────┬──────┘
                    ┌──────▼──────┐
                    │  THE GATE   │──▶ emit | quarantine | heal | store_only
                    └──────┬──────┘
                    ┌──────▼──────┐
                    │    diff     │──▶ ChangeEvent[]
                    └─────────────┘
```

Every interesting decision in this repo is an answer to one question: **the page changed — is that
the data moving, or the DOM moving?** Content change is signal. Structure change is noise. A tool
that cannot tell them apart reports a site redesign as 40 simultaneous price changes.

**The gate is the product.** A differ emits whatever it finds. Driftwatch decides whether it has
earned the right to emit at all.

---

## 1. Repository layout

```
src/core/            the engine — no I/O assumptions, fully unit-testable
  types.ts           the data model; every field is a decision
  config.ts          env + versioned tunables
  util.ts            hashing, stats, url canonicalization
  db.ts              Mongo client, collections, 17 indexes
  backend/           HOW rows are obtained (Bright Data | fixture | wayback)
  sources/           WHAT each site means (6 adapters + monthly overlay)
  validate/          is this extraction trustworthy?
  gate.ts            may we publish?
  diff.ts            what actually changed?
  pipeline.ts        the loop that wires the above together
  heal/              repair a broken collector, safely
  store/             persistence + idempotency
  query/             read side + the agent's tools
  llm/               provider-agnostic agent (Anthropic | OpenAI)
  eval/              measure the classifier
  fixtures/          labeled mutation operators
src/cli/             16 commands over the engine
app/                 Next.js read API (5 routes) + placeholder page
fixtures/            captured + mutated snapshots for the demo
config/weights.json  every threshold, versioned
```

Two rules the layout enforces:

- **`src/core` never imports from `src/cli` or `app`.** The engine is a library; the CLI and the web
  API are two thin callers of it.
- **`backend/` is an interface, not Bright Data.** Bright Data is one implementation. This is what
  makes the fixture demo and the Wayback replay run through *the same* classifier rather than a
  simulation of it.

---

## 2. The data model — `src/core/types.ts`

Read this file first. It is 250 lines and four of its decisions were bugs in earlier drafts.

### `Channel` — the isolation boundary

```ts
export type Channel = "live" | `replay:${string}` | `fixture:${string}`;
```

`channel` is on **every** document and in **every** index. Without it, a 2024 Wayback backfill
silently becomes the baseline for a 2026 live run — the archived page has 15 rows, the live page has
25, and the live source is now permanently "broken" against history that isn't its own.

### `NormalizedRecord` — one ranked item

```ts
entityId: string;                    // `${source}:${nativeId}` — the diff key
metrics: Record<string, Metric>;     // KEYED map, not headline + array
attributes: Record<string, AttributeValue>;
```

`metrics` is a keyed map because v1 had `primaryMetric` plus a `secondaryMetrics[]` array, and the
diff only ever looked at the primary. Forks and today-stars silently never diffed.

`nativeId` is **never a person**. That is a hackathon rule, and it's enforced twice — at spec level
(no `author`/`maker`/`hunter` fields exist) and again at ingest by `stripPii()`.

### There is no `attributesHash`

An earlier draft hashed "slow-moving attributes" and diffed the hash. Two failures at once:

- `pricingModel` — the single most valuable field in the product — was excluded from the hash, so
  the money demo would have emitted nothing;
- any copy tweak anywhere flipped the hash, so every re-render emitted a change.

Replaced by explicit per-source `watchKeys`.

### `payloadHash` and `transport` are separate

```ts
payloadHash: string;        // sha256 over normalized records, timestamps stripped
transport: TransportMeta;   // job id, refetch flag, http age
```

Conflating "the bytes are identical" with "we didn't really fetch" freezes quiet sources. StackShare
barely moves; a byte-identical StackShare day is *honest*, not stale. See [§4](#4-freshness).

### `FieldEvidence.breadth`

```ts
/** Fraction of persisting entities whose value changed. Sparse ⇒ content, universal ⇒ structure. */
breadth: number;
```

This is the whole thesis, expressed as one number. [§5](#5-evidence--the-crown-jewel).

---

## 3. The extraction boundary — `src/core/backend/`

```ts
export interface ExtractionBackend {
  readonly id: string;
  fetch(opts: { collectorId: string; url: string }): Promise<FetchResult>;
}
```

Three implementations:

### `brightdata.ts` — the real one

Drives Bright Data Scraper Studio's **custom collector** API:

```
POST /dca/trigger?collector=c_…&queue_next=1   → { collection_id }
GET  /dca/dataset?id=…                         → status object … then a JSON array
```

The completion signal is a **shape change**: the endpoint returns a status object while building and
a bare array when done. There is no separate progress endpoint on `/dca`, so `dataset()` polls with
exponential backoff (3s → 15s) and treats "response is an Array" as done.

Deliberately **not** `/datasets/v3/*`. That is the pre-built scraper library; using it would mean the
submission contains no scraper actually authored in Scraper Studio.

### `fixture.ts` — deterministic replay

Reads `fixtures/<source>/<variant>.json`. One subtlety with a scar on it:

```ts
transport: { providerJobId: `fixture_${uuid()}`, ... }
```

A fixture read gets a **fresh job id every time**. When it reused a constant id, the freshness check
(correctly) called every repeat read `stale`, so a fixture channel could never accumulate the three
consecutive runs that calibration requires. The demo deadlocked.

### `wayback.ts` — archival seeding

CDX API → capture list → fetch → parse. Two things learned the hard way:

- Use the `if_` modifier, not `id_`. `id_` does **zero** URL rewriting, which sounds ideal but isn't
  what the endpoint actually serves.
- `if_` *does* rewrite hrefs into `web.archive.org/web/…/https://github.com/owner/repo`, so
  `unwrapArchiveHref()` peels the wrapper back off before entity ids are formed. Without it every
  archived entity gets a different id from its live twin and the replay diffs against nothing.

Only server-rendered sources can be backfilled. Futurepedia's archived captures are client-rendered
shells — verified empty: 0 pricing tokens, 0 `__NEXT_DATA__`, 0 tool links.

---

## 4. Sources — `src/core/sources/`

Each adapter is a *portable extraction spec* plus a normalizer. The spec is what seeds the Scraper
Studio collector; nothing about the site is hardcoded in the engine.

```ts
export interface SourceAdapter {
  spec: ExtractionSpec;              // plain-language field descriptions → seeds `scraper create`
  expectations: SourceExpectations;  // row range, watchKeys, canaries, turnover band
  nativeId(row): string | null;      // stable key. MUST NOT identify a person.
  normalize(rows, capturedAt): NormalizedRecord[];
  oracle?(records): Promise<OracleResult>;   // independent cross-check
}
```

### The same measurement, opposite meanings

```ts
// producthunt.ts
turnover: { lo: 0.9, hi: 1.0 },  overlapWeight: 0,     // ~100% daily churn BY DESIGN
// stackshare.ts
turnover: { lo: 0.0, hi: 0.1 },  overlapWeight: 1,     // barely moves; churn is meaningful
```

Product Hunt replaces its entire front page daily. If entity overlap were a global break signal,
Product Hunt would be permanently broken and StackShare would never trip. This is why bands are
**per-source and learned**, never a hand-typed global constant.

Same reason canaries are conditional (`evidence.ts`): a pinned entity vanishing from a rotating list
is normal, so canary absence only counts where `turnover.hi <= 0.1`.

### `pick()` — and why normalization is idempotent

```ts
export function pick(row: RawRow, ...names: string[]): unknown
```

It looks in the raw row, then inside `metrics`, then inside `attributes`, matching names loosely
(case/underscore-insensitive). Two payoffs:

1. Collector output keys drift (`stars_today` → `starsToday`). That is not a break.
2. Feeding an **already-normalized** record back through `normalize()` returns the same record. That
   idempotency is what lets a captured snapshot replay through the real pipeline without a
   per-source denormalizer. It is also what makes the fixture demo *honest* — it exercises the true
   code path.

### `expectations.ts` — expectations are a property of the channel

A 2025 GitHub Trending capture carries ~15 rows where today's page carries ~25. Applying the live
`rowRange` to a replay channel marks perfectly good archived pages `broken` — precisely the false
positive this project exists to eliminate. So non-live channels widen, and once a channel has its
own healthy history, the band comes from *that* history.

---

## 5. Validation — `src/core/validate/`

Four layers, cheapest and loudest first.

### 5.1 `schema.ts` — loud breakage, no baseline needed

Row count, duplicate ranks, rank ordering, required-field coverage, url host.

```ts
// Ranks must be unique and ascending. NOT assumed contiguous: PH promotes ads, HN injects job
// rows, GH has sponsored slots — demanding 1..n makes a healthy page look broken.
```

`fieldValue()` lives here and is used everywhere: it resolves a field name against `attributes`,
then `metrics`, then the built-ins `title` / `canonicalUrl` / `rank`. This is why `requiredFields`
must name **normalized** fields (`title`) and not raw spec fields (`repo`) — a real bug, now covered
by a structural guard test in `adapters.test.ts`.

### 5.2 `freshness.ts` — transport ≠ payload

```
payload changed              → fresh
unchanged + refetched        → fresh   ("quiet source" — healthy, zero events, no alert)
unchanged + NOT refetched    → stale   (no diff, no baseline update)
```

Three lines of truth table that took two rewrites. `refetched` requires *both* the transport flag
**and** a job id different from the previous run's.

### 5.3 `baseline.ts` — learned, not declared

Rolling window over **healthy snapshots only** — never from a break, or the break becomes normal.
Produces row-count mean/σ, per-field coverage, per-field value vocabularies, and an empirical
replacement band from consecutive healthy pairs (5th–95th percentile). No hand-typed constants.

Baselines must be **signed** (`calibrate --sign`) before the source can emit. Until then, status is
`calibrating` and the gate stores without publishing — so a plausible-but-wrong first extraction can
never install itself as truth.

### 5.4 Evidence — the crown jewel

`src/core/validate/evidence.ts` exists because the rest of the validator is circular: **the same
signals that flag a break would certify its heal.** Two designs died here.

**Attempt 1 — vocabulary disjointness.** Learn each field's value set; flag when new values fall
outside it. Defeated by drift onto an *untracked sibling column*: `pricingModel` starts reading a
`deployment` chip of `{Cloud, API, Self-hosted}`. Not a subset of any tracked vocabulary, so the
open-enum rule classified it as a content change and **failed open**.

**Attempt 2 — pinned live canaries with expected values.** These would **reject the money demo**. A
genuine `Free → Paid` flip is, definitionally, a canary mismatch. The check fires hardest exactly
where the product is working.

**What survived — change breadth:**

```ts
export function changeBreadth(curr, prev, field): { breadth: number; persisting: number } {
  const p = indexBy(prev);
  let persisting = 0, changed = 0;
  for (const r of curr) {
    const before = p.get(r.entityId);
    if (!before) continue;
    persisting++;
    if (String(fieldValue(r, field) ?? "") !== String(fieldValue(before, field) ?? "")) changed++;
  }
  return { breadth: persisting === 0 ? 0 : changed / persisting, persisting };
}
```

Fourteen lines. It needs **no vocabulary at all**, and it separates the two cases by the only
property that actually differs:

| | breadth | verdict |
|---|---|---|
| one tool flips Free → Paid | 1/40 = 0.025 | content — **emit** |
| column drifts to a sibling | 40/40 = 1.00 | structure — **suppress + heal** |

Because it compares only entities present in *both* snapshots, churn cannot fake it.

Two companions in the same file:

- **`fieldConfusion(f, g)`** — row-wise agreement between field *f* now and field *g* before. Set
  overlap cannot see a *mixed* read where some rows drifted and some didn't; per-row can.
- **presence canaries** — K always-on structural slots. This is what catches a *partial* list, which
  a row-count range lets straight through.

And the canary rule is now conditional on breadth:

```ts
// A canary mismatch is only a VIOLATION when the same field moved universally. Sparse mismatch
// is exactly what a real content change looks like — that is the product, not a fault.
```

### 5.5 `index.ts` — the status decision

Signals are **hard** (unary ⇒ broken) or **soft** (need corroboration).

```ts
if (fresh.stale)                          status = "stale";
else if (!baseline?.signed)               status = "calibrating";
else if (hard.length > 0)                 status = "broken";
else if (soft.length >= 2 || escalated)   status = "broken";
else if (soft.length === 1)               status = "degraded";
else                                      status = "healthy";
```

Three things worth noticing:

**Escalation compares signal *kind*, not text.** The numbers in a message change every run, so exact
string matching would never detect persistence:

```ts
const kind = (x: string) => x.split(":")[0]!.trim();
```

This closes the "one signal, never heals" hole — an earlier "any two signals ⇒ broken" rule let a
real break that tripped exactly one signal sit in `degraded` forever.

**The row-count floor is a real bug fix.** Presence canaries cannot catch a truncated list, because
the rows that survive still carry all their fields, and a row count inside `rowRange` hides it:

```ts
const floor = baseline.rowCountMean - Math.max(2, 3 * baseline.rowCountStd);
if (n < floor) hard.push(`row count ${n} below historical floor … — truncated list`);
```

**`validate()` is pure.** It takes `priorSoftSignals` as an argument rather than querying Mongo, so
the whole classifier is unit-testable — which is why `classifier.test.ts` can assert 13 decisive
cases without a database.

### 5.6 The heal prompt

`renderHealPrompt()` distinguishes two genuinely different failures:

- **total loss** (zero rows, or every field empty) means the collector returns the **wrong shape**.
  Telling it to "re-locate the language field" is useless advice; it needs to be told to emit one
  row per list item.
- **partial loss** means specific selectors moved, and naming the *healthy* fields protects them.

It also names the fields the **collector** knows (its own spec names), not our normalized names —
the collector has never heard of `title` if its schema calls that field `repo`.

---

## 6. The gate — `src/core/gate.ts`

```
stale       → store_only    no diff, no baseline update
calibrating → store_only    emit nothing until a baseline is signed
broken      → heal          emit NOTHING, enter the saga
degraded    → quarantine    CandidateChange, never the event stream
healthy     → emit          diff against the last HEALTHY snapshot
```

Two comments carry the reasoning:

```ts
// NEVER emit. A broken extraction diffed against a healthy one produces exactly the
// full-table ENTERED/LEFT storm this project exists to suppress.
```

```ts
// `degraded` output goes to QUARANTINE, never to the event stream. An earlier draft emitted
// degraded events at confidence 0.5, which published exactly where the system was least certain —
// halving a number does not make a false ENTERED/LEFT storm true.
```

`reconcileCandidates()` runs on the next healthy snapshot: quarantined candidates that the real diff
reproduces are **discarded**, not promoted, or the same logical change reaches the stream twice under
two different event ids. Unreproduced candidates expire after `candidateTtlRuns`.

Note the comparison target: **the last healthy snapshot**, not the previous one. If a source breaks
for three runs and then recovers, you get one correct diff across the whole outage — not three
storms and a bogus recovery.

---

## 7. The diff — `src/core/diff.ts`

Nine change types. Two details worth the ink:

**Renames are matched before entries and exits.** A slug migration is one `RENAMED`, not a
disappearance plus an arrival:

```ts
const m = left.find((b) => b.canonicalUrl === a.canonicalUrl ||
                           (b.title.length > 3 && b.title.toLowerCase() === a.title.toLowerCase()));
```

**Event ids are deterministic and include the channel:**

```ts
eventId = `ev_${shortHash(canonical({ channel, source, entityId, changeType, field, from, to, toSnapshot }))}`
```

Re-running a partially-written run produces the *same* ids, so the unique index turns a retry into a
no-op instead of duplicated history. The channel is in the hash so a replay event can never collide
with a live one.

Noise floors (`rankNoiseFloor`, `metricDeltaFloors`) are per-source: a 3-star move on GitHub is
nothing; a 3-position rank move on StackShare is real.

---

## 8. The pipeline — `src/core/pipeline.ts`

The loop, ~80 lines, reading top to bottom:

```
fetch(backend) → stripPii → normalize → payloadHash
  → load previous / lastHealthy / baseline / canaries / priorRuns
  → validate()
  → build Snapshot with full provenance
  → gate()
  → saveSnapshot(snapshot + events + candidates)
  → if emitted: reconcileCandidates + recomputeBaseline
```

Every snapshot records how it was made:

```ts
provenance: { collectorId, collectorVersion, specVersion, inputUrl,
              baselineVersion, rawRef, payloadHash, transport }
```

`runId` is the retry-stable idempotency key — `capturedAt` cannot serve that purpose because it
changes on retry.

---

## 9. The heal saga — `src/core/heal/`

The ordering *is* the differentiator, and an earlier draft had it backwards.

```
0. dump template          ← BEFORE anything mutates, or there is no rollback path
1. acquire lease          ← a collector is shared MUTABLE REMOTE state
2. scraper heal <prompt>  → status: awaiting_approval + preview_result
3. preview gate           ← schema only, honestly
4. approve  |  --reject
5. full run + full evidence
6. post-verify → active | ROLLED BACK
```

**Why not `heal → run → verify → approve`?** Because `scraper heal` does **not** commit — it halts at
an approval gate returning `preview_result`. Running before approving re-runs the *unhealed*
collector, fails verification, retries, and quarantines. That loop could never once succeed.

**The preview gate is deliberately weak.** `preview_result` is a sample, not a snapshot. Breadth,
overlap and canaries are meaningless on a handful of rows, so the preview checks schema only — and
says so. That makes **rollback** the real safety mechanism, which is why step 0 exists.

**The lease.** Cron, manual runs, retries and backfill can all submit competing heals, and an
`approve` could otherwise commit another attempt's proposal. TTL'd lease + fencing token, re-checked
before every mutating step. The TTL means a dead process cannot wedge a source permanently.

**Channel safety:**

```ts
// A non-live saga must NEVER lease a live collector: channel isolation in Mongo does not
// protect shared remote state, and there is no clone command to fall back on.
```

**And the bug that shipped, then got caught.** Post-verify originally read:

```ts
const good = status === "healthy" || status === "calibrating";   // WRONG
```

`calibrating` means *"not enough history to classify yet."* It is not evidence. This let a collector
that still returned **zero rows** be marked `active`. Now:

```ts
const extractionSound = h.schemaValid && h.hardSignals.length === 0 && records.length > 0;
const good = status === "healthy" || (status === "calibrating" && extractionSound);
```

The live heal log contains both outcomes on the same collector — `active` under the old code,
`rolled_back` under the new. That pair is the single best piece of evidence in the repo, and it is
now a regression test in `classifier.test.ts`.

`admin.ts` shells out to the official `brightdata` CLI behind a `CollectorAdmin` interface (create /
heal / approve are CLI-only). It never passes `--auto-approve` — that flag surrenders the entire
verification gate.

---

## 10. Persistence — `src/core/db.ts`, `src/core/store/snapshots.ts`

**Ten collections**, **17 indexes**, every query index carrying `channel`.

Idempotency is structural, not defensive:

```ts
snapshots:    { source, channel, runId }  unique
changeEvents: { eventId }                 unique
candidates:   { eventId }                 unique
```

```ts
// Duplicate key on a retry is the DESIGNED outcome, not a failure: the unique index is what
// makes re-running a partially-written run safe.
```

`saveSnapshot()` writes an **outbox record** alongside the snapshot before committing derived rows,
so a crash mid-write leaves a replayable intent rather than a half-written history.

PII is stripped **before** storage, not on read — the README cannot claim exclusion while raw
captures still hold bylines.

`db.ts` uses a cached-global client (Vercel serverless would otherwise exhaust Atlas connection
limits) with retry on transient SRV lookup failures:

```ts
const TRANSIENT = /ESERVFAIL|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|querySrv|queryTxt/i;
```

This one is from live experience: an `ESERVFAIL` killed a script mid-run and silently caused a heal
to execute against the wrong collector. The cached promise is also cleared on failure, so one
transient error doesn't poison every later call.

---

## 11. Query and the agent — `src/core/query/`, `src/core/llm/`

`query/index.ts` holds deterministic functions: `queryEvents`, `countEvents`, `blameEntity`,
`timeline`, `sourceHealth`. They **union channels by default** — an earlier draft wrote `replay:*`
events that `timeline` and `ask` never read, making the entire backfill invisible.

`query/agent.ts` wires those *exact functions* as the agent's tools. So every natural-language answer
is reproducible by re-running a CLI command by hand. The system prompt teaches the domain rules the
data alone doesn't convey:

```
- Only "healthy" snapshots produce change events. Do not describe a broken snapshot as
  "no changes happened".
- Events carry an interval, not an instant. When gapCount > 0, say "between X and Y".
- Cite the eventId for every claim.
```

`llm/` is provider-agnostic: tools are declared once as plain JSON Schema (`ToolDef`), and each
provider owns its own loop because the SDKs genuinely differ — `betaTool()` + `toolRunner` for
Anthropic, a manual `tool_calls` loop for OpenAI. Adding a provider is one file.

One trap encoded in the type:

```ts
// NOTE: `temperature` / `top_p` / `top_k` are deliberately ABSENT. They are rejected with a 400 on
// Claude Opus 5 and Sonnet 5, so the obvious "neutral" interface that includes them would break
// Anthropic on the first call.
```

---

## 12. Measurement — `src/core/eval/`, `src/core/fixtures/`

`src/core/fixtures/mutate.ts` defines 12 labeled mutation operators split into `TUNING` and `HELD_OUT`. The
validator may be developed against tuning operators; held-out ones are never used while tuning, so
the reported number is not self-fulfilling.

The subtle part is the labeling:

```ts
// Crucially, a mutation is NOT automatically a break. Ground truth is whether the EXTRACTED records
// differ from the canonical ones — if extraction survives a DOM change, that is successful
// adaptation, and labelling it BREAK would teach the classifier the wrong thing.
```

The operators that matter most:

| operator | why it's hard |
|---|---|
| `untracked_column_swap` | drift onto a column no vocabulary covers — defeated design #1 |
| `off_by_one_alignment` | coverage stays 100%, values stay in-vocabulary, every row shifted by one |
| `truncate_list` | surviving rows are perfect; only the count is wrong |
| `single_value_flip` | the money demo — must **not** read as a break |
| `whitespace_noise` | cosmetic; must not read as a break or every re-render is an incident |
| `structure_and_content` | both at once — the case an earlier draft excluded by construction |

`eval/runner.ts` reports a **multiclass** matrix (the case set contains `STALE` and `UNKNOWN`, which
a 2×2 cannot hold) and keeps the `fixture` / `wayback` / `live-shadow` sets **separate**. Pooling
them would let a self-tuned fixture score inflate the headline.

Current output — and note the disclaimer is printed by the tool itself, not just the docs:

```
set: fixture-tuning    n=6   precision(BREAK) 1.000   recall(BREAK) 1.000
set: fixture-heldout   n=6   precision(BREAK) 1.000   recall(BREAK) 1.000

NOTE: fixture sets are a REGRESSION SUITE, not a generalization claim.
```

---

## 13. The CLI — `src/cli/`

16 commands, one file each, all `--json`-capable. `index.ts` is pure wiring.

| | |
|---|---|
| `init` `status` | bootstrap; health board |
| `collector create/list` | Scraper Studio collectors from the portable spec |
| `run <source\|all>` | the loop |
| `calibrate [--sign]` | inspect genesis extraction; sign a baseline per watch key |
| `heal [--dry-run]` | the saga |
| `backfill` | Wayback seeding |
| `eval` `fixture` | measurement |
| `log` `diff` `blame` `timeline` `summary` | git-shaped history |
| `review` | promote/discard quarantined candidates |
| `ask` | natural language |

`collector.ts` holds one scar worth knowing about:

```ts
/** Scraper Studio rejects long descriptions with "Invalid description". Measured: ~480 chars OK, 700 not. */
export const MAX_CREATE_DESCRIPTION = 500;
```

`describeForCreate()` shrinks per-field blurbs iteratively until the whole description fits, rather
than hard-slicing the composed string — slicing would clip the trailing instruction, which is the
part that stops the collector from visiting every item's detail page.

---

## 14. The web layer — `app/`

Five read-only routes over the same query functions the CLI and the agent use:
`/api/sources`, `/api/health`, `/api/events`, `/api/timeline`, `/api/entity`.

**The CLI is the runtime; Vercel only serves.** Vercel Hobby cron is capped at once per day with a
10-second function timeout — it cannot hold a scrape-and-poll cycle across six sources. GitHub
Actions is the scheduler (`.github/workflows/driftwatch.yml`).

One build-level detail in `config.ts`:

```ts
if (!process.env["NEXT_RUNTIME"] && ...) { /* load .env files */ }
```

A dynamic `resolve(process.cwd(), …)` makes Next's build tracer pull the *entire* project into the
serverless bundle. Vercel injects env vars directly, so the local-file loading is skipped there.

---

## 15. Suggested reading order

1. `src/core/types.ts` — the vocabulary
2. `src/core/validate/evidence.ts` — the idea
3. `src/core/gate.ts` — the product decision
4. `src/core/pipeline.ts` — how it's wired
5. `src/core/heal/saga.ts` — the hard part
6. `src/core/validate/classifier.test.ts` — 13 cases, each one a design that nearly shipped wrong

---

## 16. Where the bodies are buried

Failures found by adversarial review **before** any code was written:

| # | the defect |
|---|---|
| 1 | heal sequence backwards — the loop could never succeed |
| 2 | Wayback replay-heal impossible: `id_` does no rewriting, no `scraper clone` exists |
| 3 | circular verification — the classifier that flags the break certifies the heal |
| 4 | canaries would **reject** the money demo |
| 5 | vocabulary disjointness defeated by an untracked sibling column |
| 6 | `contentHash` unspecified would have zeroed the heal demo |
| 7 | `calibrating` + `--sign` circular; freshness deadlocked calibration |
| 8 | "any two signals" rule created permanent false negatives |

Failures found by **running it**:

| # | the defect |
|---|---|
| 9 | presence canaries can't catch truncation → historical row-count floor |
| 10 | Wayback `if_` rewrites hrefs → `unwrapArchiveHref()` |
| 11 | GitHub `requiredFields` named raw spec fields, not normalized ones → structural guard test |
| 12 | archived captures ~15 rows vs 25 live → channel-aware expectations |
| 13 | fixture backend reused a job id → every replay read `stale`, demo deadlocked |
| 14 | heal prompt claimed "other fields still extract correctly" when all were broken |
| 15 | **post-verify accepted `calibrating` as proof** → a zero-row collector was marked `active` |
| 16 | transient `ESERVFAIL` killed a script and pointed a heal at the wrong collector |
| 17 | Scraper Studio's undocumented description length limit |

Number 15 is the one to dwell on. It is exactly the failure mode this entire system exists to
prevent — an unfalsifiable assurance — and it got past design review, past code review, and was
caught only by the runtime. Both outcomes are in the live heal log.
