# Direction and validation plan

Prepared 2026-11-05, Asia/Taipei. This plan concerns the shared, client-independent Brain on this device.

## Decision

The product direction should be **reliable project memory that stays relevant as the project changes**. The next implementation is an evidence harness in `packages/evaluation`, followed by relevance calibration and code-anchored drift detection. Incremental delivery follows once correctness is measurable. Learning remains disabled.

The repository already contains metrics, pilot primitives, and a learning replay simulator. Rebuilding those as new projects would add little. Connect them to reproducible runs, current storage health, real delivery telemetry, and a prospective task A/B protocol first.

## Ranked directions

| Rank | Direction | Reason and prerequisite |
|---|---|---|
| 1 | Reproducible retrieval, storage, isolation, and workflow evidence | Implemented here. Answers whether the system is useful before increasing its complexity. Includes A/B ingestion, but genuine paired tasks still have to be collected. |
| 2 | Relevance calibration and abstention | Current negative-query fixture and current-corpus replay both return unrelated memories. Measure absolute similarity and lexical evidence on a separate calibration set; validate a rejection policy on an untouched holdout. Do not tune on this run's four negative examples. |
| 3 | Code-anchored memory with drift review | Strongest flagship capability. Requires code indexing actually being used: the current live database has no registered code repositories/files/chunks. Staleness cannot be estimated from delivery feedback alone. |
| 4 | Incremental context with explicit session acknowledgment | Valuable token optimization after relevance. Compare complete task outcomes and whole-workflow tokens, not candidate-pool compression. |
| 5 | Expanded isolation red team | Initial 246 memory/code path checks implemented with rank 1 and included in the default test command. Expand whenever a new retrieval path is added. Security remains a prerequisite at every rank. |
| 6 | Multi-client concurrency stress | Existing two-process MCP smoke already tests mixed calls, integrity, and durability. Extend to sustained load, writer starvation, latency percentiles, and SQL error classes before proposing a Rust rewrite. |
| 7 | Local decision capture from ADR/git sources | Useful after quality gates; import to a reviewable candidate stage with source references and idempotent import keys. Keep model judgment optional. |
| 8 | Learning replay and bounded ranking | Simulator already exists. Improve reconstructability and prospective evidence before any default-enable decision. Current replay coverage is low. |
| 9 | Contradiction/supersession proposals and promotion review | Current data already contains supersedes edges, contrary to the pasted older suggestion. Validate semantics, source authority, and human acceptance before automated transitions. |
| 10 | LLM pack judges, digests, and extra visualizer views | Optional later additions. Useful observation/UI features, but not a substitute for calibrated retrieval or user-workflow evidence. |

Cloud-first sync, required hosted models, adapter-specific intelligence, custom vector indexes, and heavy workflow orchestration remain outside this plan.

## Implemented now

`packages/evaluation/validation/` contains a versioned shared-corpus fixture, an ablation runner, measurement functions, and executable tests. The runner:

1. Requires an explicit source DB and a new output directory. Opens the source through a driver-enforced read-only connection and takes an SQLite online backup. All writable inspection and generated fixture activity uses temporary isolated databases.
2. Checks integrity, foreign keys, FTS external-content consistency, vector coverage, audit coverage, scopes, provenance, supersedes counts, and whether code indexing is in use.
3. Runs 40 authored repository-grounded cases: 12 topics with three paraphrases each and four unrelated queries. Their labels are provisional, correlated regression labels, not 40 independent real user tasks or human-reviewed golden truth.
4. Compares BM25, hybrid merge order, weighted hybrid ranking, and the same weighted pipeline with 256/1024 estimated-token budgets. Uses real FTS5/sqlite-vec and the cached local production embedding model. It does not invent a neural reranker.
5. Re-runs the existing seven-case `phase1-realworld.jsonl` separately. Does not pool its original feedback-derived and synthetic regression cases with new cases or label the pooled result statistically significant.
6. Reports per-scope and recent delivery/outcome/feedback measurements with explicit denominators, missing values, task correlation, deduplication, and estimated-token caveats. Reports negative-query abstention separately from relevance scores.
7. Accepts actual paired task observations through `--ab`. An empty A/B report remains unavailable; no savings are invented.
8. Separates correctness gates from research readiness. Passing isolation and budget tests does not mean abstention, learning readiness, or user productivity have been established.

The snapshot helper previously copied only the main SQLite file. It now awaits the online backup API, includes committed WAL writes, rejects an existing destination, and closes its read-only source connection. Its caller in the real-corpus replay was migrated to await it. Callers outside this repository must also await its now-asynchronous result.

The embedding provider accepts opt-in `localFilesOnly`; validation uses it to forbid a model download. Existing default runtime behavior is unchanged. A missing cached model is an explicit incomplete validation, rather than synthetic-vector quality evidence or an automatic download.

## Test plan and acceptance

| Test family | Required checks | What it establishes |
|---|---|---|
| Measurement arithmetic | Hand-calculated P@5/R@5/NDCG; empty denominators; negative cases; duplicate results rejected | Numbers mean what the report says |
| Telemetry attribution | Delivered-only feedback; first judgment dedup; omitted/unattributed feedback excluded; latest chronological task outcome; mismatched task IDs; anonymous contexts; missing token/timing values | No attribution from candidates or fabricated zeros |
| Dataset integrity | Exactly 40 cases; explicit source references; unique keys; dangling labels rejected; unauthorized positive labels rejected | Reviewable, replayable fixtures |
| Reproducibility | Different random database UUIDs produce identical fixture rankings and token totals | Stable final tie breaking |
| Adversarial isolation | Global/project/session with matching IDs, injection-like text and scope IDs, identical maximum-similarity vectors, archived records, positive controls | SQL authorization survives semantic similarity on all current tested paths |
| Retrieval paths | Memory FTS/vector, recall list/ID, search, context; code FTS/vector and identifier query through FTS | Current paths are covered; there is no separate symbol-search API to pretend to test |
| Snapshot regression | Committed uncheckpointed WAL pages survive backup; source main/WAL bytes unchanged; same/existing/missing paths rejected | Validation includes recent data without editing the live store |
| Budget gates | Every case at 256 and 1024 estimated tokens; all fixture and historical scope leaks must be zero | Budgeting and authorization correctness, not answer correctness |
| Full repository gate | `npm run check` | Existing build, type, boundary, service, MCP process, storage, and UI regression checks |
| Historical learning replay | Existing real-corpus replay on the WAL-safe backup, report reconstructability and cold-start changes | Honest limits of offline learning evidence |

Local output keeps exact logs and JSON; implementation tests are part of the normal evaluation package test command. Fixtures never enter the live Brain through `brain_remember`. The genuine work in this chat uses the normal scoped preflight, selective feedback, and outcome contract.

## What current memory storage does

The canonical `memories` table stores content, type, scope, provenance, confidence, status, timestamps, tags, and a `supersedes` reference. `scope_kind/scope_id` are authorization; `domain` is only taxonomy. Global content is visible to every project, so synthetic test content must never be globally seeded into a live DB.

Memory row changes and mutation audit events commit atomically. FTS5 is maintained by triggers. The vector index is separate and can fail without discarding the durable memory. A successful memory write therefore is not, by itself, evidence of vector coverage; the audit measures coverage explicitly. Forgetting archives rather than purges; archived records are excluded from ordinary retrieval. Direct recall can inspect archived history when requested.

Retrieval events record candidates. Context membership records what was actually delivered, omitted, and its estimated token cost. Feedback and outcomes correlate to a particular `contextId`; a successful task does not prove every delivered memory helped. Code/dependency source telemetry is separate from memory membership, so mixed-source tokens cannot use a memory-only denominator.

Confidence is not an automatically validated truth probability or retrieval relevance. This work does not add confidence aging, code drift verification, automatic promotion, or automatic archival. Active superseded targets and duplicate content are review indicators, not a verdict that a memory is false. No data cleanup is performed by the audit.

## Interpretation and validation against earlier evidence

The 2026-09 corpus hygiene report documented 63 memories and predominantly pilot content, with four globally scoped pilot memories archived. Current results remeasure that state; they must not repeat the historical finding as if no real usage has occurred since. Current per-scope results and the last-30-days window show subsequent activity, while uncertain provenance remains uncertain.

The older suggestion that supersedes edges are never written is no longer accurate. Likewise, building the first learning simulator or the first concurrency test would duplicate existing capabilities. The report records their current behavior instead.

Compare new ablations with the old seven-case fixture under today's same model/runtime. Do not compare metrics from different datasets as a before/after improvement. The authored fixture favors weighted ranking; the old fixture can favor simple merge ordering on NDCG. Both belong in the report.

The historical replay's inability to reconstruct many deliveries is a limitation of its evidence and current reconstruction design. It is not proof that those tasks failed or that memories were corrupted. A replayable unchanged subset cannot justify enabling learning across the unreconstructable majority.

The existing `Test For Braindead/notes-api` and `Test For Braindead/Task-api` projects were also inspected and re-executed: each passed seven tests and its type check on this device. Notes API uses a mock repository; Task API uses in-memory SQLite and a temporary local HTTP server. These establish their present behavior, not a causal effect of Brain. The flash-sale project has only a placeholder failing test command, so no passing result is claimed for it. Logs are included in the delivered bundle.

## Prospective user-workflow experiment

Collect at least 20 independent matched task pairs from real planned work, across repositories and difficulty levels. Freeze the task, starting repository revision, acceptance tests, and pre-task DB snapshot before assigning arms. Run independent isolated checkouts with and without `brain_context`, randomize arm order, and prevent the second run from reading the first run's changes or notes. Do not perform fabricated work in the user's repositories just to fill this quota.

Record one JSONL row per arm: `taskId`, `arm` (`with-brain`/`without-brain`), `totalTokens`, `toolCalls`, `testsPassed`, `humanEdits`, and `elapsedMs`. Count the whole workflow including Brain calls and response envelopes using the same instrumentation in both arms. Human edits require actual review; missing data must remain missing rather than defaulting to zero. Only complete pairs enter the summary; report incomplete pairs and failures separately.

The collection template is an empty `task-ab.jsonl` and a schema example in the validation README. The tool reports descriptive paired differences, not automatic causation or significance. Human review must assess task equivalence, order leakage, and outcome parity before a resume claim. Recorded testsPassed signals in historical Brain outcomes do not replace independently executed acceptance tests.

## Next capability design after evidence

For drift detection, add an anchor contract in `core/contracts`: memory ID, repository ID, relative path, optional symbol locator, baseline content hash, observed hash/time, and review state. Storage owns additive migrations and anchor persistence. `codebase` supplies hashes and index-change facts through interfaces; a core service decides review state. Gateway coordinates indexing updates; MCP only validates and delegates. File changes flag possible staleness; they must not automatically assert that the memory is false. Renames/deletions, reindex failure, multiple anchors, and unchanged files need explicit tests. Start with explicit reindex events before a background git watcher.

For incremental context, add explicit session identity and acknowledged delivery IDs/digests to contracts. The core selection service compares authorized current revisions against acknowledged prior deliveries; storage records delivery state; gateway composes the pack. Do not infer receipt from retrieval or assume a client retained context after compaction. Test new/updated/unchanged content, full-refresh requests, session expiration, scope changes, budget truncation, and out-of-order/retried acknowledgment. Measure tokens across the task at equal acceptance outcomes before enabling it by default.

Relevance calibration precedes both: relative min/max-normalized vector scores can assign 0.4 to the best item even when every item is irrelevant. Dropping score-zero items alone cannot fix this. Retain absolute-distance evidence through contracts only with a specified calibration policy and independent holdout tests. Preserve semantic-only paraphrase recall and lexical fallback while improving negative-query abstention.
