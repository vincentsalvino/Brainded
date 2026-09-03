# Phase 2C.11 — H2 Organic Breadth Validation

Evaluation-only. `packages/core/retrieval/src/lexical-containment.ts` (H2 itself), the retrieval service policy, `RedundancyConfig`'s shape, ranking, token optimization, scope authorization, and `packages/mcp/src/bootstrap.ts` were not touched — confirmed by `git status` showing exactly the same files Phase 2C.10 left modified/untracked, nothing more. `candidateFloor` (0.75) and `containmentThreshold` (0.40) were not tuned. No learning mechanism was implemented, prototyped, or scaffolded.

## PHASE 2C.11 STATUS

Complete. 5 new, independent project scopes; 25 real coding tasks (5 per project), all implemented test-first and green; every scope-valid candidate pair at cosine ≥0.75 across the new evidence reviewed (7 pairs, not only the 3 H2 flagged as NEAR_DUPLICATE). **Headline finding: 2 of the 3 H2-positive predictions in this fresh batch are false positives, and both are confirmed, live, context-impacting** — a materially different precision picture than the 2C.9/2C.10 evidence, which showed zero false positives on its own (different) evidence set. The organic breadth gate is **NO**.

## NEW PROJECTS

5 independent scopes, none reused from any prior phase (task-api, notes-api, phase2c-pilot, phase2c-validation-pilot, phase2c-threshold80-pilot, and all five 2C.8 pilot-\* projects excluded from the primary evidence set, per instruction):

| Project | Domain |
|---|---|
| `pilot-orders-service` | order creation/totals, cancellation, discounting, line-item edits, status state machine |
| `pilot-notification-service` | email/SMS send, preference-gated delivery, retry, delivery logging |
| `pilot-document-service` | content-hash storage, versioning, soft delete, owner-only access, expiring share links |
| `pilot-inventory-service` | stock reservation/release, insufficient-stock guard, low-stock flag, restock |
| `pilot-audit-service` | append-only audit entries, query by actor/target, immutability, field redaction |

## REAL CODING TASKS

25 total, 5 per project. Every task: real test file written first, watched fail for the right reason (missing module or failing assertion), real implementation written, tests rerun to green, then `getContext` → implement → `feedback` → `recordOutcome` against a temporary H2-enabled Gateway wired to the real `data/brain.db`. All 25 finished with real, passing tests (55 individual `node --test` assertions across the 5 services' test files by the end of the pilot, counting regression reruns each task added to). One test-fixture mistake was caught and fixed on its own merits (a hand-typed sha256 hex literal in `pilot-document-service`'s first test was wrong by one hex digit; corrected against `crypto.createHash` output, unrelated to redundancy).

## NATURAL MEMORY ACCUMULATION

22 new project-scoped memories from 25 tasks (not 1:1): orders 4, notifications 5, documents 5, inventory 5, audit 3. 3 tasks recorded no memory because the task only applied an already-recorded decision without introducing a new one (orders: adding a line item under the already-established pending-only-editability rule; audit: querying by actor, then by target, both straightforward applications of the entry schema already on record) — the same "not every task produces a memory" discipline 2C.8 used, applied by the same judgment call, not a quota. 0 memories were authored to deliberately resemble another; no memory's wording was edited after being written, and no wording was adjusted after seeing any cosine or containment number.

## CANDIDATE PAIRS ≥0.75

**7 scope-valid pairs**, all within-project. 0 project↔global pairs reached 0.75 (the four global facts already on record — REST plural naming ×2, HTTP-boundary error translation, Zod input validation — are generic enough that none of this phase's domain-specific decisions scored close). All 7 reviewed, not only the 3 H2 flagged:

| Pair | Project | Cosine | Containment | H2 |
|---|---|---|---|---|
| `94c600d1` (retry) ~ `d773e4ae` (delivery log) | notifications | 0.8771 | 0.2727 | DISTINCT |
| `e015e0ea` (reserve) ~ `cce34ebf` (release) | inventory | 0.8621 | 0.4000 | NEAR_DUPLICATE |
| `9e96b1c6` (cancel guard) ~ `04116c56` (status state machine) | orders | 0.8505 | 0.5294 | NEAR_DUPLICATE |
| `cbb7510a` (archive) ~ `ddeddb2f` (owner-only access) | documents | 0.8198 | 0.3000 | DISTINCT |
| `bd1d8511` (create order) ~ `c35cfbee` (discount) | orders | 0.7807 | 0.3750 | DISTINCT |
| `e015e0ea` (reserve) ~ `fa160729` (insufficient-stock guard) | inventory | 0.7581 | 0.3810 | DISTINCT |
| `c81a012a` (email send) ~ `a90f8264` (SMS send) | notifications | 0.7525 | 0.6667 | NEAR_DUPLICATE |

`pilot-audit-service` produced **zero** pairs ≥0.75 — its 3 memories (entry schema, immutability, redaction) are lexically and semantically distinct enough that none crossed the candidate floor at all.

## HUMAN LABELING

Labels were formed from content, independent of exact cosine/containment values wherever that was practical. Two pairs need an explicit note on methodology, disclosed rather than smoothed over:

- `c81a012a`~`a90f8264` (email~SMS) and `e015e0ea`~`cce34ebf` (reserve~release): both pairs' redundancy flag was visible live (via `redundantWith` in an ordinary task-flow `getContext` call) *before* this dedicated audit phase computed exact containment values. A content-only judgment was recorded **at that moment**, before any number was seen, and is the label reported below (the audit phase, done later with exact numbers in hand, would have found `e015e0ea~cce34ebf`'s email/SMS-style case genuinely closer to the line — that later reaction is disclosed here, not used to revise the frozen label).
- All other pairs (all 5 remaining) were labeled fresh during this audit phase, with numbers already visible, because no prior in-loop impression existed for them.

This phase's labeling was also done by the same agent that authored the underlying memories — a real independence limitation, disclosed in RISKS, not a blind third-party review.

**Labels:**

| Pair | Label | Reasoning |
|---|---|---|
| retry ~ delivery log | DISTINCT | control-flow/resilience vs. observability — different responsibilities entirely |
| reserve ~ release | DISTINCT | inverse operations; release's over-release guard is not derivable from reserve's memory alone |
| cancel-guard ~ state machine | **NEAR_DUPLICATE** | the state machine memory already states the pending→cancelled transition the cancel-guard memory restates; classic subsumption, same shape as the project's earlier T4~T6 hard case |
| archive ~ owner-only access | DISTINCT | deletion semantics vs. authorization — different responsibilities, sharing only the word "archived" |
| create order ~ discount | DISTINCT | different operations; discount's percentage-validation and its own pending-gate are not derivable from creation alone |
| reserve (mechanic) ~ reserve (insufficient-stock guard) | DISTINCT | base mechanic vs. a specific, non-obvious edge-case error condition on the same function |
| email send ~ SMS send | DISTINCT | share an injected-provider + reject-missing-contact-field template, but SMS's 160-character segment limit is a genuinely distinct, non-derivable requirement absent from email entirely |

## H2 TRUE POSITIVES

**1**: `9e96b1c6`~`04116c56` (orders, cancel-guard subsumed by the full state machine).

## H2 FALSE POSITIVES

**2**, both confirmed context-impacting (see below):

- `e015e0ea`~`cce34ebf` (inventory, reserve~release, cosine 0.8621, containment 0.4000 — exactly at the corroboration threshold)
- `c81a012a`~`a90f8264` (notifications, email~SMS, cosine 0.7525, containment 0.6667)

## H2 FALSE NEGATIVES

**0.** The one organically-labeled NEAR_DUPLICATE pair (cancel-guard~state machine) was correctly caught by H2. No missed duplicate exists in this evidence set to report a cost for.

## AMBIGUOUS PAIRS

**0**, scored. One case (email~SMS) sat close enough to the boundary that a different reviewer could reasonably land on AMBIGUOUS instead of DISTINCT — disclosed above, not hidden, but not rescored after the fact either.

## CONTEXT-IMPACTING FALSE POSITIVES

**Both of the 2 classification false positives are confirmed context-impacting**, verified live with a matched A/B (H2 enabled vs. disabled) comparison at the same task and budget, not asserted from the classification alone:

**Inventory (reserve~release).** Query: "release a stock reservation back to available quantity", budget 426 tok (exactly the sum of every non-redundant candidate in the pool).
- H2 enabled (contextId `3b45a1b0-…`): `e015e0ea` (the reserve-mechanic memory, rank 3 of 9 by relevance) is the **only** omission — excluded solely because it was demoted behind `cce34ebf`.
- Disabled, same task/budget (contextId `e7d1e980-…`): `e015e0ea` **is delivered** (its natural rank-3 position easily fits); two different, lower-relevance items are omitted instead.

**Notifications (email~SMS).** Query: "send a notification to a user through whichever channel, email or SMS, is available for them", budget 483 tok.
- H2 enabled (contextId `63cfd5b3-…`): `c81a012a` (the email-send memory, rank 4 of 9) is the **only** omission — excluded solely because it was demoted behind `a90f8264`.
- Disabled, same task/budget (contextId `44590d62-…`): `c81a012a` **is delivered**; three lower-relevance items are omitted instead.

In both cases the excluded memory was, by relevance rank alone, well within the delivered set — its exclusion is attributable to the false redundancy classification, not to budget pressure on its own merits. This is the same class of finding 2C.8 made for Rule H's two false positives, now reproduced independently, on entirely fresh content, against H2.

## FALSE-NEGATIVE CONTEXT COST

Not applicable — 0 false negatives this phase (see above).

## DISABLED VS H2

| Pair | Task/budget | Disabled: delivered | H2: delivered | H2: omitted (vs. disabled) |
|---|---|---|---|---|
| reserve~release (FP) | 426 tok | `e015e0ea` included; 2 lowest-relevance items dropped instead | `e015e0ea` excluded (demoted) | the reserve-mechanic memory itself |
| email~SMS (FP) | 483 tok | `c81a012a` included; 3 lowest-relevance items dropped instead | `c81a012a` excluded (demoted) | the email-send memory itself |
| cancel-guard~state-machine (TP) | 356 tok | `9e96b1c6` included; `a76fdf66` (global REST-naming fact) dropped instead | `9e96b1c6` excluded (demoted, correctly) | the subsumed cancel-guard memory |

## CONTEXT EFFICIENCY

**Does H2 replace redundant content with unique useful context? Weakly, in the one case tested, not decisively.** In the true-positive probe, suppressing `9e96b1c6` (correctly redundant) let `a76fdf66` into the delivered set instead — but `a76fdf66` is itself flagged `redundantWith: cb18ede2` (the historical global REST-naming duplicate), which was *already* included in the same pack. So the "gain" from the one correct classification in this sample was a marginally-worded restatement of a fact already present, not a clearly distinct, higher-value item. This is an honest, small-sample observation, not a general claim: with only one true positive to observe, no broader efficiency conclusion is drawn from it either way.

Frequency itself is the more informative number here: 7 candidate pairs ≥0.75 emerged from 22 memories and 25 real tasks — genuine near-duplication is **rare** in ordinary organic work, at least at this scale, which bears directly on the UTILITY GATE below.

## PROJECT-BY-PROJECT RESULTS

| Project | Memories | Tasks | Pairs ≥0.75 | TP | FP | TN |
|---|---|---|---|---|---|---|
| pilot-orders-service | 4 | 5 | 2 | 1 | 0 | 1 |
| pilot-notification-service | 5 | 5 | 2 | 0 | 1 | 1 |
| pilot-document-service | 5 | 5 | 1 | 0 | 0 | 1 |
| pilot-inventory-service | 5 | 5 | 2 | 0 | 1 | 1 |
| pilot-audit-service | 3 | 5 | 0 | 0 | 0 | 0 |

## NEW-ONLY METRICS

| | Count |
|---|---|
| TP | 1 |
| FP | **2** |
| TN | 4 |
| FN | 0 |
| AMBIGUOUS (excluded) | 0 |

- Precision: 1/(1+2) = **0.3333**
- Recall: 1/(1+0) = **1.0000**
- False positive rate: 2/(2+4) = **0.3333**
- False negative rate: 0/(0+1) = **0.0000**

**This is a small sample (n=7, 3 positive predictions) — but it is real, organic, unengineered evidence, and it directly contradicts treating H2 as a generally high-precision policy.** 2C.9's 1.0000 precision was measured against a specific, already-known evidence set (the frozen 99 pairs plus 2C.8's 10 organic-2C8 pairs); it was never a claim about precision on *future* fresh content. This phase's fresh sample says the false-positive risk on new organic content is real and not small on this evidence (2 of 3 positive predictions wrong) — a genuinely different, more cautionary number than 2C.9/2C.10's reported 1.0000.

## HISTORICAL EVIDENCE

Not blended into the numbers above, per instruction. 2C.9's 109-pair retrospective (TP 35/FP 0/TN 66/FN 8) and 2C.10's live validation of the two originally-known false positives (both still correctly DISTINCT under H2, reconfirmed unaffected by this phase) stand exactly as previously reported. Nothing in this phase changes, invalidates, or re-runs that evidence.

## EVENT CORRELATION

36 total `phase2c11-*` context events: 25 real task contexts + 11 audit/smoketest probes (1 connectivity smoketest + 10 dedicated audit probes: 4 for the inventory FP, 3 for the notification FP, 3 for the orders TP). Every context event has a matching retrieval event via `retrieval_event_id`. Sampled and spot-checked multiple full chains (RetrievalEvent → ContextEvent → ContextEventMemory → Feedback → Outcome) for real task contexts; all resolved correctly.

## TOKEN ACCOUNTING

`sum(context_event_memories.token_count WHERE included=1) == context_events.token_count`, verified **exact for all 36 contexts** (real tasks and audit probes alike). Zero drift anywhere.

## FEEDBACK COVERAGE

144 feedback events across the 25 real task contexts (audit/smoketest probes received none, matching the established convention that measurement-only probes are not scored deliveries). Feedback was recorded per-delivered-memory honestly: useful when the memory's guidance was actually applied in that task's implementation, not-useful/irrelevant otherwise — not only for whichever memory the task happened to be "about."

## OUTCOME COVERAGE

25/25 real task contexts have exactly one outcome event, all `outcome: success` (every task's tests passed). labeledFraction (real task contexts with both feedback and outcome) = **25/25 = 100%**. The 11 audit/smoketest probes intentionally have zero outcome events, by design.

## H2 ORGANIC BREADTH SUFFICIENT? **NO**

| Requirement | Bar | Actual | Met? |
|---|---|---|---|
| Independent new project scopes | ≥5 | 5 | yes |
| Real coding tasks | ≥25 | 25 | yes |
| Every ≥0.75 pair reviewed | required | 7/7 | yes |
| New organic near-duplicate pairs | ≥5 | 1 | **no** |
| Near-duplicates span ≥3 projects | ≥3 | 1 | **no** |
| Confirmed context-impacting false positives | 0 | **2** | **no** |
| Scope isolation regression | none | none found | yes |
| Ranking regression | none | none found | yes |
| Correlation/token-accounting regression | none | none found | yes |

Three of nine conditions fail, and one of them — zero context-impacting false positives — is the same condition 2C.8 named as highest-priority when it gated Rule H to NO. The bar is not softened to reach YES: this phase's honest answer is **NO**.

## IS H2 USEFUL ENOUGH FOR DEFAULT-ON? **NO**

Weighing the requested factors together, not classification metrics alone:
- **Frequency of naturally occurring redundancy:** low (7 candidate pairs from 22 memories / 25 tasks).
- **Redundant context actually avoided:** minimal — 1 correct suppression in the whole sample.
- **Unique useful items gained a slot because of it:** weak — the one backfill observed was itself a near-duplicate of an already-included item, not a clearly distinct gain.
- **False-negative token waste:** none observed (0 FN).
- **Operational cost:** unchanged from prior phases (embedding + containment computation only on already-retrieved candidates ≥0.75).
- **False-positive safety:** the deciding factor — 2 confirmed, live, context-impacting false positives against only 1 weak true positive is a poor trade on this evidence.

## SHOULD H2 REDUNDANCY BE ENABLED BY DEFAULT? **NO**

Not the softer NOT ENOUGH EVIDENCE: this phase did not merely fail to find sufficient positive evidence, it found two concrete, live, reproduced instances of real harm (genuinely useful implementation guidance excluded from delivered context for a false reason) on content no prior phase had touched. That is an observed failure mode, the same standard 2C.8 used to justify its own NO over a softer verdict. `packages/mcp/src/bootstrap.ts` remains `{ enabled: false, ...DEFAULT_NEAR_DUPLICATE_POLICY }` and should stay that way.

## LEARNING READINESS: **NOT READY**

Unchanged from every prior phase. This phase adds 25 more correlated task contexts (144 feedback events, 25/25 outcomes, 100% labeledFraction) to the project's cumulative real dataset, but every outcome this round was `success` (no failure signal to learn a contrast from), no learning mechanism exists in the codebase, and none was implemented, prototyped, or scaffolded here, per instruction.

## TEST COUNTS

| | Result |
|---|---|
| `npm run typecheck` | clean, all workspaces |
| `npm run build` | clean, all workspaces |
| `npm test` | **395/395**, 0 failing — byte-identical to the 2C.10 baseline (evaluation 68, gateway 33, knowledge 9, mcp 20, storage 51, compression 7, context 29, contracts 53, learning 2, memory 1, ranking 23, retrieval 50, test-fixtures 23, token 26) |
| `npm audit` | 0 vulnerabilities |
| `packages/storage` `test:integration` | 3/3, values unchanged (0.8037/0.5423/0.3667) |
| `packages/evaluation` `test:integration` | 2/2, unchanged |

No test file was added, removed, or modified this phase — confirmed by `git status` matching the 2C.10 end-state exactly, with `.pilot-tmp/` (deleted at cleanup) the only addition beyond this report.

## RISKS

- **Small sample.** n=7 candidate pairs, 3 positive predictions. The 0.3333 precision figure is real but should not be read as a stable population-level rate any more than 2C.9's 1.0000 should have been — both are honest reports of the evidence actually collected, not proof of a general rate.
- **Single-agent labeling.** The same agent that authored the 22 memories also performed the human-label review. This is the same limitation 2C.8 carried (it was also agent-run end to end); it is disclosed here rather than presented as independent, blind labeling.
- **One genuinely borderline case.** Email~SMS is disclosed as close to the DISTINCT/AMBIGUOUS line; a different reviewer could reasonably score it AMBIGUOUS (removing it from the FP count) or even confirm it as NEAR_DUPLICATE outright. The frozen, content-first label (DISTINCT) is used as scored, with the tension disclosed rather than resolved by re-labeling toward a cleaner-looking result.
- **A new failure *shape*, not the old one.** Both false positives this phase are structurally different from 2C.8's original two (which were pure `≥0.80` cosine-bypass failures, the exact thing H2 was built to fix). These two both sit inside H2's corroboration band (containment 0.40 and 0.6667, both ≥ the 0.40 bar) — meaning containment itself, not the removed bypass, is what let them through. That is a distinct, previously-uncharacterized risk: structurally-parallel CRUD-style operations on a small shared vocabulary (channel-swap, reserve/release-style inverse pairs) can share enough tokens to clear containment even when a content reviewer judges them non-redundant.
- **No production change was made or considered** in response to this finding, per instruction (`containmentThreshold` was not tuned). The finding is reported, not acted on.

## RECOMMENDED NEXT STEP

Do not enable by default (unchanged from every prior phase). This phase's most useful output is not a breadth confirmation but a new, disclosed failure shape: containment-band false positives on structurally-parallel same-vocabulary operations, distinct from the `≥0.80`-bypass failures 2C.8 found and H2 already fixes. Before any further breadth pilot chasing the ≥5-pairs/≥3-projects target, a focused offline characterization phase (2C.9-style: retrospective, no new production code) should specifically collect more pairs of this *shape* — paired CRUD-like operations sharing a small domain vocabulary (create/cancel/discount, reserve/release, channel-swapped sends) — across a larger and more independently-labeled sample, before concluding whether containment's 0.40 bar needs to consider anything beyond raw token overlap for this specific pattern. That is future work, not scheduled by this phase.

STOP. H2 is not modified. Redundancy is not enabled by default.
