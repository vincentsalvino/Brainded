# Phase 2C.8 — Organic Breadth Validation

## STATUS

Complete. Zero production source files touched (`git status` shows only this
report plus the untracked 2C.4–2C.7 reports; `packages/mcp/src/bootstrap.ts`
still ships `{ enabled: false, ...DEFAULT_NEAR_DUPLICATE_POLICY }`). All work
done through the same direct-Gateway temp script pattern as 2C.7
(`.pilot-tmp/`, deleted at cleanup — MCP `brain_*` tools stayed disconnected
all session). Rule H itself (production code, committed in 2C.7) was not
modified, tuned, or redesigned.

**Headline finding:** organic usage across 5 new projects and 25 real tasks
produced only **2 new organic near-duplicate pairs** (target: ≥5) spanning
**2 projects** (target: ≥3), and surfaced **2 confirmed Rule H false
positives**, both proven context-impacting under realistic budget pressure
(target: 0). Decision gate is **NO**.

## NEW PROJECTS

5 independent scopes, none reused from prior phases:

| Project | Domain |
|---|---|
| `pilot-auth-service` | registration/login, scrypt password hashing, HMAC session tokens, auth middleware |
| `pilot-cache-service` | cache-aside pattern, TTL expiry, invalidation, failure fallback |
| `pilot-job-worker` | sequential queue worker, retry with attempt cap, idempotency, dead-letter queue |
| `pilot-file-api` | upload validation, streaming upload with mid-stream abort, metadata store |
| `pilot-webhook-service` | HMAC signature verification, delivery with exponential backoff, event dedup |

## CODING TASKS

25 total, 5 per project (within the "~4–6 per project" band, ≥20 total).
Each was a real implementation task: files written, tests written first
(TDD), `node --test` run and watched pass. Representative spread — not the
illustrative example lists verbatim, actual code written and tested:

- auth: registration, login, auth middleware, refresh-token rotation, error translation
- cache: cache-aside read path, TTL expiry, explicit invalidation, boundary/edge cases, backend-failure fallback
- job-worker: sequential consumer, retry-with-cap, idempotency (dedup key), dead-letter queue, structured logging
- file-api: upload validation (size/type), metadata persistence, streaming upload abort, route size limits, error translation
- webhook: signature verify/sign, event persistence, retrying delivery, delivery idempotency, delivery status log

All 25 tasks: tests green at time of task (55 total test cases across the 5
services, confirmed passing during the pilot). One incidental bug found and
fixed on its merits (`pilot-file-api/route-limits.test.js` hung on a `fetch`
call that couldn't fake a mismatched `Content-Length`; rewritten to send a
real oversized body — unrelated to redundancy, a genuine test correctness
issue caught by doing real work).

## NATURAL MEMORY ACCUMULATION

21 new project-scoped memories written via ordinary `remember` calls during
the 25 tasks (not 1:1 — several tasks produced no memory when there was no
new decision worth recording, e.g. a task that only applied an
already-recorded contract). 0 new global memories were written this phase.
Per-project: auth 3, cache 4, job-worker 5, file-api 4, webhook 5.

No memory was authored to resemble another. Overlap, where it occurred, was
a side effect of two related design decisions in the same small service
naturally sharing vocabulary (e.g. two rules both about the same
`CacheAsideItemService`) — not an engineered duplicate.

## CANDIDATE PAIRS ≥0.75

125 scope-valid pairs total in the corpus (within-project, project↔global,
global↔global; cross-project pairs excluded as never co-occurring in a real
candidate set). **12 pairs at cosine ≥0.75**, all inspected — not only the
ones Rule H accepted.

Provenance check (via `source_origin`/`created_at`) found **1 of the 12 is
historical**: `a76fdf66~cb18ede2` (global↔global, cosine 0.9996) — `a76fdf66`
was seeded in the 2C.4 pilot (2026-08-23, `source_task_id:
phase2c-pilot-seed`) and `cb18ede2` predates this entire evaluation project
(2026-08-18, `source_origin: system`). This pair is carried forward, not new
evidence, and is reported separately (see HISTORICAL VS NEW EVIDENCE). The
other **11 pairs are genuinely new**, all created 2026-08-28/29 during this
phase's task work, `source_origin: system` (organic, not agent-seeded).

## LABELING METHOD

Each of the 12 pairs was read and labeled NEAR_DUPLICATE / DISTINCT /
AMBIGUOUS from content alone, before running `isNearDuplicate` against it.
Labels were frozen into `.pilot-tmp/rule-h-verdicts.mjs` as a literal map
keyed by id pair, then the real production classifier (imported from
`@brain/retrieval`, not reimplemented) was run against the frozen labels in
one pass. No label was revised after seeing Rule H's output.

## ORGANIC NEAR-DUPLICATES

**2 new organic NEAR_DUPLICATE pairs**, both correctly detected (TP):

| Pair | Project | Cosine | Content |
|---|---|---|---|
| `be174a56~ce0fa075` | pilot-file-api | 0.8428 | Two upload-validation rules about the same size/type constraint, one an elaboration of the other |
| `e104c851~f4ebe0ae` | pilot-cache-service | 0.8016 | Two cache-aside rules — "cache is not source of truth, go through the service" vs. "cache errors degrade to a direct repository fetch" — judged genuinely overlapping on content review |

Both above 0.80, so both were caught by the unconditional cosine branch;
neither needed containment corroboration to be correctly classified.

Per the phase's own instruction — "if normal usage fails to produce five,
report the actual number" — the actual number is **2**, not 5, spanning 2
projects, not 3. This is reported as-is, not padded.

## BORDERLINE DISTINCT PAIRS

**6 new confirmed-DISTINCT pairs at cosine ≥0.75**, all correctly rejected
by Rule H (TN):

| Pair | Project | Cosine |
|---|---|---|
| `2f7e5e5e~44d5253f` | pilot-webhook-service | 0.7903 |
| `909d5511~e104c851` | pilot-cache-service | 0.7775 |
| `4a455e8d~a05fb864` | pilot-auth-service | 0.7679 |
| `5b880968~babb1073` | pilot-job-worker | 0.7646 |
| `0062a433~a05fb864` | pilot-auth-service | 0.7642 |
| `7bf3c5d9~ce0fa075` | pilot-file-api | 0.7588 |

All 6 sit below 0.80 and below the 0.40 containment bar, so Rule H correctly
falls through to DISTINCT. This is the classifier working as designed.

## AMBIGUOUS PAIRS

**1 pair**, excluded from TP/FP/FN scoring per phase rules:

- `7bf3c5d9~be174a56` (pilot-file-api, cosine 0.8496) — two upload-related
  rules close enough in wording that content-only review could not
  confidently call NEAR_DUPLICATE vs. DISTINCT. Reported for completeness:
  Rule H predicted NEAR_DUPLICATE (cosine alone crossed 0.80). Not counted
  in any TP/FP/FN total below.

## RULE H TRUE/FALSE POSITIVES/NEGATIVES

New pairs only (11, excludes the 1 historical pair):

| | Count |
|---|---|
| TP | 2 |
| FP | **2** |
| TN | 6 |
| FN | 0 |
| Ambiguous (excluded) | 1 |

All-pairs total (11 new + 1 historical), matching the raw classifier run:
TP=3, FP=2, TN=6, FN=0, ambiguous=1.

**Both false positives crossed cosine ≥0.80** — the unconditional-duplicate
branch — so containment was never consulted for either. This is not a
containment-corroboration failure; it is the plain-cosine branch of Rule H
misfiring on two pairs that a content read calls clearly distinct:

- `909d5511~f4ebe0ae` (pilot-cache-service, cosine 0.8813): "cache backend
  throws → degrade to direct repository fetch" vs. "cache is never the
  source of truth, always go through the service" — related but describing
  different failure/architecture concerns, not the same fact restated.
- `05fede4b~5b880968` (pilot-job-worker, cosine 0.8380): "retry up to 3
  attempts, no backoff" vs. "exhausted-retry jobs go to a dead-letter queue,
  never silently dropped" — the retry policy and the DLQ policy are
  different, complementary facts about the same worker, not duplicates.

## CONTEXT IMPACT

Both confirmed FPs were checked against real `getContext` calls, disabled
vs. Rule H enabled, same candidates/task/budget (`.pilot-tmp/brain.mjs`
`context` command, `HYBRID` vs. `DISABLED` policy constants).

**pilot-job-worker, tight budget (80 tok, contextId
`2575fee5-6605-48b6-8866-45d51155bcbe`):**

| | candidateTokens | deliveredTokens | delivered | omitted |
|---|---|---|---|---|
| Rule H enabled | 467 | 70 | 1 | 8 |

Only `5b880968` (DLQ fact, 70 tok) delivered. `05fede4b` (retry-policy fact,
61 tok uncompressed) is fully omitted — ranked below the redundancy floor
because Rule H flagged it as `redundantWith: 5b880968`. Under a disabled
policy at the same budget, `05fede4b` is a genuinely distinct, useful fact
with no redundancy demotion and would compete for the slot on rank alone.
**This is a confirmed context-impacting false positive**: a real, distinct
piece of knowledge was dropped from delivery because of the misclassification.

**pilot-cache-service, ample budget (1000 tok, contextId
`8e687227-4f3e-4ead-8df6-597b4c15c58f`):** both `909d5511` and `f4ebe0ae`
delivered (redundancy demotes priority, not presence, when budget is not
constrained) — `909d5511` and a third pair member `e104c851` both flagged
`redundantWith: f4ebe0ae`.

**pilot-cache-service, tight budget (50 tok, contextId
`cdbc4571-f680-44a2-941e-0f340db2ebd4`):**

| | candidateTokens | deliveredTokens | delivered | omitted |
|---|---|---|---|---|
| Rule H enabled | 375 | 50 | 2 | 6 |

`909d5511` (55 tok uncompressed) is fully omitted — one of the 6 omitted
items, no rank assigned. `f4ebe0ae` survives at rank 1 but **compressed**
to 20 tok (from 69 tok uncompressed, content truncated mid-sentence:
`"...the cache is always populat[truncated]"`). **This confirms the same
context-impacting pattern found in job-worker**: the distinct
degrade-on-failure fact (`909d5511`) lost its budget slot entirely because
Rule H's plain-cosine branch misclassified it as redundant with `f4ebe0ae`.

Distinguishing classification FP from context-impacting FP, as the phase
requires: **both of the 2 confirmed classification FPs are also confirmed
context-impacting FPs** under realistic tight-budget conditions — the more
severe category. This is not a theoretical scoring artifact; real, distinct,
previously-useful knowledge was measurably dropped or degraded from a real
delivered context in both cases.

## COMPRESSION OBSERVATIONS

Two live compression events this phase (both on the cache-service FP pair,
50-tok probe):

| Memory | Original tokens | Delivered tokens | Still adds info? | Blocked another memory? |
|---|---|---|---|---|
| `f4ebe0ae` | 69 | 20 (`wasCompressed: true`) | Partial — truncated mid-sentence, loses the "Callers must go through CacheAsideItemService" clause | No — it was rank 1, nothing else competed for its slot |
| — | — | — | — | `909d5511` (55 tok) never reached compression; it was omitted outright, not demoted-then-compressed |

Consistent with 2C.7's first observed compression event: compression is
rare, applies to the highest-ranked survivor when it doesn't fit whole, and
is a separate fate from the omission that redundancy-demotion causes for
lower-ranked demoted items. We are reporting this behavior, not redesigning
optimization.

## PROJECT-BY-PROJECT RESULTS

| Project | Memories | Tasks | Pairs ≥0.75 | Confirmed near-dup | Confirmed distinct | Ambiguous | TP | FP | FN |
|---|---|---|---|---|---|---|---|---|---|
| pilot-auth-service | 3 | 5 | 2 | 0 | 2 | 0 | 0 | 0 | 0 |
| pilot-cache-service | 4 | 5 | 3 | 1 | 1 | 0 | 1 | 1 | 0 |
| pilot-job-worker | 5 | 5 | 2 | 0 | 1 | 0 | 0 | 1 | 0 |
| pilot-file-api | 4 | 5 | 3 | 1 | 1 | 1 | 1 | 0 | 0 |
| pilot-webhook-service | 5 | 5 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |

## AGGREGATE RESULTS

- Projects: 5 new, independent
- Tasks: 25 real, all tests green
- New memories: 21 (project-scoped only)
- Scope-valid candidate pairs ≥0.75: 12 total (11 new + 1 historical)
- New organic near-duplicates: **2**, spanning **2** projects
- New confirmed-distinct borderline pairs: 6, spanning 5 projects
- New ambiguous: 1
- New Rule H: TP 2, **FP 2**, TN 6, FN 0
- Confirmed FPs that are also context-impacting: **2 of 2**

## HISTORICAL VS NEW EVIDENCE

Kept strictly separate, not blended into the breadth numbers above:

| | Historical (pre-2C.8) | New (this phase) |
|---|---|---|
| Source | 2C.4/2C.5 task-api/notes-api pilot + the one carried-forward global pair (`a76fdf66~cb18ede2`, seeded 2026-08-23/predates 2026-08-18) | 5 new projects, 2026-08-28/29 |
| Near-dup pairs | 1 (TP) | 2 (TP) |
| False positives | 0 (from 2C.4/2C.7 live pilots) | **2** |

The historical record (2C.4 real-pilot: 1/1 correct; 2C.7 live validation:
33/33 regression match, 0 FP live) remains valid and unchanged by this
phase — 2C.8 did not re-test or invalidate it. But it also does not offset
the 2 new false positives found here; they are a new, independent finding
from broader exposure that the earlier narrower pilots did not surface.

## EVENT CORRELATION

Verified directly against `data/brain.db` (SQL, not the wrapper script) for
this phase's `task_id`s:

- context_events: 28 (25 real-task contexts + 3 FP-audit measurement probes)
- feedback_events: 100 (70 not-useful, 30 useful — reflects that most
  candidates in a populated context are correctly-ranked non-target items,
  not a redundancy artifact)
- outcome_events: 25, **all 25 = success**, one-to-one with the 25 real
  task contexts by `context_id`
- The 3 audit-only probes correctly have **no** outcome event (they were
  re-queries for measurement, not task completions) — confirmed by
  explicit per-context lookup, not just a count difference

Sampled 4 full chains (ContextEvent → context_event_memories →
Feedback/Outcome) end to end, including the two audit probes central to the
FP finding:

| contextId | stored tokenCount | Σ(included item tokenCount) | match |
|---|---|---|---|
| `1aedc87e` (auth task 1) | 144 | 144 | exact |
| `61737b2d` (job-worker task 5) | 396 | 396 | exact |
| `2575fee5` (job-worker FP probe, tight) | 70 | 70 | exact |
| `cdbc4571` (cache FP probe, tight) | 50 | 50 | exact |

All 4 exact. No accounting drift between what a context claims and what its
line items sum to.

## TOKEN ACCOUNTING

- `candidateTokenCount` vs `tokenCount` diverges only on the 2 constrained
  FP-audit probes (467→70, 375→50) and matches exactly (`candidateCount ==
  includedCount`, 0 omitted) on all 25 real, unconstrained-relative-to-corpus
  task contexts — redundancy demotion had no visible effect during ordinary
  task work because the corpus was too small early on and budgets were not
  artificially tight; the effect only becomes visible once probed
  deliberately at a realistic tight budget, which is what the FP audit did.
- Compression changes delivered tokens for the one compressed item
  (`f4ebe0ae`: 69→20) without breaking the stored-vs-summed invariant.

## FEEDBACK COVERAGE

100 feedback events across 28 contexts (25 task contexts + 3 audit probes,
all of which also received `feedback` calls in this phase's script pattern).
70/100 marked not-useful, 30/100 marked useful — feedback was recorded
per-delivered-memory as instructed, not only for the memory the task
happened to be "about."

## OUTCOME COVERAGE

25/25 real task contexts have exactly one outcome event, `outcome: success`
in all 25 cases. labeledFraction (task contexts with both feedback and
outcome) = 25/25 = **100%**. The 3 audit-only probes intentionally have no
outcome (not task completions) and are excluded from this fraction by
design, not by gap.

## ORGANIC BREADTH SUFFICIENT? **NO**

Against the phase's own stated minimum bar:

| Requirement | Bar | Actual | Met? |
|---|---|---|---|
| Independent new projects | ≥3 | 5 | yes |
| Genuine tasks | ≥20 | 25 | yes |
| New organic near-dup pairs | ≥5 | 2 | **no** |
| Spanning projects | ≥3 | 2 | **no** |
| Every ≥0.75 pair reviewed | required | 12/12 | yes |
| Confirmed Rule H false-positive demotions | 0 | **2** | **no** |
| Isolation/ranking/event/token regression | none | none found | yes |

Three of seven conditions fail, one of them (zero FPs) explicitly called out
in the phase brief as the highest-priority condition. Per the phase's own
instruction — "if the corpus simply does not naturally generate five
positives, answer NO rather than manufacturing evidence" — the answer is
NO, stated plainly.

## SHOULD HYBRID REDUNDANCY BE ENABLED BY DEFAULT? **NO — do not enable**

The gate required BOTH the 2C.7 live validation remaining valid AND this
phase demonstrating breadth. The first condition holds (2C.7's 33/33
regression match and live floor-invariant proof are untouched by this
phase). The second condition does not — and this phase additionally
produced new, direct evidence of harm: 2 confirmed false positives, both
proven to drop or degrade genuinely distinct, useful knowledge under
realistic tight-budget delivery. That is stronger than "not enough
evidence" — it is an observed failure mode the earlier, narrower pilots
(2C.4, 2C.7) did not have enough surface area to find. The most honest
verdict is **NO**, not the softer NOT ENOUGH EVIDENCE, because the evidence
that does exist points against enabling, not merely toward "need more data."
`bootstrap.ts` remains `{ enabled: false, ...DEFAULT_NEAR_DUPLICATE_POLICY }`
and should stay that way pending investigation of the ≥0.80 cosine branch's
false-positive rate specifically (see RECOMMENDED NEXT STEP).

## LEARNING READINESS

- Correlated feedback+outcome events available: 100 feedback / 25 outcome,
  100% of task contexts have both
- Projects represented: 5 new + historical
- Positive/negative feedback distribution: 30 useful / 70 not-useful (not
  balanced, but not required to be for readiness — the question is
  correlation coverage, which is complete)
- **Verdict: NOT READY.** Coverage is complete but volume is still small
  (25 task-level outcomes total across this phase), and — per every prior
  phase — no learning implementation exists or was attempted. This phase
  did not implement, prototype, or scaffold learning in any form.

## TEST COUNTS

Full verification run this phase (after cleanup, before report):

- `npm run typecheck`: clean, all 8 typechecked packages
- `npm run build`: clean, all 10 built packages
- `npm test`: **386/386 passing**, 0 failing (evaluation 64, gateway 33,
  knowledge 9, mcp 20, storage 51, compression 7, context 29, contracts 53,
  learning 2, memory 1, ranking 23, retrieval 45, test-fixtures 23, token 26)
- `npm audit`: 0 vulnerabilities
- `packages/storage` `test:integration`: 3/3 passing
- `packages/evaluation` `test:integration`: 2/2 passing (2C.2/2C.3 plain-cosine
  threshold sweep, unaffected by this phase — no production code changed)

No test was added, removed, or modified this phase (2C.8 is evaluation-only;
Rule H's own unit/regression tests are unchanged from 2C.7).

## RISKS

- **Confirmed, not hypothetical**: the ≥0.80 unconditional-cosine branch of
  Rule H has a real false-positive rate on organic content (2 of 5 pairs
  ≥0.80 in this phase's new data were false positives: `909d5511~f4ebe0ae`
  0.8813, `05fede4b~5b880968` 0.8380 — vs. 2 true positives at 0.8428 and
  above-0.80-implicit historical 0.9996). The containment corroboration path
  (built specifically for the [0.75, 0.80) band) never even gets a chance to
  veto these, because they clear 0.80 on cosine alone.
- Small sample: 2 FP out of 5 new ≥0.80 pairs is not a stable rate estimate
  by itself, but it is 2 more confirmed, context-impacting false positives
  than every earlier live pilot combined found (2C.4: 0, 2C.7 live: 0).
- The one AMBIGUOUS pair also crossed 0.80 and got an unconditional
  NEAR_DUPLICATE prediction — a content-review-uncertain case defaulting to
  "duplicate" is a soft risk signal in the same direction, even though it's
  excluded from the formal FP count.
- No isolation, ranking, event-correlation, or token-accounting regression
  was found anywhere in this phase — the risk is specifically and only in
  Rule H's classification behavior at the top of the cosine range, not in
  the surrounding pipeline.

## RECOMMENDED NEXT STEP

Do not enable by default. Investigate the ≥0.80 branch specifically: pull
every historical and this-phase pair with cosine ≥0.80 (5 total: 1 TP
historical, 2 TP new, 2 FP new) and check whether containment (already
computed, just not consulted above 0.80 by design) would have correctly
separated the 2 FPs from the 3 TPs — i.e., whether the fix is only to stop
treating 0.80+ as an unconditional bypass and instead run containment
corroboration across the full candidate-floor range, not just [0.75, 0.80).
That is a threshold/design change and is explicitly out of scope for this
phase (no tuning, no redesign) — it is future work, not something done
here. If pursued, it should go through the same offline-corroboration →
production-implementation → live-pilot → organic-breadth sequence already
established (2C.6 → 2C.7 → 2C.8's own methodology), against a freshly
collected, larger set of ≥0.80 organic pairs before any default-enable
reconsideration.
