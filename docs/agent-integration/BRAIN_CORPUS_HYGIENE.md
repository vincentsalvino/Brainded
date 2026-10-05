# Brain Corpus Hygiene V1

Forensic audit triggered by a genuine finding, not a hypothetical: the first-ever
organic dogfood task against this Brain (`agent-workflow-integration-v1`,
`docs/agent-integration/BRAIN_WORKFLOW_POLICY.md`'s own pilot) pulled 4 memories,
and all 4 were judged `irrelevant`. This document traces why, fixes the
mechanical gap that let it happen, and states plainly what is still unresolved.

## Verdict

`data/brain.db` was, as of this audit, **100% pilot/evaluation-provenance
memory content** except for one new record this session's prior task wrote.
This is not new -- `docs/phase-4/PHASE_4_FINDINGS.md` §3 already established
"no REAL-USAGE (organic dogfooding) data in `data/brain.db`" as of Phase 4.
What's new here is the first organic task actually running against that
corpus and surfacing the consequence: **synthetic pilot content was globally
scoped**, so it was eligible for delivery to a real, unrelated task the
moment one existed.

Fixed: retrieval eligibility now honors `status` (it silently didn't before
-- see RETRIEVAL ELIGIBILITY below). **Applied**: all 4 memories archived on
the live database, on explicit approval, backed up first (see REMEDIATION
and LIVE DB SAFETY). The live tools won't reflect the eligibility fix until
the running MCP server process restarts -- the archive itself is permanent
regardless.

## The four memories

All four are the *entire* set of `scope_kind = 'global'` rows in the
database -- verified by query, not sampled.

| id | content | source | created | delivery rank / feedback |
|---|---|---|---|---|
| `cb18ede2` | "REST API resources should use plural nouns... /tasks and /notes" | `system`, no agent/task id | 2026-08-18T16:12 (2nd memory ever written) | rank 4, `irrelevant` |
| `a76fdf66` | "REST API resources should use plural nouns... /notes and /tasks" | `agent` `claude-code-phase2c-pilot`, task `phase2c-pilot-seed` | 2026-08-23T09:16 | rank 3, `irrelevant` |
| `f8ba7735` | "API input should be validated with Zod schemas..." | `agent` `claude-code-phase2c-validation-pilot-2`, task `phase2c-validation-pilot-2-seed` | 2026-08-23T15:00 | rank 2, `irrelevant` |
| `05ad05de` | "Application errors should be translated into structured API error responses..." | `agent` `claude-code-phase2c4-pilot`, task `phase2c4-pilot-seed` | 2026-08-25T14:51 | rank 1, `irrelevant` |

Each has exactly one `memory_mutation_events` row (`mutation_type: 'create'`),
and its `actor_*` fields match `source_*` exactly -- created once, never
edited, no discrepancy between the two provenance records.

## Provenance findings

Not inferred from wording alone -- cross-checked against durable evidence in
two places:

1. **The `memories` table's own `source_origin`/`source_agent_id`/
   `source_task_id` columns** (populated at write time, immutable since).
2. **`docs/phase-2c/PHASE_2C8_REPORT.md:72-78`**, written before this audit,
   independently: "`a76fdf66` was seeded in the 2C.4 pilot (2026-08-23,
   `source_task_id: phase2c-pilot-seed`) and `cb18ede2` predates this entire
   evaluation project (2026-08-18, `source_origin: system`)." That report
   also flags the two as a near-duplicate pair, cosine 0.9996 -- essentially
   the same synthetic sentence, planted twice.

Confidence differs across the four: `a76fdf66`/`f8ba7735`/`05ad05de` carry
explicit agent+task attribution naming a specific, documented pilot run --
high confidence EXPERIMENTAL/PILOT. `cb18ede2` has only `source_origin:
system`, no agent or task id, and is the second-oldest memory in the entire
database (33 minutes after the first). Its content near-duplicates a
confirmed pilot seed and it predates the pilot project itself, which points
to a bootstrap/example seed written during initial setup rather than
anything an agent authored -- medium confidence, stated as such rather than
asserted with the same certainty as the other three.

## Corpus composition (re-measured, not assumed)

| | Phase 4 (`PHASE_4_FINDINGS.md`, pre-dogfood) | This audit |
|---|---|---|
| total memories | 62 | 63 |
| `scope_kind='global'` | 4 | 4 (same four) |
| `scope_kind='project'` | 58, pilot-named | 59 |
| all `status` | `active` | `active` (0 archived -- lifecycle status has never been used) |

The +1 project-scoped memory reconciles exactly: it's
`a3e1046c-8332-4a82-a10e-99983ed183c7`, the one memory the prior task in this
session (`agent-workflow-integration-v1`) wrote, scoped to `project:ai-brain`,
`source_origin: agent`. Nothing else changed corpus-wide between Phase 4 and
now -- no other write landed in between.

Classification, applying Phase 4's own already-cited families
(`PHASE_4_FINDINGS.md` §3) re-verified against current data:

| Class | Count | Eligible for normal retrieval today |
|---|---|---|
| ORGANIC | 1 (`a3e1046c`) | yes -- correctly so |
| EXPERIMENTAL / PILOT (high confidence) | 3 (the tagged globals) | yes -- **the bug** |
| EXPERIMENTAL / BOOTSTRAP-SEED (medium confidence) | 1 (`cb18ede2`) | yes -- **the bug** |
| EXPERIMENTAL / PILOT (project-scoped, correctly isolated) | 58 | no -- scope already protects these |
| UNKNOWN | 0 | -- |

No memory here required an UNKNOWN bucket in practice -- every one of the 63
resolved to a class on available evidence. That won't always be true; the
bucket stays defined for the next audit that finds one that doesn't.

## Contamination path

Not a bug in `packages/evaluation`'s automated code -- that code is already
isolated (see ISOLATION below) and was, re-verified now, at the time of
Phase 4. The mechanism is scope, not test hygiene:

`SqliteRetrievalStore`/`FakeRetrievalStore`'s candidate generation resolves a
`project` query as `scope_kind = 'global' OR (scope_kind = project AND
scope_id = ?)` -- global memories are visible from *every* project scope, by
design (`packages/storage/src/retrieval-store.ts`'s `scopeWhere`, mirrored in
the fake). The 58 other pilot memories were written `project`-scoped to
fictitious pilot project ids (`pilot-document-service`,
`phase2c-pilot`, etc.) and are therefore correctly invisible outside their
own pilot runs. These 4 were written `global` instead -- whether by an
explicit choice in whatever seeded them or a default that wasn't
overridden, the write itself predates this audit and memory mutation events
don't record *why* a scope was chosen, only that it was. That's a real,
stated limit of the current evidence, not filled in with a guess.

Three of the four are attributed to a real MCP tool session (`brain_remember`
calls carrying real agent/task ids) run against the literal `data/brain.db`
path -- confirmed independently by `PHASE_2C8_REPORT.md:266`'s own line:
"Verified directly against `data/brain.db` (SQL, not the wrapper script)."
Pilot activity used the live database directly, through the same MCP surface
real work uses, because nothing distinguishes "this call is a pilot" from
"this call is real" at the tool-call layer -- only the caller's choice of
task id/scope does, and nothing enforced that choice.

## Retrieval eligibility (the mechanical gap, now fixed)

Before this task, `status` was inconsistently enforced: `memory-repository.ts`
already filtered `status = 'active'` for some reads (`listAllMemories`,
`query`'s callers), but `retrieval-store.ts`'s `lexicalSearch`/
`semanticSearch` -- the two methods that actually generate `brain_context`'s
candidates -- had no status clause at all. An archived memory would still
have surfaced in normal retrieval. Fixed in both implementations
(`packages/storage/src/retrieval-store.ts`,
`packages/core/test-fixtures/src/fake-retrieval-store.ts`), covered by two
new shared conformance tests
(`packages/core/test-fixtures/src/store-conformance.ts`) run against both.
No ranking weight, similarity threshold, or scoring formula changed --
this is eligibility (should this candidate exist at all), not ranking (how
it's scored once it does).

## Remediation -- APPLIED TO LIVE DB

Chosen from Step 7's options on the evidence above: **D + A-lite** --
`archive()` (not purge) the 4 memories, now that the status column
genuinely gates retrieval. Not scope correction: once archived, scope is
moot for retrieval purposes, and scope wasn't reliably reconstructable
(re-scoping to a guessed pilot project would fabricate provenance the
evidence doesn't support). Not deletion: archiving keeps the record and its
full mutation/feedback history intact for future audits -- exactly what
"do not delete until purpose is understood" asks for, now that purpose *is*
understood.

An in-repo cross-cutting decision log doesn't exist for non-phase work
(`docs/planning/DECISIONS.md` and `docs/phase-4/PHASE_4_DECISIONS.md` are
both phase-scoped, closed records -- same reasoning as the prior task's
Native Memory Coexistence report); this section is the decision record.

**Applied 2026-09-08T00:43:48Z**, via `SqliteMemoryRepository.archive(id,
{kind:"global",id:null})` against `data/brain.db` directly (the same method
the replay validated, not raw SQL). All four:
`05ad05de-f2bf-4c4c-bf02-093b79f626a2`, `f8ba7735-454e-4066-8fda-ed09db40afe9`,
`a76fdf66-4d80-4773-843a-53a2d4435a53`, `cb18ede2-7913-45b1-b55d-0a9b640b6cda`
-- `status: active -> archived`, every other field (content, scope, source,
confidence, tags, `created_at`) byte-identical to the pre-mutation backup.
`memories_total` unchanged (63); `feedback_events`/`outcome_events` unchanged
(273/61) -- history untouched. Backup:
`data/brain-backup-20260908T004151Z.db` (`VACUUM INTO`, integrity-checked
`ok`, 63 memories, all 4 targets confirmed pre-archive).

Two known artifacts of this session's *verification* method, not of the
archive itself -- disclosed rather than cleaned up, per this document's own
"do not rewrite history" rule:
1. A live fresh-process replay against the *live* file (see BEFORE/AFTER
   below) re-ran the same `archive()` call the copy-replay used, which is
   idempotent in effect (status was already `archived`) but appended one
   extra, redundant `memory_mutation_events` row per memory
   (`memory_mutation_events`: 63 -> 71, not the intended 67) and moved
   `updated_at` to the later timestamp. Left as-is -- the event log is
   append-only, and deleting rows to tidy an audit trail is worse than a
   harmless duplicate in it.
2. The **live MCP server process already running this session predates
   this task's `retrieval-store.ts` fix** and has not reloaded it -- see
   BEFORE/AFTER REPLAY. The archive is real and permanent; the *live tools'*
   exclusion of these memories takes effect on the server's next restart,
   not before.

## Before / after replay

Replayed the exact original request (`task`, `scope: project:ai-brain`,
`maxTokens: 2000`, same text) against a snapshot copy of the live database
(`VACUUM INTO`, read-only source connection, WAL-consistent), via
`createBrain()` (`packages/mcp/src/bootstrap.ts`) -- the same composition
root the live MCP server uses, not a hand-rolled substitute.

| | candidates | delivered | tokens |
|---|---|---|---|
| before | 5 | `a3e1046c` (score 0.900), `f8ba7735` (0.150), `05ad05de` (0.032), `a76fdf66` (0.0009), `cb18ede2` (0.0000) | 501 |
| after (4 archived on the copy) | 1 | `a3e1046c` (score 0.900) | 357 |

All 4 flagged memories disappear; nothing new appears to replace them --
the one memory left is the one that was already there and already
correctly ranked first. Per Step 9's own caution: the improvement claim
here rests on *what* disappeared (four generic, off-topic textbook rules)
and what's left (the one memory actually about the replayed task), not on
the raw count dropping from 5 to 1. Ranking scores for the surviving item

**Live-tool cross-check, post-archive:** calling the actual `mcp__brain__*`
tools immediately after archiving still returned all 4 (`brain_search`,
`brain_context`) -- correctly flagged `"status":"archived"` in the payload,
but not excluded. Root cause: this session's MCP server process started
before the `retrieval-store.ts` status fix existed, so it's serving from an
in-memory copy of the old, unpatched module -- a stale long-running process,
not a data or logic bug. Confirmed by re-running the SAME query via a fresh
`node` process (this section's replay script) directly against the live file
immediately afterward: candidates correctly drop from what they'd otherwise
be to just the one real memory, matching the copy-replay exactly. The fix is
real and on disk; it takes effect for the live tools on the server's next
restart. No code or data action is needed to complete this -- it's an
operational restart, external to this repository.
are bit-for-bit identical before and after -- nothing about ranking was
touched.

## Future isolation guards

**Automated code was already correctly isolated**, re-verified against
current source, not assumed from the Phase 4 report:
- `packages/storage/src/db.test.ts` and every other package's unit tests use
  `openDatabase(":memory:")`.
- `packages/evaluation`'s own tests resolve their working databases under
  `mkdtemp`/a temp-dir join, never the literal live path.
- `packages/evaluation/src/historical-replay-real-corpus.test.ts` reads the
  live corpus for analysis via `copyFileSync` into a temp dir first --
  read-only by construction, never opens the live file itself.
- `packages/evaluation/src/pilot-harness.ts`'s `snapshotDatabase`/restore
  mechanics (built for Phase 4.3, unused so far -- see PHASE 4.3 STATUS)
  take explicit source/snapshot paths; nothing defaults to the live path.
- `packages/mcp/src/bootstrap.ts`'s `createBrain(dbPath)` also takes an
  explicit path -- the only implicit default anywhere is `server.ts`'s CLI
  entry (`process.argv[2] ?? "./brain.db"`), a relative fallback for
  standalone invocation, unrelated to how the actual MCP session's `data/brain.db`
  path gets supplied (that wiring lives in this machine's MCP client
  configuration, outside this repository).

Added one small regression guard given that:
`packages/evaluation/src/db-isolation-boundary.test.ts` -- fails the build
if any future file under `packages/evaluation/src` hardcodes a fallback to
the live path instead of taking one as an explicit argument. It would not
have prevented this incident (the incident wasn't automated-code-shaped) but
pins the current correct state against regression, the same discipline
`packages/visualizer/src/server/boundaries.test.ts` already applies to its
own layer.

**The actual gap was procedural, not mechanical**: a human/agent chose to
run pilot-labeled `brain_remember` calls through the same live MCP session
used for real work. No code change closes that -- it's a convention.
Recorded here and in `BRAIN_WORKFLOW_POLICY.md`: seeding or testing synthetic
content must go through `pilot-harness.ts`'s snapshot/restore path against an
isolated copy, never directly through a live interactive session.

## Workflow metric correction

`packages/visualizer`'s Overview "Workflow" panel previously labeled its
first stat "Tasks tracked," which could be misread as "percentage of all
substantive tasks." Relabeled to **Observed Brain Tasks** / **With Context**
/ **With Feedback** / **With Outcome**, with an explicit caption stating
tasks that never contact Brain are not observable
(`packages/visualizer/src/ui/pages/OverviewPage.tsx`,
`BRAIN_WORKFLOW_POLICY.md`'s adherence-telemetry section updated to match --
one wording, not two to keep in sync). No bypass count added; none is
mechanically derivable yet (see BRAIN_WORKFLOW_POLICY.md).

## Phase 4.3 organic status

`agent-workflow-integration-v1` is **not** official Phase 4.3 organic
learning-gate evidence. Checked against the frozen protocol
(`docs/phase-4/PHASE_4_3_REPORT.md:161-186`): no pre-task snapshot was taken,
no OFF/ON arm was assigned (learning is globally off, so there was no arm to
assign), no opposite-arm counterfactual was generated from a pre-task
snapshot, and the task id wasn't tagged `phase4.3-organic-NN-slug`. It *is*
valid evidence for the Brain Workflow Policy pilot -- a real preflight,
real selective feedback, a real recorded outcome -- just not evidence toward
the pre-registered `≥20 genuine tasks` learning-gate floor, which per
`PHASE_4_3_REPORT.md` remains unmet (0/20) and is not manufactured here to
look otherwise.

## Files changed

- `packages/storage/src/retrieval-store.ts`, `packages/core/test-fixtures/src/fake-retrieval-store.ts` -- status-eligibility fix
- `packages/core/test-fixtures/src/store-conformance.ts` -- 2 new shared conformance tests (+ `ConformanceSeed.status`)
- `packages/storage/src/retrieval-store.test.ts`, `packages/core/test-fixtures/src/fakes.test.ts` -- harness wiring for the new seed field
- `packages/evaluation/src/db-isolation-boundary.test.ts` (new) + `package.json` test script entry
- `packages/visualizer/src/ui/pages/OverviewPage.tsx` -- Workflow panel relabel
- `docs/agent-integration/BRAIN_WORKFLOW_POLICY.md` -- adherence-telemetry wording matched to the relabel
- `docs/agent-integration/BRAIN_CORPUS_HYGIENE.md` -- this document

**Not changed**: no ranking weights. No similarity thresholds.
`DEFAULT_LEARNING_CONFIG.enabled` (still `false`). Redundancy config default
(still `false`). `feedback_events` rows from the original incident (still
4, still `irrelevant`, untouched). No source file changed during the
live-DB remediation step itself -- that step was pure data, using code
already shipped and tested in the audit task.

**Changed, by explicit approval**: `data/brain.db` -- 4 memories
`active -> archived`. See Remediation above.

## Live DB safety

Two distinct phases, two different postures. The audit itself never opened
the live file for writes -- every read went through a `VACUUM INTO`
snapshot (read-only source connection; `VACUUM INTO` does not modify its
source). Live-checksum comparisons across that entire phase (`826a856c…`)
were byte-identical start to end.

The remediation phase that followed *did* write to the live file, on
explicit approval, and only after: a working-tree check (`git status`, no
unrelated changes present), a target re-verification against the live file
itself (all 4 ids/scope/status/content matched the audit exactly,
independent of the earlier snapshot), and a fresh `VACUUM INTO` backup
(`data/brain-backup-20260908T004151Z.db`, gitignored by
`data/*.db`, integrity-checked before use). The mutation itself went through
`SqliteMemoryRepository.archive()`, the same repository method (not raw
SQL) validated by the copy-replay. `PRAGMA integrity_check` returned `ok`
both immediately after the archive and after a final `wal_checkpoint`. Final
checksum `19e80749…` -- expected to differ from the pre-mutation value, and
does. `data/brain.db*` remain untracked/gitignored throughout (`git status`
never shows them).
