# Phase 2 Findings — Audit of the Live Phase 1 Brain

Audit pass only. No production code was changed. Every claim below is grounded in the live
implementation under `packages/` or in the live `data/brain.db` produced by the Phase 1
real-world test, and is reproducible with the commands shown.

Baseline health at audit time: `npm test` → **218 tests, 218 pass, 0 fail** across 13 workspaces.
The defects below ship *inside* a fully green test suite. That is itself a finding.

---

## 0. Summary of what changed relative to the brief's assumptions

The brief asks Phase 2 to design a learning loop on top of a working Phase 1 baseline. Two
audit results change the ordering of that work:

| Brief's framing | What the audit found |
|---|---|
| "Ranking quality does not yet understand usefulness well enough" (Finding B) | Ranking is not the defect. The **lexical relevance signal is direction-inverted** at the storage layer. The best BM25 match receives the *lowest* score. Reproduced exactly. |
| "Feedback is durable but write-only" (Finding D) | Worse than write-only. The `RetrievalEvent → ContextEvent → OutcomeEvent` chain is **empirically 0% connected** on real usage: 13 of 13 context events have `task_id = NULL`. There is no read side to build *and* no data for one to read. |

Both are Phase 1 defects, not Phase 2 design gaps. Neither invalidates the Phase 1 architecture —
the boundaries held. Both must be corrected before any Phase 2 evaluation number means anything.

---

## 1. Architecture boundaries — verified intact

Read across all 13 packages. The Phase 1 structural claims are true in the code, not just in
`PHASE_1_SPEC.md`:

- `packages/core/ranking` has zero I/O and depends only on `@brain/contracts`
  ([rank.ts](../packages/core/ranking/src/rank.ts), [score.ts](../packages/core/ranking/src/score.ts)).
- `packages/core/context` is pure; `CompileContextInput` structurally has no `budget` field
  ([compiler.ts](../packages/core/context/src/compiler.ts)).
- `packages/core/token` is the single budget-enforcement point
  ([optimize.ts](../packages/core/token/src/optimize.ts)).
- `packages/core/compression` depends on nothing, not even contracts
  ([compress.ts](../packages/core/compression/src/compress.ts)).
- The MCP adapter contains no business logic; every handler is validate → one Gateway call → format
  ([server.ts](../packages/mcp/src/server.ts)).
- The composition-root rule is mechanically enforced by a source-reading test
  ([boundaries.test.ts](../packages/mcp/src/boundaries.test.ts)).
- `Gateway` holds no mutable state; scope travels as a parameter
  ([gateway.ts](../packages/gateway/src/gateway.ts)).

**Conclusion: do not redesign Phase 1 boundaries.** Phase 2 fits inside them. The one place the
brief anticipated friction — "do not put storage I/O into ranking" (§6) — is already satisfied and
stays satisfied under this design (see `PHASE_2_SPEC.md` §3).

---

## 2. Finding A — scope isolation: confirmed, and structurally sound

`scopeIncludes()` in [scope.ts](../packages/core/contracts/src/scope.ts) is the single canonical
predicate. Both the SQLite path ([retrieval-store.ts](../packages/storage/src/retrieval-store.ts),
`scopeWhere()`) and the in-memory fake enforce it, and the isolation check is in the `WHERE` clause,
not a post-query filter.

Verified on the live database: a query under `project:notes-api` returns only `notes-api` rows plus
`global` rows; no `task-api` row is reachable.

**Phase 2 must not weaken this.** In particular, the scope-specificity work in §9 of the brief must
never become a *retrieval filter* change — it operates strictly on already-authorized candidates.

---

## 3. Finding B — root cause: the lexical signal is inverted

### 3.1 The mechanism

[retrieval-store.ts:135](../packages/storage/src/retrieval-store.ts#L135):

```ts
signals: { lexicalScore: 1 / (1 + Math.abs(row.fts_rank)) }
```

SQLite FTS5's `rank` column returns `bm25()`, which is **negative**, and *more negative means a
better match*. `Math.abs()` therefore grows with match quality, and the reciprocal shrinks. The
transform monotonically **inverts** relevance.

The candidate *set* is still correct — the SQL orders by `memories_fts.rank` ascending. Only the
scores attached to it are backwards. Ranking then re-sorts by those scores and undoes the correct
ordering retrieval had already produced.

### 3.2 Reproduced exactly, on the live corpus

Query and scope taken verbatim from the Phase 1 real-world test:

```
task  = "Refactor the database layer without changing API behavior"
scope = { kind: "project", id: "notes-api" }
```

| fts_rank (bm25) | `lexicalScore` produced | confidence | memory |
|---|---|---|---|
| **−2.4359** (best match) | **0.2910** | 1.0 | `notes-api: database access must go through the repository layer…` |
| −0.00000097 | 0.9999990 | 0.5 | `REST API resources should use plural nouns…` (global) |
| −0.00000087 | 0.9999991 | 1.0 | `notes-api REST endpoints use plural resource names…` |

Applying [rank.ts](../packages/core/ranking/src/rank.ts) (weighted sum, then tie-break on
confidence, then memoryId) to those scores yields:

1. project plural-route rule (score ≈ 0.5, confidence 1.0)
2. global plural-route rule (score ≈ 0.5, confidence 0.5)
3. project repository/database constraint (score ≈ 0.145)

**That is the exact order the real-world test observed.** Finding B is fully explained by this one
line. It is deterministic, not a tuning artifact.

### 3.3 A second, independent defect: the two signals are not on comparable scales

`semanticScore = 1 / (1 + L2distance)`. Embeddings are L2-normalized (384-d,
all-MiniLM-L6-v2), so distance ∈ [0, 2] and `semanticScore` ∈ [0.333, 1.0] by construction.

Measured on the live corpus (KNN from a stored vector, excluding the exact self-match):

```
semanticScore realized range: 0.4220 .. 0.5429   (spread 0.121)
lexicalScore  realized range: 0.2910 .. 1.0000   (spread 0.709)
```

At the declared weights (`lexical 0.5`, `semantic 0.4`,
[score.ts](../packages/core/ranking/src/score.ts)):

```
lexical  contribution spread = 0.5 × 0.709 = 0.354
semantic contribution spread = 0.4 × 0.121 = 0.048
```

The nominally near-equal weights produce a **~7.4 : 1** actual influence ratio. The declared weights
do not describe the system's behavior. Consequence for the case above: the semantic signal cannot
rescue the repository constraint — it would need to make up 0.354 of score and can move at most
0.048.

### 3.4 A third contributor: no stopword or term handling

`buildFtsQuery()` ORs every whitespace token, unweighted:

```
"Refactor" OR "the" OR "database" OR "layer" OR "without" OR "changing" OR "API" OR "behavior"
```

`the` and `API` are what pulled the two plural-route rules into the candidate set at all
(bm25 ≈ −1e-6, i.e. essentially "matched a near-universal term"). Phase 2 does not have to solve
query planning, but it must not treat a bm25 score of −1e-6 as evidence of relevance.

### 3.5 `RankingInput.task` is accepted and never read

`rank()` destructures `input.weights` and `input.candidates`. `input.task` is passed by the Gateway
on every call and used nowhere. "Ranking does not understand task intent" is literally true: the
task string is discarded. This is not a bug (Phase 1 never specified a use) but it means **no
task-conditional behavior exists at any layer today**, which bounds what §15 of the brief can ask
for in Phase 2.

### 3.6 Why 218 passing tests did not catch it

[fake-retrieval-store.ts](../packages/core/test-fixtures/src/fake-retrieval-store.ts) scores by
word overlap — **correctly oriented** (higher = better). Every ranking-quality test runs against the
fake. The real store's own tests
([retrieval-store.test.ts](../packages/storage/src/retrieval-store.test.ts)) assert *set membership*
with fixtures where only one record matches at all; not one test asserts **relative score ordering
between two matching records** in the real store.

The fake and the real implementation satisfy the same *type* and disagree on the *semantics of the
number*. Nothing in Phase 1 required them to agree. This is the single highest-value test gap found
in the audit, and it generalizes: any Phase 2 learning signal is equally exposed unless the fake and
the real store are held to a shared behavioural contract.

---

## 4. Finding D — the event chain is empirically disconnected

### 4.1 Measured on `data/brain.db`

```
retrieval_events        13 rows   task_id NOT NULL:  0
context_events          13 rows   task_id NOT NULL:  0
outcome_events           4 rows   task_id NOT NULL:  4
feedback_events          5 rows   task_id NOT NULL:  3
memory_mutation_events  10 rows
```

`EventStore.getEventsForTask()` joins on `task_id`. For the two real tasks:

```
getEventsForTask("notes-api-search-endpoint") → { retrieval: [], context: [], outcome: [1], feedback: [3] }
getEventsForTask("task-api-delete-endpoint")  → { retrieval: [], context: [], outcome: [1], feedback: [0] }
```

The retrieval/context half of the chain is empty for **every** real task. Outcome cannot be
attributed to any memory today — not because the read side is unbuilt, but because the join key was
never written.

### 4.2 Root cause: `taskId` is optional and unmotivated

`brain_context` does expose `taskId` ([schemas.ts](../packages/mcp/src/schemas.ts), `getContextShape`)
and the Gateway threads it through. It is `.optional()`, the tool description never mentions it, and
nothing tells a caller that omitting it discards attribution. The external agent had no reason to
supply one, and did not — 13 times out of 13.

**This is an affordance defect, not a schema defect.** Making `taskId` required would work but pushes
correlation discipline onto every agent forever. The structural fix is that the Brain already mints
an identifier for every delivery (`ContextEvent.id`) and simply does not return it.

### 4.3 `ContextPack` carries no identifier

[context.ts](../packages/core/contracts/src/context.ts) — `ContextPack = { items, tokenCount,
truncated, omittedCount }`. There is nothing for an agent to quote back. Even a maximally
cooperative agent cannot say "this feedback is about *that* delivery." This is the smallest,
highest-leverage contract change in Phase 2.

### 4.4 `included_memory_ids` is a JSON blob, not a joinable column

Both `context_events.included_memory_ids` and `retrieval_events.candidate_ids` are `TEXT` holding
JSON arrays ([0001_initial_schema.sql](../packages/storage/migrations/0001_initial_schema.sql)).
Computing "how many times was memory X included" requires a full table scan plus JSON parsing per
row, and cannot be indexed. Any aggregation built on this shape is O(entire history) per query.

`EventStore.getEventsForMemory(memoryId)` returns **only** `FeedbackEvent[]` — there is no API at
all for "which contexts included this memory."

### 4.5 `omittedMemoryIds` is always empty

All 13 context events have `nout = 0`. Budgets were never binding in the real-world test. So the
"retrieved but omitted" signal the brief asks about in §12 currently carries **zero observations**.
Phase 2 must not build a scoring rule on it.

---

## 5. Finding C — semantic redundancy: one real observation, correctly characterised

The recorded feedback is precise about *why* the global memory was rejected:

```
memory a0ae3295 (project plural rule)      useful = 1
memory 6ccf80c4 (project repo constraint)  useful = 1
memory cb18ede2 (global plural rule)       useful = 0
   notes: "Redundant with a0ae3295 (project-scoped, confidence 1.0, same convention already
           stated more specifically for this project). Added no information beyond what the
           project memory already gave for this task."
```

Two observations matter for design:

1. The rejection reason ("redundant") is recorded only in **free-text `notes`**. Nothing machine-
   readable distinguishes *"redundant here"* from *"wrong"* or *"irrelevant"*. Under a naive
   usefulness aggregation, a memory that is globally correct and frequently valuable gets scored
   identically to a memory that is false. This is the concrete risk §14 of the brief warns about,
   and it is already present in the only negative datapoint that exists.
2. Exact-content dedup in `compileContext()` cannot help — the two strings genuinely differ.

Corpus check (KNN from the project plural rule's stored vector, live DB):

```
L2 0.0000  cos 1.000  | notes-api REST endpoints use plural resource names   <- self
L2 0.6556  cos 0.785  | REST API resources should use plural nouns in endp   <- the redundant global rule
L2 0.9823  cos 0.518  | notes-api: database access must go through the rep   <- genuinely different
L2 1.1674  cos 0.319  | task-api uses Express with TypeScript strict mode
```

The redundant pair is the nearest non-self neighbour at cosine **0.785**, with a clear margin to the
next item (**0.518**). **Embedding-based redundancy detection would catch this case using vectors the
Brain already stores** — no new model, no network call.

Caveat that must survive into the spec: this is **one positive example on a 10-memory corpus**. The
0.785/0.518 gap gives a usable operating window but is not a basis for hardcoding a threshold. The
threshold is a harness-tuned parameter, not a design constant.

---

## 6. Finding E — token efficiency: measurable denominators, unmeasurable numerator

Available today: `ContextPack.tokenCount`, `omittedCount`, candidate ids, included ids.

Not available today:
- **Per-item token cost** — only the pack total is stored, so "how many tokens did the useful items
  cost" cannot be computed even with perfect feedback.
- **Candidate-pool token cost** — never estimated, so retrieval efficiency (delivered/candidate) has
  no denominator.
- **Counterfactual quality** — "would 500 more tokens have helped?" requires re-running the agent's
  task under a different budget. The Brain cannot observe this, and no amount of event logging will
  make it observable. Phase 2 should say so plainly rather than approximate it badly.

Note on the estimator: the char-based heuristic (`CHARS_PER_TOKEN = 3`,
[estimator.ts](../packages/core/token/src/estimator.ts)) is wrong in absolute terms but applies
uniformly, so **ratios remain valid for comparing strategies**. Replacing it is not a Phase 2
prerequisite.

---

## 7. What "usefulness" can honestly be built from today

Audited signal-by-signal against what is actually populated:

| Signal | Populated? | Reliability | Phase 2 verdict |
|---|---|---|---|
| `FeedbackEvent.useful` + `memoryId` | 5 rows, 5 distinct memories | Direct human/agent judgement | **Primary signal** |
| `FeedbackEvent.taskId` | 3 of 5 | Partial | Usable; superseded by `contextId` |
| `FeedbackEvent.notes` (reason) | free text | Not machine-readable | Needs a typed `reason` field |
| `OutcomeEvent.outcome` | 4 rows, **all `success`** | No negative examples exist yet | **Weak secondary**, diluted |
| `signal.testsPassed` | 4 of 4 | Reliable when present | Fold into outcome, do not weight separately |
| `signal.humanEdited` | 2 of 4 | Reliable when present | Record; do not score in Phase 2 |
| `signal.reviewScore` | **0 of 4** | Never supplied | **Do not build on it** |
| Context inclusion | 13 events | Reliable | Denominator only, not evidence of value |
| Context omission | **always empty** | No observations | **Do not score** |
| Repeated retrieval | 13 events | Confounded with one agent repeating itself in one session | Do not use as a usefulness proxy |
| `MemoryRecord.confidence` | populated (mostly 0.5 or 1.0) | Author-asserted, low information | Keep separate from usefulness (§11) |

The honest headline: **there are 5 usefulness observations, 4 outcomes, and zero failures.** Phase 2
can build the machinery, but it cannot yet *tune* anything statistically. The design must therefore
be one that is correct at n=0 and n=5, not one that needs n=500 to be safe.

---

## 8. Stale Phase 1 documentation — **APPLIED** (E24, documentation only)

Originally reported-not-edited per the brief's §27. **Authorized under E24 and applied during Phase 2A.**
Every correction below changes prose only; no code behaviour was changed, and each edit is marked
inline in the target document.

| Document | Stale statement | Actual |
|---|---|---|
| `PHASE_1_TASKS.md` P1-003 | `memory_audit_log` table | Table is `memory_mutation_events` |
| `PHASE_1_TASKS.md` P1-004 | "extension unavailable → in-process cosine fallback" | Deliberately throws for the caller to degrade; no cosine fallback exists (documented in `db.ts`) |
| `PHASE_1_SPEC.md` Storage Boundary | `@xenova/transformers` | `@huggingface/transformers` |
| `PHASE_1_SPEC.md` Learning | "the four event shapes" | Five — `MemoryMutationEvent` was added |
| `PHASE_1_SPEC.md` MCP Boundary | `brain_search` passes `filters` | `searchShape` omits `filters`; Gateway's filter support is unreachable via MCP |
| `PHASE_1_SPEC.md` Package Arch. | `packages/mcp` depends on `core/knowledge` | Package is `packages/knowledge`; MCP does not import it |
| `BUILD_PLAN.md` Phase 1.3 | adds `retrieval_log`, migration `0003_retrieval_log` | `retrieval_events`, inside `0001_initial_schema.sql` |
| `BUILD_PLAN.md` Phase 1.4 | `packages/core/context` does compression + budgeting | Split into `context` / `compression` / `token`; already corrected in `PHASE_1_SPEC.md` but not here |

None of these blocked Phase 2.

**The `brain_search` `filters` gap is the only one with a behavioural consequence, and it was
deliberately NOT closed.** `Gateway.search()` accepts `filters`; the shipped MCP `searchShape` does
not expose them. The correct reading is that the *document* was aspirational and the *code* is the
truth — so `PHASE_1_SPEC.md` now records the gap explicitly and `brain_search` behaviour is
unchanged. Changing a tool's surface because a stale document described it differently would be a
silent protocol change; if the filters are wanted, that is a separate authorized task.

---

## 9. Reproduction commands

```bash
# Finding B — inverted lexical score, live corpus
node -e "const D=require('better-sqlite3');const db=new D('data/brain.db',{readonly:true});
const q='\"Refactor\" OR \"the\" OR \"database\" OR \"layer\" OR \"without\" OR \"changing\" OR \"API\" OR \"behavior\"';
for(const r of db.prepare(\`SELECT substr(m.content,1,55) c, memories_fts.rank r FROM memories_fts
 JOIN memories m ON m.rowid=memories_fts.rowid WHERE memories_fts MATCH ?
 AND (scope_kind='global' OR (scope_kind='project' AND scope_id='notes-api'))
 ORDER BY memories_fts.rank\`).all(q))
 console.log(r.r.toFixed(4), (1/(1+Math.abs(r.r))).toFixed(4), r.c);"

# Finding D — broken task linkage
node -e "const D=require('better-sqlite3');const db=new D('data/brain.db',{readonly:true});
for(const t of ['retrieval_events','context_events'])
 console.log(t, db.prepare('SELECT COUNT(*) a, SUM(task_id IS NOT NULL) b FROM '+t).get());"

# Finding C — the redundant global rule is the nearest non-self neighbour of the project rule
node -e "const D=require('better-sqlite3'),sv=require('sqlite-vec');
const db=new D('data/brain.db',{readonly:true});sv.load(db);
const t=new Map(db.prepare('SELECT id, substr(content,1,50) c FROM memories').all().map(r=>[r.id,r.c]));
const p=db.prepare('SELECT embedding FROM memory_vectors WHERE memory_id=?')
  .get('a0ae3295-2eb3-42a3-bf33-748c5cd5ff3f');
for(const r of db.prepare('SELECT memory_id, distance FROM memory_vectors WHERE embedding MATCH ? AND k=? ORDER BY distance').all(p.embedding,4))
 console.log(r.distance.toFixed(4), (1-r.distance**2/2).toFixed(3), t.get(r.memory_id));"
```
