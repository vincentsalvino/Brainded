import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate, RankedResult } from "@brain/contracts";
import { rank } from "@brain/ranking";
import { RetrievalService, type NearDuplicatePolicy } from "@brain/retrieval";
import { compileContext } from "@brain/context";
import { optimizeContext, estimateTokens } from "@brain/token";
import { openDatabase, SqliteMemoryRepository, SqliteRetrievalStore } from "@brain/storage";
import { FakeEmbeddingProvider } from "@brain/test-fixtures";
import { loadDataset } from "./dataset.js";
import { computeEfficiencyMetrics, type DeliveredItemMeasurement } from "./efficiency.js";
import type { EvalExample } from "./types.js";

const DATASET = join(dirname(fileURLToPath(import.meta.url)), "..", "datasets", "phase1-realworld.jsonl");
const CANDIDATE_LIMIT = 50;

/**
 * 2C.7: this whole file predates the hybrid policy and tests a single
 * cosine-like threshold against FakeEmbeddingProvider's own similarity
 * scale (not real cosine). containmentThreshold: 0 collapses H2 back to
 * that exact plain-threshold check -- containmentCoefficient() never
 * returns a value below 0, so the containment gate is always satisfied
 * and only candidateFloor decides, preserving every assertion below
 * unchanged (2C.10: this replaces the old candidateFloor ===
 * highConfidenceThreshold trick, which relied on a bypass that no longer
 * exists).
 */
function simplePolicy(threshold: number): NearDuplicatePolicy {
  return { candidateFloor: threshold, containmentThreshold: 0 };
}

interface Seeded {
  db: ReturnType<typeof openDatabase>;
  retrievalService: RetrievalService;
  keyById: Map<string, string>;
  idByKey: Map<string, string>;
  close: () => void;
}

async function seed(example: EvalExample): Promise<Seeded> {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const repo = new SqliteMemoryRepository(db.raw, embeddings);
  const store = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable);
  const keyById = new Map<string, string>();
  const idByKey = new Map<string, string>();

  for (const memory of example.memories) {
    const record = await repo.create({ type: memory.type, content: memory.content, scope: memory.scope, confidence: memory.confidence });
    keyById.set(record.id, memory.key);
    idByKey.set(memory.key, record.id);
  }

  return { db, retrievalService: new RetrievalService(store), keyById, idByKey, close: () => db.close() };
}

async function rankedFor(seeded: Seeded, example: EvalExample): Promise<RankedResult[]> {
  const candidates: Candidate[] = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
  return rank({ candidates, task: example.task });
}

// --- Part 1: threshold sweep, using FakeEmbeddingProvider (deterministic,
// network-free -- the DEFAULT test suite). Real-model values are validated
// separately, in packages/storage's integration-only suite (Task 9), since
// FakeEmbeddingProvider's trigram-hash similarity operates on a different
// numeric scale than the real model (confirmed by the sweep below: the known
// pair scores in [0.55, 0.6) under the fake provider).

// Starts at 0.4, deliberately above the measured distinct-pair ceiling. The
// sweep below only confirms notes-repo-constraint's similarity against either
// plural rule is < 0.4 (it never appears at any swept threshold, including
// the floor) -- not a specific value above that. A lower starting value would
// make the distinctPairFound assertion below fail by construction (the
// distinct pair would show up at that low a floor regardless of detection
// quality), not reveal a real defect.
const THRESHOLDS = [0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8];

test("threshold sweep: notes-api-db-refactor -- known redundant pair vs distinct repository/database knowledge", async () => {
  const example = loadDataset(DATASET).find((e) => e.id === "notes-api-db-refactor");
  assert.ok(example);
  const seeded = await seed(example);
  try {
    const rankedResults = await rankedFor(seeded, example);
    const redundantKey = "global-plural-rule";
    const subsumingKey = "notes-plural-rule";
    const distinctKey = "notes-repo-constraint";

    const report: { threshold: number; redundantPairFound: boolean; distinctPairFound: boolean }[] = [];
    for (const threshold of THRESHOLDS) {
      const pairs = await seeded.retrievalService.getRedundancyPairs(rankedResults, simplePolicy(threshold));
      const named = pairs.map((p) => [seeded.keyById.get(p.a), seeded.keyById.get(p.b)]);
      report.push({
        threshold,
        redundantPairFound: named.some(([a, b]) => (a === subsumingKey && b === redundantKey) || (a === redundantKey && b === subsumingKey)),
        distinctPairFound: named.some(([a, b]) => [a, b].includes(distinctKey)),
      });
    }
    console.log("\nthreshold sweep (notes-api-db-refactor, FakeEmbeddingProvider):");
    for (const row of report) console.log(`  τ=${row.threshold}  redundantPairFound=${row.redundantPairFound}  distinctPairFalselyFlagged=${row.distinctPairFound}`);

    // The known pair must be detectable at SOME threshold in this range, and
    // the distinct memory must never be falsely collapsed into it at any
    // threshold in this range (acceptance criteria 6 and 7).
    assert.ok(report.some((r) => r.redundantPairFound), "no threshold in the sweep detected the known redundant pair");
    assert.ok(report.every((r) => !r.distinctPairFound), "a threshold in the sweep falsely flagged the distinct repository/database memory as redundant");
  } finally {
    seeded.close();
  }
});

test("threshold sweep: task-api-completed-filter -- the task-sqlite/task-express pair must not be falsely collapsed at the working threshold", async () => {
  // A tighter margin than notes-api-db-refactor -- this example specifically
  // exercises acceptance criterion 7 at a realistic margin, not just a wide one.
  const example = loadDataset(DATASET).find((e) => e.id === "task-api-completed-filter");
  assert.ok(example);
  const seeded = await seed(example);
  try {
    const rankedResults = await rankedFor(seeded, example);
    const pairs = await seeded.retrievalService.getRedundancyPairs(rankedResults, simplePolicy(0.55));
    const named = pairs.map((p) => [seeded.keyById.get(p.a), seeded.keyById.get(p.b)].sort());
    assert.ok(
      named.some(([a, b]) => a === "task-repo-constraint" && b === "task-repo-decision"),
      "the declared redundant pair (task-repo-decision -> task-repo-constraint) must be found at τ=0.55",
    );
    assert.ok(
      !named.some(([a, b]) => (a === "task-express" && b === "task-sqlite")),
      "task-sqlite/task-express are distinct memories (both graded 1, no redundantWith edge) and must not be flagged at τ=0.55",
    );
  } finally {
    seeded.close();
  }
});

// --- Part 2: A' vs C' -- ranking metrics unaffected, efficiency metrics compared.

const REDUNDANCY_THRESHOLD = 0.45; // mid-sweep value informed by Part 1 for THIS dataset/embedding provider; NOT the production default (see gateway.ts's DEFAULT_REDUNDANCY_THRESHOLD, tuned for the real model's scale).
const BUDGET = { maxTokens: 500 };

// Returns ranked memory keys only -- the sole thing any caller of this helper
// reads. (Delivered-item labels and candidate token totals are computed
// separately, inline, by the tests that actually need them -- see the A' vs
// C' efficiency comparison below.)
async function runPipeline(seeded: Seeded, example: EvalExample, useRedundancy: boolean): Promise<string[]> {
  const candidates = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
  const rankedResults = rank({ candidates, task: example.task });
  const redundancyPairs = useRedundancy ? await seeded.retrievalService.getRedundancyPairs(rankedResults, simplePolicy(REDUNDANCY_THRESHOLD)) : [];
  const compiled = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs });
  const pack = optimizeContext(compiled, BUDGET);
  return pack.items.map((i) => seeded.keyById.get(i.memoryId) ?? i.memoryId);
}

test("C' ranking metrics do not materially regress vs A' -- same top-ranked key on every seed example", async () => {
  const examples = loadDataset(DATASET).filter((e) => !e.id.startsWith("isolation-"));
  for (const example of examples) {
    const seeded = await seed(example);
    try {
      const aPrime = await runPipeline(seeded, example, false);
      const cPrime = await runPipeline(seeded, example, true);
      assert.equal(cPrime[0], aPrime[0], `${example.id}: C' must not change the top-ranked item`);
    } finally {
      seeded.close();
    }
  }
});

test("no-redundancy regression: a below-threshold example produces byte-identical compiled output between A' and C'", async () => {
  // task-api-convention-check declares no redundantWith edges, and its three
  // memories (global naming rule / repo constraint / SQLite decision) are on
  // unrelated topics -- proves demoted-vs-not is the only degree of freedom
  // redundancy adds, not a general reordering, against a REAL, computed empty
  // pairs result (not compileContext's own undefined/[] default, which would
  // make this a tautology regardless of whether detection works).
  const example = loadDataset(DATASET).find((e) => e.id === "task-api-convention-check");
  assert.ok(example);
  const seeded = await seed(example);
  try {
    const candidates = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
    const rankedResults = rank({ candidates, task: example.task });
    const pairs = await seeded.retrievalService.getRedundancyPairs(rankedResults, simplePolicy(REDUNDANCY_THRESHOLD));
    assert.deepEqual(pairs, [], "this example must produce no redundancy pairs at the working threshold");

    const withoutPairs = compileContext({ task: example.task, scope: example.scope, rankedResults });
    const withComputedPairs = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs: pairs });
    assert.deepEqual(withComputedPairs, withoutPairs);
  } finally {
    seeded.close();
  }
});

test("global memory regression: task-api-convention-check still ranks the global rule first under C'", async () => {
  // Decision E9's forbidden rule ("project always beats global") would fail
  // this example under ANY redundancy configuration, since there is no
  // project rule to prefer over it.
  const example = loadDataset(DATASET).find((e) => e.id === "task-api-convention-check");
  assert.ok(example);
  const seeded = await seed(example);
  try {
    const cPrime = await runPipeline(seeded, example, true);
    assert.equal(cPrime[0], "global-plural-rule");
  } finally {
    seeded.close();
  }
});

test("vector-degradation regression: findSimilarPairs unavailable degrades the whole pipeline to A', no error", async () => {
  const example = loadDataset(DATASET).find((e) => e.id === "notes-api-db-refactor");
  assert.ok(example);
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const repo = new SqliteMemoryRepository(db.raw, embeddings);
  const keyById = new Map<string, string>();
  for (const memory of example.memories) {
    const record = await repo.create({ type: memory.type, content: memory.content, scope: memory.scope, confidence: memory.confidence });
    keyById.set(record.id, memory.key);
  }
  // vectorSearchAvailable: false -- simulates sqlite-vec failing to load.
  const store = new SqliteRetrievalStore(db.raw, embeddings, false);
  const retrievalService = new RetrievalService(store);
  const candidates = await retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
  const rankedResults = rank({ candidates, task: example.task });
  const pairs = await retrievalService.getRedundancyPairs(rankedResults, simplePolicy(REDUNDANCY_THRESHOLD));
  assert.deepEqual(pairs, []);
  const compiled = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs: pairs });
  assert.ok(compiled.items.length > 0, "guard against a vacuous pass: this example's 3 memories must actually reach the compiler");
  for (const item of compiled.items) assert.equal("redundantWith" in item, false);
  db.close();
});

test("CONSTRAINED BUDGET: the demoted member of the plural-rule pair is omitted under a tight budget, and reappears once budget is ample", async () => {
  // Deliberately does not assume WHICH of the two near-duplicate plural-rule
  // memories (project-scoped vs global) the corrected ranker places higher --
  // that depends on real lexical/semantic scores for this exact query text,
  // which this test does not hardcode a prediction for. It reads which one
  // toRedundancyPairs actually demoted from the compiler's own output, then
  // asserts the constrained-budget property on THAT outcome.
  const example = loadDataset(DATASET).find((e) => e.id === "notes-api-search-endpoint");
  assert.ok(example, "expects the 3-memory example: two near-duplicate plural-rule memories plus one distinct relevant memory");
  const seeded = await seed(example);
  try {
    const candidates = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
    const rankedResults = rank({ candidates, task: example.task });
    const redundancyPairs = await seeded.retrievalService.getRedundancyPairs(rankedResults, simplePolicy(REDUNDANCY_THRESHOLD));
    const compiled = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs });

    const distinctId = seeded.idByKey.get("notes-repo-constraint") as string;
    const demotedItems = compiled.items.filter((i) => i.redundantWith !== undefined);
    assert.equal(
      demotedItems.length,
      1,
      "the two near-duplicate plural-rule memories must produce exactly one demotion at this threshold, and the distinct constraint must never be demoted",
    );
    const demotedItem = demotedItems[0];
    const demotedId = demotedItem?.memoryId as string;
    const keptPluralRuleId = demotedItem?.redundantWith as string;
    assert.ok(
      [seeded.idByKey.get("notes-plural-rule"), seeded.idByKey.get("global-plural-rule")].includes(demotedId),
      "the demotion must be between the two plural-rule memories, not the distinct constraint",
    );
    assert.notEqual(keptPluralRuleId, distinctId, "the demotion must point at the other plural-rule memory, never at the distinct constraint");

    const distinctCost = estimateTokens(compiled.items.find((i) => i.memoryId === distinctId)?.content ?? "");
    const keptCost = estimateTokens(compiled.items.find((i) => i.memoryId === keptPluralRuleId)?.content ?? "");
    const demotedCost = estimateTokens(demotedItem?.content ?? "");

    // Tight budget: fits exactly the two non-redundant items, not the third.
    const tight = optimizeContext(compiled, { maxTokens: distinctCost + keptCost });
    const tightIds = tight.items.map((i) => i.memoryId);
    assert.ok(tightIds.includes(distinctId), "distinct relevant memory must be included under a tight budget");
    assert.ok(tightIds.includes(keptPluralRuleId), "the higher-ranked plural-rule memory must be included under a tight budget");
    assert.ok(!tightIds.includes(demotedId), "the demoted plural-rule memory must be OMITTED before unique relevant context under a tight budget");

    // A' control: without redundancy demotion, does the SAME tight budget
    // still happen to omit this item by natural rank order alone? Reported,
    // not asserted -- isolates whether demotion is doing causal work here, or
    // the tight-budget omission above is coincidental (same "observe and
    // report" discipline as the A' vs C' efficiency comparison below).
    const aPrimeCompiled = compileContext({ task: example.task, scope: example.scope, rankedResults });
    const aPrimeTight = optimizeContext(aPrimeCompiled, { maxTokens: distinctCost + keptCost }).items.map((i) => i.memoryId);
    console.log(`  A' tight: ${aPrimeTight}  C' tight: ${tightIds}`);

    // Ample budget: the demoted memory may appear again -- proving demoted != deleted.
    const ample = optimizeContext(compiled, { maxTokens: distinctCost + keptCost + demotedCost + 10 });
    assert.ok(ample.items.map((i) => i.memoryId).includes(demotedId), "the demoted memory must still be returned once budget is ample");
  } finally {
    seeded.close();
  }
});

test("REAL PILOT REGRESSION: project naming rule survives a constrained budget, repository constraint survives, redundant global rule is demoted/omitted (docs/phase-2c/PHASE_2C_PILOT_REPORT.md, 2C.1)", async () => {
  // Recreates the real Phase 2C pilot fixture verbatim (same task text, same
  // three memory contents). In the real pilot, the global duplicate outranked
  // the project rule on raw relevance and rank-only orientation demoted the
  // PROJECT memory instead -- unlike the pre-existing CONSTRAINED BUDGET test
  // above, this one hardcodes the expected direction, because 2C.1's
  // scope-aware anchor preference now guarantees it regardless of rank.
  const example = loadDataset(DATASET).find((e) => e.id === "phase2c-pilot-redundancy-regression");
  assert.ok(example, "expects the real-pilot-recreation example: project naming rule + project repo constraint + redundant global naming rule");
  const seeded = await seed(example);
  try {
    const candidates = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
    const rankedResults = rank({ candidates, task: example.task });
    const redundancyPairs = await seeded.retrievalService.getRedundancyPairs(rankedResults, simplePolicy(REDUNDANCY_THRESHOLD));
    const compiled = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs });

    const projectNamingId = seeded.idByKey.get("project-naming-rule") as string;
    const repoConstraintId = seeded.idByKey.get("project-repo-constraint") as string;
    const globalNamingId = seeded.idByKey.get("global-naming-rule") as string;

    const demoted = compiled.items.filter((i) => i.redundantWith !== undefined);
    assert.equal(demoted.length, 1, "exactly one memory should be demoted in this 3-memory cluster");
    assert.equal(demoted[0]?.memoryId, globalNamingId, "the GLOBAL naming rule must be the demoted one, never the project rule");
    assert.equal(demoted[0]?.redundantWith, projectNamingId, "the project rule must be the anchor the global rule is demoted behind");

    const projectCost = estimateTokens(compiled.items.find((i) => i.memoryId === projectNamingId)?.content ?? "");
    const repoCost = estimateTokens(compiled.items.find((i) => i.memoryId === repoConstraintId)?.content ?? "");
    const globalCost = estimateTokens(demoted[0]?.content ?? "");

    // Tight budget: fits exactly the two non-redundant items, not the third.
    const tight = optimizeContext(compiled, { maxTokens: projectCost + repoCost });
    const tightIds = tight.items.map((i) => i.memoryId);
    assert.ok(tightIds.includes(projectNamingId), "project naming rule must survive the constrained budget");
    assert.ok(tightIds.includes(repoConstraintId), "repository constraint must survive the constrained budget");
    assert.ok(!tightIds.includes(globalNamingId), "redundant global naming rule must be demoted/omitted under the constrained budget");

    // Ample budget: the demoted global rule may reappear -- demoted != deleted.
    const ample = optimizeContext(compiled, { maxTokens: projectCost + repoCost + globalCost + 10 });
    assert.ok(ample.items.map((i) => i.memoryId).includes(globalNamingId), "the demoted global rule must still be returned once budget is ample");
  } finally {
    seeded.close();
  }
});

/**
 * A' vs C' efficiency comparison. Deliberately does NOT hard-assert a
 * directional winner: P2-018 (PHASE_2_SPEC.md 20) treats "does C' actually
 * improve efficiency" as an empirical question whose answer decides whether
 * redundancy ships enabled -- "if B and C do not beat A', they ship
 * disabled... with the result recorded," not a property to bake into a
 * pass/fail gate before ever observing it. Two reasons a hard inequality
 * would be actively wrong here, not just unproven:
 *   1. Under A' (useRedundancy=false), no item is ever labeled "redundant"
 *      (item.redundantWith is never set) -- A' structurally always reports
 *      redundantRatio ~0/null, so "C' redundantRatio <= A' redundantRatio"
 *      does not test what it sounds like it tests.
 *   2. Under an AMPLE budget, both strategies deliver the same candidate SET
 *      (order/labels differ, membership does not), so contextEfficiency is
 *      often identical between them by construction -- any real effect is a
 *      CONSTRAINED-budget phenomenon (already isolated deterministically by
 *      the CONSTRAINED BUDGET test above).
 *
 * This test instead reports both budgets' real numbers (captured for
 * docs/phase-2c/PHASE_2C_FINDINGS.md, Task 9) and asserts only what is actually
 * guaranteed: the metrics are well-formed and the hand-labeled seed dataset
 * yields a near-complete labeledFraction.
 */
test("A' vs C' efficiency comparison over the seed dataset (ample and constrained budgets, reported)", async () => {
  const examples = loadDataset(DATASET).filter((e) => !e.id.startsWith("isolation-"));

  async function totals(budgetTokens: number, useRedundancy: boolean) {
    const delivered: DeliveredItemMeasurement[] = [];
    let candidateTokenTotal = 0;
    for (const example of examples) {
      const seeded = await seed(example);
      try {
        const candidates = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
        const rankedResults = rank({ candidates, task: example.task });
        const redundancyPairs = useRedundancy ? await seeded.retrievalService.getRedundancyPairs(rankedResults, simplePolicy(REDUNDANCY_THRESHOLD)) : [];
        const compiled = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs });
        const pack = optimizeContext(compiled, { maxTokens: budgetTokens });
        for (const item of pack.items) {
          const key = seeded.keyById.get(item.memoryId) ?? item.memoryId;
          const grade = example.labels[key];
          const label: DeliveredItemMeasurement["label"] =
            item.redundantWith !== undefined ? "redundant" : grade === undefined ? "unlabeled" : grade > 0 ? "useful" : "not_useful";
          delivered.push({ memoryId: item.memoryId, tokenCount: estimateTokens(item.content), label });
        }
        for (const c of candidates) candidateTokenTotal += estimateTokens(c.record.content);
      } finally {
        seeded.close();
      }
    }
    return computeEfficiencyMetrics({ delivered, candidateTokenCount: candidateTokenTotal });
  }

  const ampleAPrime = await totals(2000, false);
  const ampleCPrime = await totals(2000, true);
  const constrainedAPrime = await totals(60, false); // 60: tight enough to force selection in every seed example
  const constrainedCPrime = await totals(60, true);

  console.log(`\nA' vs C' efficiency (seed dataset, τ=${REDUNDANCY_THRESHOLD}):`);
  console.log("  ample (2000 tok)      A'", JSON.stringify(ampleAPrime));
  console.log("  ample (2000 tok)      C'", JSON.stringify(ampleCPrime));
  console.log("  constrained (60 tok)  A'", JSON.stringify(constrainedAPrime));
  console.log("  constrained (60 tok)  C'", JSON.stringify(constrainedCPrime));

  for (const m of [ampleAPrime, ampleCPrime, constrainedAPrime, constrainedCPrime]) {
    assert.ok(m.labeledFraction !== null && m.labeledFraction > 0.9, "seed dataset is hand-labeled; labeledFraction should be near 1.0");
    if (m.contextEfficiency !== null) assert.ok(m.contextEfficiency >= 0 && m.contextEfficiency <= 1);
    if (m.redundantRatio !== null) assert.ok(m.redundantRatio >= 0 && m.redundantRatio <= 1);
    if (m.retrievalEfficiency !== null) assert.ok(m.retrievalEfficiency >= 0 && m.retrievalEfficiency <= 1);
  }
});
