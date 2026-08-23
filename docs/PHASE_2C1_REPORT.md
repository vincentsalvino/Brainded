# Phase 2C.1 Report — Scope-Aware Redundancy Preference

Companion to `docs/PHASE_2C_PILOT_REPORT.md`, which surfaced the defect this task fixes. Built with
TDD throughout: every production change below has a test that was written first, watched to fail for
the right reason, then made to pass — see `ROOT CAUSE` for where that discipline caught a second,
unanticipated bug.

## PHASE 2C.1 STATUS

Complete. Two production files changed (both in `core`, neither in `storage` or `ranking`), five test
files/fixtures added to or extended, 6 new tests, all passing. Full monorepo verification green.
Redundancy remains disabled by default — this task changes redundancy-cluster *policy*, not whether
redundancy runs.

## ROOT CAUSE

Two bugs, not one — the second was found only because a real end-to-end test was required, not
inferred from the pure-function fix alone.

**Bug 1 (the one the brief named).** `toRedundancyPairs()` (`packages/core/retrieval/src/redundancy.ts`)
oriented every similarity-flagged pair purely by `RankedResult.rank`: the better-ranked side always
became the anchor (`a`), the worse-ranked side was always demoted (`b`). A project-specific memory
redundant with a global near-duplicate that happened to rank worse (real case:
`docs/PHASE_2C_PILOT_REPORT.md`'s pilot — a task phrased around "endpoint" singular matched the
global memory's wording better than the project memory's "endpoints" plural) was demoted instead of
anchoring.

**Bug 2 (found by the real-pilot-recreation test, not anticipated by the brief).** Fixing Bug 1 alone
made `toRedundancyPairs()` return the correct orientation (verified directly — see below) but the new
end-to-end test *still failed*: `compileContext()` (`packages/core/context/src/compiler.ts`) silently
dropped the redundancy mark. Its dedup-survivorship set (`keptMemoryIds`, now `survivingMemoryIds`)
was built *incrementally*, in the same single pass that emits items, then consulted to decide whether
a pair's anchor (`a`) "really exists" in the output. This silently assumed `a` is always visited
before `b` — true under Bug 1's rank-only orientation (rank order = visit order, and `a`'s rank is
always ≤ `b`'s), false the moment a more scope-specific `a` can rank *worse* than the `b` it anchors.
When `a` hadn't been visited yet, `keptMemoryIds.has(a)` read false for a reason unrelated to its
actual comment ("if... dropped by content-dedup") — not dedup, just iteration order — and the
demotion was silently suppressed.

Confirmed directly, not inferred: a throwaway diagnostic script run against the real fix reproduced
exactly this — `getRedundancyPairs()` returned the correctly-oriented pair
(`project-naming-rule → global-naming-rule`, similarity 0.785 under `FakeEmbeddingProvider`), but
`compileContext()`'s output carried no `redundantWith` on either item. Both bugs are fixed; the
`REAL PILOT REGRESSION` test (below) is green only because both are.

## POLICY CHANGE

`packages/core/retrieval/src/redundancy.ts`:

```ts
const SCOPE_SPECIFICITY: Record<ScopeKind, number> = { global: 0, project: 1, session: 2 };
```

For a similarity-flagged pair: if the two sides differ in scope specificity, the more specific side
anchors (`a`), **regardless of rank**. If they are the same specificity, rank decides — byte-identical
to pre-2C.1 behavior in that case (both the existing 4 tests and the 2 new same-specificity tests
confirm this). `session` was included for completeness (mirrors `scopeIncludes()`'s own
global-least/session-most-specific shape) though no test exercises it — not asked for, not
special-cased differently from `project`, just falls out of one small ordering table rather than a
project/global-only special case.

`packages/core/context/src/compiler.ts`: `survivingMemoryIds` is now computed in a dedicated pre-pass
over the full `rankedResults` list, before the main loop runs, so the redundancy guard no longer
depends on iteration order. This is a correctness fix to existing dedup bookkeeping, not a new policy
— the actual anchor-preference decision lives entirely in `redundancy.ts`, exactly where the brief
asked for it.

Nothing else changed. `rank()`, `computeScore()`, `packages/core/ranking` in general, `packages/core/token`
(the optimizer), and scope authorization (`scopeIncludes()`, `scopeWhere()`/`whereClauses()` in
`retrieval-store.ts`) are untouched — confirmed by `git diff --stat` below naming only `core/context`
and `core/retrieval` files, and by the full existing test suite (ranking: 23/23, token: 26/26, storage:
51/51, all unmodified) staying green.

## FILES CHANGED

```
 packages/core/context/src/compiler.test.ts         | 19 ++++++++
 packages/core/context/src/compiler.ts              | 32 +++++++++---
 packages/core/retrieval/src/redundancy.test.ts      | 57 ++++++++++++++++++++--
 packages/core/retrieval/src/redundancy.ts           | 45 ++++++++++++-----
 packages/evaluation/datasets/phase1-realworld.jsonl |  1 +
 packages/evaluation/src/redundancy-gate.test.ts     | 44 +++++++++++++++++
 6 files changed, 176 insertions(+), 22 deletions(-)
```

Two production files (`compiler.ts`, `redundancy.ts`); the rest is tests and one new dataset fixture
row. `packages/mcp/src/bootstrap.ts` and `packages/gateway/src/gateway.ts` (the redundancy
enable/disable switch) are not in this diff at all.

## PROJECT-VS-GLOBAL REGRESSION

Four new pure unit tests, `packages/core/retrieval/src/redundancy.test.ts` (no database, no embedding
provider — hand-built `RankedResult`s, fully deterministic):

1. **"global ranks higher, project still becomes the anchor"** — the brief's own exact fixture
   (global rank=1, project rank=3, similarity 0.8). Asserts orientation `a=project, b=global`, **and**
   asserts `globalMem.rank === 1` / `projectMem.rank === 3` unchanged after the call — proving this is
   redundancy-cluster policy, not a ranking change. PASS (was RED before the fix — actual output was
   `a=global, b=project`, confirmed by running it against the unfixed code first).
2. **"project already ranks higher, project remains anchor"** — sanity check that the new logic
   doesn't disturb the already-correct case. PASS (was already green even before the fix, as expected).

## GLOBAL-ONLY REGRESSION

Not a new test — the brief's own case ("no project equivalent exists") has no redundant pair to
re-anchor at all, so this fix has no code path that touches it. Covered by two existing,
**unmodified** tests, both re-run green in this task's fresh full suite:

- `packages/evaluation/src/gate.test.ts`: `"P2-009: A' does not win by demoting global knowledge"`
- `packages/evaluation/src/redundancy-gate.test.ts`: `"global memory regression: task-api-convention-check still ranks the global rule first under C'"`

No rule equivalent to "project always beats global" was introduced — the policy only ever chooses an
anchor *within an already-detected redundant pair*; it cannot manufacture a preference where no
redundancy was found.

## SAME-SCOPE REDUNDANCY RESULT

Two new pure unit tests (`redundancy.test.ts`): global-vs-global and project-vs-project, both
asserting rank alone still decides the anchor when scope specificity is equal. Both PASS.

## CONSTRAINED-BUDGET RESULT

New test, `packages/evaluation/src/redundancy-gate.test.ts`, **"REAL PILOT REGRESSION"** — recreates
`docs/PHASE_2C_PILOT_REPORT.md`'s exact fixture: the same three memory contents (project naming rule,
project repository constraint, global naming rule) and the exact same task text, added as a new
dataset example `phase2c-pilot-redundancy-regression` in `phase1-realworld.jsonl`. Under
`FakeEmbeddingProvider` the global/project naming-rule pair measures similarity 0.785 (well above the
0.45 test threshold) and ranks global(1) > global-repo-constraint... i.e. `project-repo-constraint(1)
> global-naming-rule(2) > project-naming-rule(3)` — the project rule genuinely ranks last, same shape
as the real pilot. At a tight budget (project-naming-rule's cost + repo-constraint's cost, fitting
exactly those two): **project naming rule survives, repository constraint survives, the redundant
global naming rule is demoted and omitted.** This is the literal expectation the real pilot failed;
this test hardcodes and proves it now holds. PASS.

## AMPLE-BUDGET RESULT

Same test, second half: budget = tight + the demoted global rule's own cost + margin →
**the demoted global rule reappears.** Demoted ≠ deleted still holds under the new policy. PASS.

## SCOPE ISOLATION

Structurally unaffected: `toRedundancyPairs()` and `compileContext()` only ever consume the
`rankedResults` array they are given, which is already the output of scope-filtered
retrieval — neither function has a parameter or code path that could introduce a candidate scope
authorization did not already admit. Confirmed empirically, not just structurally: every isolation
test in the full suite re-ran green in this task's fresh run --
`packages/storage`'s `"scope isolation is enforced at the storage-query layer"` and
`"query never returns another scope's rows (adversarial near-identical content)"`,
`packages/core/retrieval`'s `"scope isolation: near-identical content in a different project is never retrieved"`,
`packages/gateway`'s `"scope isolation survives the gateway"` (×2) and
`"concurrency: overlapping getContext calls under different scopes never leak state"`,
`packages/mcp`'s `"scope isolation holds through the full MCP path"`,
`packages/evaluation`'s `"P2-009: scope isolation holds under both strategies"` — none of these were
modified by this task; all still pass.

## A′ RANKING REGRESSION

`"C' ranking metrics do not materially regress vs A' -- same top-ranked key on every seed example"`
still passes, unmodified. Worth stating precisely rather than hand-waved: this fix *can*, in
principle, change which item is presented first. If the overall rank-1 item is the *less* specific
side of a redundant pair with a worse-ranked, more-specific partner, rank-1 now gets demoted to the
back of the list — but the new front-of-list item is whichever *actually non-redundant* item has the
best rank among the survivors, not automatically the promoted anchor (`compileContext` preserves rank
order **within** each of the non-redundant/redundant groups; it does not re-sort by anchor status).
This scenario did not arise in the existing seed dataset (confirmed by the still-passing test) or in
the new `phase2c-pilot-redundancy-regression` fixture (the distinct repository constraint, unrelated
to the redundant pair, was rank 1 throughout and stayed first). Not observed broken; flagged under
`RISKS` as a real, non-obvious consequence worth knowing about.

## TEST COUNTS

| Point | Suite | Tests |
|---|---|---|
| Start of this task (Phase 2C pilot's own fresh run) | full monorepo | 351 |
| **End of this task, fresh `npm test` run** | full monorepo | **357** |

+6 exactly: 4 in `redundancy.test.ts`, 1 in `compiler.test.ts`, 1 in `redundancy-gate.test.ts`. Per
workspace (this task's fresh run): evaluation 50, gateway 33, knowledge 9, mcp 20, storage 51,
compression 7, **context 29** (was 28), contracts 53, learning 2, memory 1, ranking 23,
**retrieval 30** (was 26), test-fixtures 23, token 26.

## COMMANDS

```
npm run typecheck
npm run build
npm test
npm audit
```

Then, separately: `cd packages/storage && npm run test:integration`.

## RESULT

All fresh-run, all green, captured directly in this session:

- `npm run typecheck` — PASS, 0 errors, all 14 workspaces.
- `npm run build` — PASS, 0 errors.
- `npm test` — **357/357 passing, 0 failing**, 14 workspace suites.
- `npm audit` — **0 vulnerabilities.**
- `packages/storage`'s `npm run test:integration` — **3/3 passing**, real-model similarity values
  unchanged from `docs/PHASE_2C_PILOT_REPORT.md`: known-redundant 0.804, distinct pairs 0.542 and
  0.367 — confirms this task did not touch anything the real-model measurement depends on.
- `git status` before this task's edits and after this run: only the 6 files in `FILES CHANGED` plus
  the untracked `docs/PHASE_2C_PILOT_REPORT.md` from the prior task. Redundancy's `enabled` flag in
  `packages/mcp/src/bootstrap.ts` is untouched (still `false`) — confirmed by its absence from the
  diff, not merely by not having edited it on purpose.

## RISKS

- **Rank-1 demotion, described precisely under `A′ RANKING REGRESSION` above**: not observed broken
  anywhere in the current suite, but a real, structural possibility this fix introduces (a fix for the
  opposite problem — a specific memory being unfairly demoted — necessarily makes SOME reordering of
  the top of the list possible when scope specificity and raw rank disagree). Worth a dedicated seed
  example if this class of scenario matters going forward; out of scope for this task's narrow brief.
- **Bug 2 was invisible to pure-unit-test coverage of `toRedundancyPairs()` alone.** Had this task
  stopped after the brief's literally-named location, the shipped fix would have passed every pure
  unit test and still failed the real pilot's own exact scenario end-to-end. The explicit
  "REAL PILOT REGRESSION" requirement in the brief is why this was caught — a structural argument for
  keeping that kind of end-to-end acceptance test in place for any future redundancy change, not just
  this one.
- **`session` scope specificity is untested.** Included for internal consistency (one ordering table,
  not a project/global special case) but no scenario in this codebase's test data currently exercises
  a session-scoped memory in a redundant pair.

## SHOULD REDUNDANCY NOW BE ENABLED BY DEFAULT?

`NOT ENOUGH EVIDENCE`

Real, positive movement since `docs/PHASE_2C_PILOT_REPORT.md`: the specific gap that pilot surfaced is
now fixed and covered by a hardcoded regression using the pilot's own real content, not just a
synthetic stand-in. But: (a) this fix's own correctness was itself re-verified only under
`FakeEmbeddingProvider`, not re-run against the real embedding model end-to-end (the real-model
integration suite checks raw similarity detection, not the anchor-preference pipeline this task
changed); (b) the compiler.ts bug this task found by accident of writing a real end-to-end test is a
concrete reminder that this system has cross-module interactions a spec review alone does not surface
— there is no strong reason to assume this is the last one; (c) still N=1 real-pilot recreation plus
one synthetic dataset, not a broader corpus. Recommend: re-run the real pilot
(`docs/PHASE_2C_PILOT_REPORT.md`'s methodology) once more against this fix before deciding, and treat
a clean second real-world pass — not this task's synthetic-dataset regression alone — as the gating
evidence.

## NEXT INVESTIGATION

The pilot's Memory B (repository constraint) scoring ~0–0.042 despite clear lexical relevance is not
mysterious once traced, and is unrelated to redundancy. `rank()` (`packages/core/ranking/src/rank.ts`)
computes a plain weighted sum (`0.5*lexical + 0.4*semantic + 0.1*tag`, `score.ts`) over signals that
arrive **already normalized** — `SqliteRetrievalStore` calls `normalizeScores()`
(`packages/core/contracts/src/signals.ts`) independently on each channel, per query, min-max over
*that query's own candidate pool*. Min-max normalization's defined behavior for whichever candidate
scores lowest in a pool is exactly 0 (not "near zero" — the floor of the pool, by construction; the
degenerate one-candidate/all-tied case maps to 1.0, never 0, per that function's own doc comment, but
that guard does not apply once ≥2 candidates differ). A `computeScore` of 0 therefore requires B to
be the *weakest* candidate in that specific 4-item pool on **both** lexical and semantic channels
simultaneously for that specific task phrasing — plausible for a query textually dominated by
"REST endpoint naming convention" with "database architecture" as a secondary clause, against a memory
whose content is entirely about database access. This is a property of per-query relative
normalization interacting with a small, lopsided candidate pool, not a broken matcher — but it does
mean an item can display a literal `0`, which reads (misleadingly) as "no signal at all" rather than
"weakest of the ones considered." **Not fixed here, per instruction** — worth a scoped follow-up
specifically on whether `score: 0` should be distinguished from "genuinely no evidence" in whatever
consumes it downstream, evaluated on its own, not folded into redundancy work.

---

STOP. No further Brain architecture changes made after this task, per instructions.
