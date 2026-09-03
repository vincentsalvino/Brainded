# Phase 4 — Learning: Findings

Scoping-phase audit. No ranking behavior, memory lifecycle, or scheduler was touched to produce
this document. Every count below comes from a direct, read-only SQL query against the live
`data/brain.db` (opened `{ readonly: true }`, no migrations re-run), run this session — not from
a prior report's numbers. Every doc/code claim is cited by file and line. Where evidence is
inconclusive, that is stated instead of resolved.

---

## 1. Baseline re-verification

The task brief's "CURRENT VERIFIED BASELINE" claims were re-checked against running code, not
assumed:

| Claim | Verdict |
|---|---|
| 685/685 tests green | **Confirmed**, freshly run this session (`npm test --workspaces --if-present`, exit 0). Reconciles exactly with `PHASE_3_READINESS.md:149`'s documented 682/682: two workspaces grew since that doc was written — `@brain/gateway` 43→45, `@brain/context` 42→43 (+3 total) — matching the 3 `fix(3.4)`/`docs(3.4)` commits in `git log` after the closeout commit (dependency-seed dedup by fileId, Starvation Safety ordering-not-inclusion fix, a `recordOutcome` guard fix in the real pilot test). Full per-package table below. |
| Zero-required-network invariant | **Confirmed.** `ARCHITECTURE.md` invariant 19 (line 836), `BLUEPRINT.md` invariant 15 (line 460), `DECISIONS.md` D3, restated `PHASE_3_SPEC.md:10` and `PHASE_3_READINESS.md:165`. `packages/mcp/src/server.ts:2,231` constructs only `StdioServerTransport`. |
| Phase 3.4 mixed-context rank-collision bug, fixed and regression-tested | **Confirmed.** `PHASE_3_READINESS.md:134`: the reference unwrap loop dropped `rank` on every delivered item, colliding ranks across memory/code/dependency; fixed with `rank: w.rank` in all three unwrap pushes, closed with a dedicated regression test, part of the 685 green today. |
| Redundancy disabled by default | **Confirmed.** `PHASE_2C11_REPORT.md:190,223`: "SHOULD H2 REDUNDANCY BE ENABLED BY DEFAULT? **NO**" — a running conclusion across the 2C.x pilot series, not a single decision ID. |

Per-package test count, this session's run (`node --test`, per workspace):

| Package | Tests | vs. `PHASE_3_READINESS.md:149` |
|---|---|---|
| `@brain/codebase` | 116 | unchanged |
| `@brain/evaluation` | 72 | unchanged |
| `@brain/gateway` | 45 | **+2** |
| `@brain/knowledge` | 9 | unchanged |
| `@brain/mcp` | 20 | unchanged |
| `@brain/storage` | 112 | unchanged |
| `@brain/compression` | 7 | unchanged |
| `@brain/context` | 43 | **+1** |
| `@brain/contracts` | 86 | unchanged |
| `@brain/learning` | 3 | unchanged (still just the pass-through's own tests) |
| `@brain/memory` | 1 | unchanged |
| `@brain/ranking` | 25 | unchanged |
| `@brain/retrieval` | 63 | unchanged |
| `@brain/test-fixtures` | 51 | unchanged |
| `@brain/token` | 32 | unchanged |
| **Total** | **685** | **+3** |

`@brain/learning` still has exactly 3 tests — its own `EventService` pass-through — confirming no
aggregation/scoring code shipped since `PHASE_3_READINESS.md` was written either.

---

## 2. Event dataset — live counts

Direct SQL against `data/brain.db`. `schema_migrations`: 0001–0006 applied (0001, 0002:
2026-08-20; 0003–0005: 2026-09-01 ~02:16–05:17; 0006: 2026-09-01T13:19:27Z). **Next available
migration number is `0007`** — `BUILD_PLAN.md:268`'s "originally planned as `0006_learning`" is
stale; 0006 was consumed by Phase 3.4's `context_sources.sql`. See §13.

| Table | Rows | Notes |
|---|---|---|
| `memories` | 62 | all `status='active'` (0 archived) |
| `retrieval_events` | 145 | |
| `context_events` | 145 | exactly 1:1 with retrieval_events |
| `context_event_memories` | 826 | 638 `included=1`, 188 `included=0` |
| `context_event_sources` | **0** | table exists (migration 0006) but is empty — see §11 |
| `feedback_events` | 269 | |
| `outcome_events` | 60 | |
| `memory_mutation_events` | 62 | 1 per memory (all `create`, none `archive`/`update` recorded as separate events beyond creation) |
| `repositories` | **0** | Phase 3's codebase indexer has never run against this database |
| `code_files` / `code_chunks` | 0 / 0 | consistent with `repositories` being empty |

`memories` breakdown: `type` — decision 27, constraint 18, rule 17 (**only 3 of the 12
`MEMORY_TYPES` have ever been used** in this database; fact/pattern/procedure/experience/error/
project_state/task_state/agent_experience/preference: 0 memories each). `scope_kind` — global 4,
project 58, across **16 distinct project scope ids**.

---

## 3. Provenance: real usage vs. pilot vs. test/fixture

**Unit tests never touch this database.** Verified by grep: `packages/evaluation/src/*.test.ts`
open their own `join(dbDir, "brain.db")` under a temp directory; `packages/storage/src/db.test.ts`
and friends use `:memory:`. `data/brain.db` is written to only by whatever process actually ran
the MCP server / gateway against that literal path.

**Everything in this database is pilot or validation activity, not organic dogfooding.** Every
sampled `scope_id` and `task_id` matches one of two families:

- Phase 2C redundancy/validation pilot naming: `phase2c-pilot`, `phase2c-threshold80-pilot`,
  `phase2c-validation-pilot`, `phase2c-global-pilot`, and task ids `phase2c4-*` through
  `phase2c11-*` (`-audit-probe-`, `-live-probe-`, `-demote`, `-smoketest`, etc.) — matching
  `docs/PHASE_2C4_REPORT.md` through `PHASE_2C11_REPORT.md` exactly.
- A later synthetic 6+-microservice validation pilot: scopes `pilot-auth-service`,
  `pilot-cache-service`, `pilot-file-api`, `pilot-job-worker`, `pilot-webhook-service`,
  `pilot-notification-service`, `pilot-orders-service`, `pilot-inventory-service`,
  `pilot-document-service`, `pilot-audit-service`, with task ids `pilot-<service>-0N-<name>`
  (5 tasks each).
- `task-api` and `notes-api` (17 and 13 context events, the two busiest scopes) are themselves
  pilot fixture project names reused across the 2C series (e.g. `phase2c5-taskapi-ample`,
  `phase2c7-notesapi-b97`), not independent real projects.

The only scopes that are *not* pilot-named are `global` (1 context event) and `brain-test` (1
context event) — both single-digit smoke traces, not sustained usage.

**Timestamps confirm this is pre-Phase-3.4 data.** `memories`, `retrieval_events`,
`context_events`, `feedback_events`, and `outcome_events` all fall strictly between
`2026-08-18T15:39Z` and `2026-08-31T23:29Z`. Migration 0006 (`context_event_sources`) was applied
`2026-09-01T13:19:27Z` — **after** the last row in every one of those tables. `repositories` has
zero rows. **The entire existing feedback/outcome corpus predates Phase 3.4's code/dependency
telemetry and is memory-only by construction, not by later filtering.**

**Verdict: classify the entire feedback/outcome/context dataset as PILOT / EVALUATION
provenance.** There is effectively no REAL-USAGE (organic dogfooding) data in `data/brain.db`
today, and no TEST/FIXTURE contamination either (tests are cleanly isolated). This is the single
most important caveat for everything that follows — stated plainly per the brief's own
instruction not to blend provenance classes.

---

## 4. Feedback distribution

269 `feedback_events` total.

- `useful`: true 70 (26%), false 199 (74%), null **0** (every row in this corpus has a definite
  boolean, despite the schema allowing null).
- `reason`: null 71, `irrelevant` **193**, `redundant` 5, `incorrect` **0** (never used, in 269
  events).
- Coverage: 48/62 memories (77%) have ≥1 feedback event; 57/62 (92%) were ever delivered
  (`included=1`); all 48 labeled memories are a subset of the 57 delivered ones (no feedback ever
  references a memory that was never actually delivered).
- Repeat depth: **32 of the 48 labeled memories have >1 feedback event.** Top five by count: one
  memory has 50 events, another 45, another 37, another 34, another 5 — the rest of the >1 group
  ranges 2–4. The remaining 16 labeled memories have exactly 1 observation each.
- **Opposite feedback across tasks is real, not hypothetical:** 18 of the 48 labeled memories
  (37.5%) received both `useful=true` and `useful=false` from different feedback events. Examples:
  one memory 7 useful / 43 not-useful; another 3 useful / 42 not-useful; another 1 useful / 36
  not-useful; several others near 50/50 (2/2, 2/2, 3/1, 1/1 ×4).
- **Zero exact duplicates**: no `(memory_id, context_id)` pair appears more than once. Not
  currently happening — but nothing in the schema (`feedback_events`, migrations 0001/0002)
  prevents it; there is no `UNIQUE` constraint over that pair.
- By memory `type`: rule 188 events (27 useful / 161 not-useful — 14% useful), decision 51 (25/26
  — 49%), constraint 30 (18/12 — 60%). No feedback exists on any other type (see §2 — no other
  type has any memories at all).
- By scope kind: **global memories: 166 events, 14 useful / 152 not-useful (8% useful). Project
  memories: 103 events, 56 useful / 47 not-useful (54% useful).** A stark split — see §14.
- `context_id` present on 264/269 (98%); `task_id` present on 267/269 (99%); free-text `notes`
  present on 56/269 (21%).

---

## 5. Outcome distribution

60 `outcome_events` total. **`outcome`: success 60, failure 0, partial 0, unknown 0 — 100%,
zero variance, not merely "heavily skewed."**

`signal` breakdown (parsed from all 60 rows): `testsPassed` — true **60**, false 0, absent 0
(literally constant). `reviewScore` — present **0/60** (never populated, same as
`PHASE_2_DECISIONS.md:132`'s finding on the much smaller Phase-2 corpus — still true). `humanEdited`
— present 32/60. `notes` — present 29/60. `contextId` — present 56/60 (4 outcomes have no linked
context). All 60 have a distinct `taskId` (no task recorded twice).

`contexts_with_feedback` = `contexts_with_outcome` = `contexts_with_both` = **56, exactly equal**
— every context that received feedback also has an outcome and vice versa, out of 145 contexts
total (39% coverage either way). That precise equality, combined with `outcome`/`testsPassed`
both being unconditionally constant across 60 independent tasks over a two-week window, is
consistent with a scripted pilot harness that records a fixed success/testsPassed value as part of
its own completion routine, and records feedback+outcome together rather than at independently
arriving times. This is a reasonable inference from the shape of the data, not a provable fact —
the pilot runner scripts (`.pilot-tmp/*`) were deliberately deleted and never committed, per the
convention documented in `PHASE_2C_PILOT_REPORT.md:248`, so this can't be confirmed from source.

---

## 6. Success-skew analysis

`BUILD_PLAN.md:261-262` already flagged this, against a much smaller snapshot ("2C.11: 25/25 real
task contexts `outcome: success`"), and set an explicit precondition before scoping Phase 4 in
detail: *"Phase 3 should generate richer, more varied real coding-retrieval evidence (including
some non-trivial failure/partial outcomes)."* **That precondition is unmet today.** The corpus
grew 2.4× (25→60 outcomes) but the skew did not move at all — still 100% success, and now also
100% `testsPassed`. `PHASE_2_DECISIONS.md:374-376` (E12) independently flagged the identical gap
against a 4-outcome corpus and marked outcome's negative branch "completely uncalibrated... an
untested path." Fifteen times more outcomes later, it still is.

**Required conclusion, stated per the brief's own instruction:** this data cannot support "this
memory causes success" — there is no failure to contrast against, so no correlation computed
against `outcome` carries information. The only signal in this corpus with real variance is
**feedback** (`useful`: 70/199 split), not outcome. Any Phase 4.2 design should treat outcome as,
at most, a disabled/zero-weighted secondary signal until organic failure data exists — see
`PHASE_4_DECISIONS.md`.

---

## 7. Repeated-memory evidence

The 32 memories with >1 feedback event (§4) are the only ones for which a Beta-posterior-with-
shrinkage estimate (see `PHASE_4_DECISIONS.md` §5, adopting `PHASE_2_DECISIONS.md`'s E5) would
move meaningfully off neutral. At evidence mass 20–50 (the top handful of memories), E5's own
worked table (`PHASE_2_DECISIONS.md:186-195`) implies a shrinkage factor of 0.80–0.91 — i.e. the
signal is dominated by the observed rate, not the neutral prior, for those specific memories.
The other 16 labeled memories, at n=1, stay close to 0.5 by design — correct, safe behavior per
E13's cold-start policy, not a data gap needing a fix.

**Data-sufficiency reading:** there is real repeated-observation depth for roughly a dozen
memories, and single-observation depth for the rest. That is enough for a shrinkage-based estimator
to produce non-degenerate output on a *subset* of the corpus, and enough to run a historical replay
(`PHASE_4_SPEC.md` Layer 2) meaningfully. It is not enough, and not intended, to support a
system-wide claim that most of the 62 memories now "have a performance history" — most do not.

---

## 8. Feedback quality audit

Answering the brief's seven questions directly, against this corpus:

1. **Applied to every delivered memory, or only task-target ones?** Selective. 638
   `context_event_memories` rows have `included=1`; only 269 feedback events exist, against 57
   distinct delivered memories (not all 638 inclusions). Feedback is targeted, not blanket.
2. **Are "not useful" labels real negative evidence, or "irrelevant to this task"?** 193/199
   (97%) not-useful labels carry `reason='irrelevant'` specifically; 0/199 are `incorrect`. This is
   exactly the ambiguity the brief warns about, and it was already resolved once, in
   `PHASE_2_DECISIONS.md:396-416` (E14, **RESOLVED — APPROVED**): `reason='redundant'` feeds
   *neither* usefulness stream (routes to the redundancy model instead); `reason='irrelevant'`
   feeds the usefulness score at full tier-1 weight — i.e. E14's authors deliberately decided
   task-irrelevance *should* count as real negative usefulness evidence, not be filtered out.
   **New wrinkle E14's authors didn't have visibility into:** this corpus's `irrelevant` verdicts
   are ~100% pilot-provenance (§3), and the highest-count memories (43, 42, 36 not-useful hits)
   have task-id patterns (`phase2c11-audit-probe-*-demote`, `-live-probe-known-loss-*`) consistent
   with *deliberately seeded "known-irrelevant" distractor memories* in a precision-testing
   pilot, not organically-discovered low-value memories. Same magnitude of evidence, two different
   possible meanings. Recommendation in `PHASE_4_DECISIONS.md`: keep E14's call, re-validate once
   organic (non-pilot) feedback exists — don't overturn a reasoned decision on a hunch.
3. **Are reasons stored?** Yes — `FeedbackEvent.reason`, populated on 198/269 rows.
4. **Are duplicate feedback events possible?** Not prevented by schema (no `UNIQUE` constraint on
   `feedback_events` over `(memory_id, context_id)`); zero occur in this corpus today.
5. **Can the same memory receive opposite feedback across tasks?** Yes, empirically — 18/48
   memories (§4).
6. **Are labels agent-generated, human-generated, or mixed?** **Cannot be determined.**
   `FeedbackEventSchema` (`events.ts:147-159`) has no actor/provenance field at all — unlike
   `MemoryMutationEvent`, which carries `actor: Provenance`. This is a real contract gap, not
   something this audit can infer from data. Noted as-is, not guessed at.
7. **Is source provenance available?** Only indirectly, via `contextId`/`taskId` string-pattern
   matching (what §3 did by hand). No first-class provenance field exists on `FeedbackEvent` or
   `OutcomeEvent`.

---

## 9. Outcome semantics

Shape (`events.ts:110-137`): `OutcomeEvent { id, timestamp, taskId, sessionId, contextId,
outcome: 'success'|'failure'|'partial'|'unknown', signal: {testsPassed?, reviewScore?,
humanEdited?} | null, notes }`. There is **no `reason` field on `OutcomeEvent`** (that only exists
on `FeedbackEvent`) — the brief's question list conflates the two event types slightly; answered
per the actual `OutcomeEvent` fields above.

**Outcome is structurally context-level, never memory-level** — there is no `memoryId` field on
`OutcomeEvent`, only `contextId` (a whole delivered pack). This is why `PHASE_2_DECISIONS.md`'s E12
built a credit-dilution formula (§10) rather than attributing an outcome to one memory: a
successful task proves the context/task combination succeeded, never that every delivered memory
inside it was useful. This audit's data reinforces the point mechanically — a context typically
included several memories (826 membership rows / 145 contexts ≈ 5.7 candidates, 638/145 ≈ 4.4
included per context on average), so a single `outcome:success` is evidence diluted across ~4-5
memories, not proof about any one of them.

---

## 10. Causality boundary

Restated in this repo's own terms, grounded in this audit's numbers:

- **Feedback = item-level weak evidence.** `useful=true/false` is a human-or-agent judgement about
  one memory's contribution to one delivery. It is evidence, not ground truth (§8.2's distractor
  question shows even a repeated, consistent signal can have more than one honest reading).
- **Outcome = context-level weak evidence,** diluted across everything delivered (§9), and in this
  corpus currently carries **zero variance** (§5–6) — so today it is not just weak, it is
  uninformative, full stop.
- **Neither is causal proof.** `PHASE_2_DECISIONS.md:121-138` (E4) already set feedback as primary
  and outcome as weak/diluted/secondary, for exactly this reason, against a much smaller corpus.
  This audit's evidence does not change that ordering — if anything it strengthens it, since
  outcome's variance problem has not improved at all while feedback's has.

---

## 11. Markdown-index data-quality audit

`context_event_sources` has **zero rows** (§2) — no code or dependency item has ever been recorded
as delivered in this production database, at all, in either direction. `repositories`/`code_files`/
`code_chunks` are also empty — Phase 3's codebase indexer has never been run against
`data/brain.db`; it is validated only through isolated test/eval databases
(`packages/evaluation/src/*-self-repository.test.ts`, each opening its own temp-dir `brain.db`).

**The specific claim in this task's brief — "Phase 3.4 real pilot found that markdown/planning
docs are currently indexed as code and sometimes outrank implementation files" — could not be
corroborated.** A full-text grep of `docs/` for "markdown" (case-insensitive) matches exactly three
files: `PHASE_2C9_REPORT.md` (refers to "the fully-frozen **markdown corpus**" — a markdown-*
formatted* pilot-brief document, unrelated to code indexing), and `AUDIT_AEOS.md`/
`AUDIT_AEOS_BRAIN.md` (predecessor-system audits, unrelated to this repo's own indexer).
`PHASE_3_TASKS.md` has zero matches. Nothing in `docs/` documents markdown-as-code outranking
anything. The closest real, documented, adjacent finding is different and narrower:
`PHASE_3_READINESS.md:49` — a **self-referential test file** (not a markdown file) topped 2/5
lexical queries in the Phase 3.2 self-index demo. This audit cannot confirm whether the brief's
claim is a recollection of that finding, or an unrecorded observation from the Phase 3.4 real
pilot's own deleted `.pilot-tmp/` scratch artifacts (same never-committed convention noted in §5).
Presented honestly, not resolved either way.

**A static risk is real regardless of whether it has ever been observed:** `0003_codebase_index.sql`
puts no code/doc filter at the schema level — `code_files.language` is nullable, and any
non-ignored file the indexer walks gets chunked, `.md` included, with `language: null`. The
mechanism for the described failure mode exists; it simply has never been exercised against a real
repository in this database yet.

**Classification: NON_BLOCKING_DATA_QUALITY_RISK.** It is moot for a memory-only Phase 4.1/4.2
scope for a structural reason, independent of this specific claim's truth: `FeedbackEventSchema`
has no `chunkId`/`sourceId` field — **code and dependency deliveries are not feedback-addressable
by the current contract at all**, regardless of ranking quality. Re-open this specific audit once
(a) the indexer is ever pointed at a real repository from the live `data/brain.db`, and (b) if
learning scope is ever proposed to expand past memory.

---

## 12. Security-debt classification

Verified independently this session (not re-run via `npm audit`, which would require network
access — verified instead by direct inspection, per the brief's "re-check only enough to
classify" instruction):

- `fast-uri@^3.0.1` range required by `ajv` (`package-lock.json:823`), itself required by
  `@modelcontextprotocol/sdk@^1.30.0` (`package-lock.json:2561`).
- `qs@6.15.3` present (`package-lock.json:1855`), pulled in via `express`/`body-parser`
  (`package-lock.json:692,1209`), also under the same SDK's dependency tree.
- `packages/mcp/src/server.ts:2,231` confirms the only transport ever constructed is
  `StdioServerTransport` — the `express`-based HTTP transport that `qs`/`fast-uri` sit behind is
  present in `node_modules` but never instantiated by this application.

This matches `PHASE_3_READINESS.md:150,167` exactly: `fast-uri@3.1.5` (high, host-confusion/
SSRF-adjacent URI parsing) and `qs@6.15.3` (moderate, DoS via crafted input), both judged
non-blocking and unreachable under this application's actual stdio-only runtime, both fixable by
an `@modelcontextprotocol/sdk` version bump that was deliberately not performed, both explicitly
carried forward as disclosed debt rather than hidden.

**Classification: NON_BLOCKING_MAINTENANCE_DEBT.** Carried forward again, unchanged. Not a Phase 4
concern in either direction — it would be identical whether or not Phase 4 proceeds.

---

## 13. `BUILD_PLAN.md` staleness — corrections applied

Three verified factual contradictions between `BUILD_PLAN.md`'s Phase 4 section and shipped
reality (not judgment calls — checked against the actual repository state):

1. **Migration number.** Line 268 said "originally planned as `0006_learning`" — 0006 was consumed
   by Phase 3.4's `context_sources.sql` (applied 2026-09-01). Next available is `0007`.
2. **Package path.** Line 264 said `packages/core/src/learning/{outcomes.ts, aggregation.ts,
   promotion.ts, scheduler.ts}` — the actual shipped path is `packages/core/learning/src/` (no
   nested `src/learning`), currently holding only `service.ts`/`index.ts`.
3. **Event-shape list.** Line 258 lists `RetrievalEvent, ContextEvent, ContextEventMemory,
   FeedbackEvent, OutcomeEvent` — it omits `ContextEventSource`/`context_event_sources`/
   `EventStore.recordContextSources`, all added in Phase 3.4. Any Phase 4 aggregation design must
   be written against the current six-shape event surface, not the five it lists.

Per this task's brief ("do not modify BUILD_PLAN unless a verified contradiction requires a
documentation correction") and this repo's own precedent for this exact kind of change (E24,
`PHASE_2_DECISIONS.md:34`: "Applied to documentation only. No code behaviour changed... APPROVED
(docs only)"), these three factual corrections were applied directly to `BUILD_PLAN.md`'s Phase 4
section as a minimal, dated addendum note. No prescriptive content (data model, acceptance
criteria, risk assessment) was rewritten — that design work lives in `PHASE_4_DECISIONS.md` and
`PHASE_4_SPEC.md` instead, superseding-in-detail without erasing the original phase outline.

---

## 14. Learning-target determination (data basis for `PHASE_4_DECISIONS.md`)

Two independent lines of evidence both land on the same scope:

- **Structural:** `FeedbackEventSchema` (`events.ts:147-159`) is `memoryId`-only — there is no
  field to attach feedback to a code chunk or dependency fact. Code/dependency items are not
  feedback-addressable today, full stop, regardless of any other evidence.
- **Empirical:** `context_event_sources` has zero rows (§11) — even if the contract allowed it,
  there is no real (or pilot) delivery evidence for code/dependency items to learn from.

**Memory-only is not merely preferred, it is the only option the current contract and data
support.** See `PHASE_4_DECISIONS.md` for the formal decision record.

---

## 15. Historical replay (Layer 2), run this session

Per the brief's instruction that this scoping phase "should implement only analysis scripts/tests
if needed, not production learning," `PHASE_4_DECISIONS.md` F4's exact formula (Beta(1,1) posterior
+ shrinkage, `K=5`, `outcomeWeight=0`, `reason='redundant'` excluded from both streams) was run as
a one-off read-only script against the real 269-event corpus — not committed as product code, no
ranking touched. Per-memory `usefulCount`/`notUsefulCount` → `usefulnessSignal` → the bounded
multiplier's implied `boost` (`maxBoost=0.15`, `PHASE_4_SPEC.md` §7).

**Result: the formula behaves exactly as designed, on real data, with meaningful headroom.**

| | Count (of 48 labeled memories) |
|---|---|
| Saturated at the ±15% cap | **0** |
| Meaningful adjustment (\|boost\| > 10%) | 3 |
| Small adjustment (5–10%) | 2 |
| Negligible (≤5%) | **43** |
| Meaningfully positive (>5%) | 1 |
| Meaningfully negative (<-5%) | 4 |

The four largest movers, all negative (-9% to -12%), are **exactly the four memories already
flagged in §4/§7/§8.2 as having task-id patterns consistent with deliberately-seeded pilot
distractors** (`cb18ede2` 1u/32n, `f8ba7735` 3u/42n, `a76fdf66` 3u/31n, `05ad05de` 7u/43n). This is
not a new concern raised by the replay — it is the same concern, now shown concretely to be exactly
where the formula's output would concentrate if enabled today. It directly supports
`PHASE_4_DECISIONS.md` F14's gate: the formula is mechanically sound (cold start stays at exactly
0 boost for every `n=1` memory — the smallest observed magnitude, 0.83%, matches E5's own
`0.028 × 2 × 0.15` worked value exactly), but its largest real-corpus effects would currently land
on memories this audit cannot confidently call "bad" rather than "pilot-engineered to look bad."
That is the concrete, data-backed reason Phase 4.2 ships disabled and Phase 4.3's live/organic
pilot — not this replay — is what should gate the default.

**Not attempted here, and deliberately left to Phase 4.3 instead of a scratchpad script:**
reconstructing full per-context candidate sets to check whether any of these adjustments would have
actually *reordered* a real delivered ranking. That needs the real evaluation harness
(`packages/evaluation`'s `export.ts:exportFromEvents()`, F15) to do correctly — scope/relevance
context a one-off script would either have to duplicate or get wrong.

**2026-09-06 update — Phase 4.3 built exactly that.** `packages/evaluation/src/historical-replay.ts`
does the full, real, time-causal reorder simulation this section deferred. Result (full detail
`docs/PHASE_4_3_REPORT.md`): 63/145 contexts exactly replayable, 9 rank-only reorders, **0**
context-impacting reorders, **0** harmful reorders, **0** cold-start reorders. New evidentiary
finding from building it: 69 of 145 contexts fail exact reconstruction because `normalizeScores`
(E2) normalizes per-query *relative to the returned candidate set*, and retrospective
reconstruction's search limit differs from production's original pool size — a real limitation of
replaying history from stored data, not a claim that production's original ranking was wrong.
