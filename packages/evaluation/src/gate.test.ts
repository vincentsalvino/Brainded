import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate, MemoryRecord, ScopeRef } from "@brain/contracts";
import { rank } from "@brain/ranking";
import { RetrievalService, mergeCandidates } from "@brain/retrieval";
import { openDatabase, SqliteMemoryRepository, SqliteRetrievalStore } from "@brain/storage";
import { FakeEmbeddingProvider } from "@brain/test-fixtures";
import { loadDataset } from "./dataset.js";
import { evaluate, formatComparison } from "./evaluate.js";
import type { EvalExample } from "./types.js";

/**
 * P2-009 -- THE GATE.
 *
 * Strategy A  = shipped Phase 1 behaviour: lexicalScore = 1/(1+|bm25|),
 *               semanticScore = 1/(1+distance). No learning.
 * Strategy A' = P2-002 corrections: signals negated so they increase with match
 *               quality, then per-query min-max normalized. No learning.
 *
 * Both then run the SAME unmodified pure rank(). The ONLY difference is the
 * signal transform -- rank() is untouched by Phase 2A, so any metric difference
 * is attributable to the storage-layer signal and nothing else.
 *
 * A' is measured through the REAL production path (RetrievalService over
 * SqliteRetrievalStore), not a reimplementation of it. A is measured through a
 * legacy transform preserved below purely for comparison; it is the only copy of
 * the old formula left in the repo and exists so the control is a real control.
 *
 * Everything is in-memory and offline: FakeEmbeddingProvider, ':memory:' SQLite,
 * memories declared by the dataset. data/brain.db is never opened.
 */

const DATASET = join(dirname(fileURLToPath(import.meta.url)), "..", "datasets", "phase1-realworld.jsonl");
const CANDIDATE_LIMIT = 50;

interface Seeded {
  db: ReturnType<typeof openDatabase>;
  store: SqliteRetrievalStore;
  keyById: Map<string, string>;
  close: () => void;
}

async function seed(example: EvalExample): Promise<Seeded> {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const repo = new SqliteMemoryRepository(db.raw, embeddings);
  const keyById = new Map<string, string>();

  for (const memory of example.memories) {
    const record = await repo.create({
      type: memory.type,
      content: memory.content,
      scope: memory.scope,
      confidence: memory.confidence,
    });
    keyById.set(record.id, memory.key);
  }

  return {
    db,
    store: new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable),
    keyById,
    close: () => db.close(),
  };
}

// --- Strategy A: the shipped Phase 1 transform, preserved for comparison -----

interface MemoryRow {
  id: string;
  content: string;
  scope_kind: string;
  scope_id: string | null;
  confidence: number;
}

/** Same query construction as production's buildFtsQuery (not exported from storage). */
function buildFtsQuery(text: string): string {
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '""'))
    .filter((t) => t.length > 0);
  return terms.length === 0 ? '""' : terms.map((t) => `"${t}"`).join(" OR ");
}

function scopeClause(scope: ScopeRef): { clause: string; params: unknown[] } {
  if (scope.kind === "global") return { clause: "scope_kind = 'global'", params: [] };
  return {
    clause: "(scope_kind = 'global' OR (scope_kind = ? AND scope_id = ?))",
    params: [scope.kind, scope.id],
  };
}

function asRecord(row: MemoryRow): MemoryRecord {
  // Only the fields rank() and the metrics actually read. This is a measurement
  // harness, not a second implementation of the repository.
  return {
    id: row.id,
    type: "fact",
    content: row.content,
    domain: null,
    scope: { kind: row.scope_kind as ScopeRef["kind"], id: row.scope_id },
    source: { origin: "system" },
    confidence: row.confidence,
    status: "active",
    tags: [],
    supersedes: null,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

async function legacyCandidates(seeded: Seeded, example: EvalExample): Promise<Candidate[]> {
  const where = scopeClause(example.scope);

  const lexRows = seeded.db.raw
    .prepare(
      `SELECT m.id, m.content, m.scope_kind, m.scope_id, m.confidence, memories_fts.rank AS fts_rank
       FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
       WHERE memories_fts MATCH ? AND ${where.clause}
       ORDER BY memories_fts.rank LIMIT ?`,
    )
    .all(buildFtsQuery(example.task), ...where.params, CANDIDATE_LIMIT) as (MemoryRow & { fts_rank: number })[];

  // THE PHASE 1 FORMULA. FTS5 rank is negative and more-negative means better, so
  // Math.abs() makes this monotonically DECREASING in match quality.
  const lexical: Candidate[] = lexRows.map((row) => ({
    memoryId: row.id,
    record: asRecord(row),
    signals: { lexicalScore: 1 / (1 + Math.abs(row.fts_rank)) },
  }));

  let semantic: Candidate[] = [];
  if (seeded.db.vectorSearchAvailable) {
    const queryVector = await new FakeEmbeddingProvider().embed(example.task);
    const knn = seeded.db.raw
      .prepare(`SELECT memory_id, distance FROM memory_vectors WHERE embedding MATCH ? AND k = ? ORDER BY distance`)
      .all(JSON.stringify(queryVector), CANDIDATE_LIMIT) as { memory_id: string; distance: number }[];

    if (knn.length > 0) {
      const placeholders = knn.map(() => "?").join(",");
      const rows = seeded.db.raw
        .prepare(
          `SELECT id, content, scope_kind, scope_id, confidence FROM memories
           WHERE id IN (${placeholders}) AND ${where.clause}`,
        )
        .all(...knn.map((k) => k.memory_id), ...where.params) as MemoryRow[];
      const byId = new Map(rows.map((r) => [r.id, r]));
      semantic = knn
        .filter((k) => byId.has(k.memory_id))
        .map((k) => ({
          memoryId: k.memory_id,
          record: asRecord(byId.get(k.memory_id) as MemoryRow),
          // THE PHASE 1 FORMULA: correctly directed, but confined to [0.333, 1]
          // for L2-normalized embeddings.
          signals: { semanticScore: 1 / (1 + k.distance) },
        }));
    }
  }

  return mergeCandidates(lexical, semantic);
}

// --- strategies -------------------------------------------------------------

function toKeys(seeded: Seeded, candidates: Candidate[], task: string): string[] {
  return rank({ candidates, task })
    .map((result) => seeded.keyById.get(result.memoryId))
    .filter((key): key is string => key !== undefined);
}

async function strategyA(example: EvalExample): Promise<string[]> {
  const seeded = await seed(example);
  try {
    return toKeys(seeded, await legacyCandidates(seeded, example), example.task);
  } finally {
    seeded.close();
  }
}

async function strategyAPrime(example: EvalExample): Promise<string[]> {
  const seeded = await seed(example);
  try {
    const retrieval = new RetrievalService(seeded.store);
    const candidates = await retrieval.getCandidates({
      text: example.task,
      scope: example.scope,
      limit: CANDIDATE_LIMIT,
    });
    return toKeys(seeded, candidates, example.task);
  } finally {
    seeded.close();
  }
}

// --- the gate ---------------------------------------------------------------

test("P2-009 GATE: strategy A vs A' over the Phase 1 real-world dataset", async () => {
  const examples = loadDataset(DATASET);
  assert.ok(examples.length > 0, "dataset must not be empty");

  const reportA = await evaluate(examples, strategyA, { name: "A" });
  const reportAPrime = await evaluate(examples, strategyAPrime, { name: "A-prime" });

  console.log("\n" + formatComparison([reportA, reportAPrime]) + "\n");

  // The gate's own question, asserted rather than eyeballed.
  const findingB = "notes-api-db-refactor";
  const a = reportA.perExample.find((r) => r.exampleId === findingB);
  const aPrime = reportAPrime.perExample.find((r) => r.exampleId === findingB);
  assert.ok(a && aPrime);

  // Control check: strategy A must still reproduce the observed failure -- a
  // grade-0 endpoint-naming memory outranking the grade-2 repository constraint.
  // Asserted on the GRADE, not on which of the two naming memories wins: they tie
  // on lexical score under the old formula, so the winner is decided by the
  // embedding provider. The dataset uses the deterministic FakeEmbeddingProvider
  // and picks global-plural-rule; the live corpus, with the real model, picked
  // notes-plural-rule. Pinning either would test the fixture, not the finding.
  assert.equal(a.topGrade, 0, "strategy A must still put a non-useful memory first");
  assert.ok(
    a.topKey === "notes-plural-rule" || a.topKey === "global-plural-rule",
    `strategy A must still top-rank an endpoint-naming memory, got ${a.topKey}`,
  );
  assert.equal(
    aPrime.topKey,
    "notes-repo-constraint",
    "A' must rank the repository/database constraint first -- this is the observed failure, fixed",
  );

  // Every report must carry its own honesty label.
  assert.equal(reportAPrime.significance, "INDICATIVE");
  assert.ok(reportAPrime.labeledObservationCount > 0);
});

test("P2-009: scope isolation holds under both strategies", async () => {
  const examples = loadDataset(DATASET).filter((e) => e.id.startsWith("isolation-"));
  assert.equal(examples.length, 2, "both isolation directions must be exercised");

  for (const strategy of [strategyA, strategyAPrime]) {
    for (const example of examples) {
      const ranked = await strategy(example);
      const leaked = ranked.filter((key) => (example.labels[key] ?? 0) === 0);
      assert.deepEqual(leaked, [], `${example.id}: another scope's record must never be returned`);
    }
  }
});

test("P2-009: A' does not win by demoting global knowledge", async () => {
  // The counterexample that forbids "project always beats global": task-api has no
  // project-level naming rule, so the global memory is the single correct answer.
  const example = loadDataset(DATASET).find((e) => e.id === "task-api-convention-check");
  assert.ok(example);
  assert.equal(
    (await strategyAPrime(example))[0],
    "global-plural-rule",
    "a global memory must still rank first when it is the only relevant one",
  );
});

test("P2-009: the evaluation package declares no production dependency on storage", async () => {
  const pkg = (await import("node:fs")).readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf-8",
  );
  const parsed = JSON.parse(pkg) as { dependencies: Record<string, string> };
  assert.deepEqual(
    Object.keys(parsed.dependencies).sort(),
    ["@brain/contracts", "zod"],
    "storage/ranking/retrieval are devDependencies used by this harness only -- never shipped",
  );
});
