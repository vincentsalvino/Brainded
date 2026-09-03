import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CandidateSchema,
  RankedResultSchema,
  RankingWeightsSchema,
  RankingInputSchema,
  CandidatePerformanceSchema,
  RankingLearningConfigSchema,
} from "./retrieval.js";
import { ContextPackSchema, ContextItemSchema, CompileContextInputSchema, CompiledContextSchema } from "./context.js";
import {
  RetrievalEventSchema,
  ContextEventSchema,
  OutcomeEventSchema,
  FeedbackEventSchema,
  MemoryMutationEventSchema,
  ContextEventMemorySchema,
  ContextEventSourceSchema,
  FEEDBACK_REASONS,
  assertContextMembershipConsistent,
} from "./events.js";
import { globalScope } from "./scope.js";
import { SimilarityPairSchema, sortSimilarityPairs } from "./signals.js";

function baseMemoryRecord() {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    type: "fact",
    content: "example",
    domain: null,
    scope: globalScope(),
    source: { origin: "system" },
    confidence: 0.5,
    status: "active",
    tags: [],
    supersedes: null,
    createdAt: now,
    updatedAt: now,
  };
}

test("Candidate: accepts partial signal scores and rejects unknown fields", () => {
  const candidate = CandidateSchema.parse({
    memoryId: randomUUID(),
    record: baseMemoryRecord(),
    signals: { lexicalScore: 0.8 },
  });
  assert.equal(candidate.signals.lexicalScore, 0.8);
  assert.throws(() =>
    CandidateSchema.parse({ memoryId: randomUUID(), record: baseMemoryRecord(), signals: {}, bogus: true }),
  );
});

test("RankedResult: diversity signal defaults to null (reserved, unused in Phase 1 -- D7)", () => {
  const ranked = RankedResultSchema.parse({
    memoryId: randomUUID(),
    record: baseMemoryRecord(),
    score: 0.9,
    signals: {},
    rank: 1,
  });
  assert.equal(ranked.signals.diversity, null);
});

test("RankingWeights: rejects negative weights", () => {
  assert.throws(() => RankingWeightsSchema.parse({ lexical: -0.1, semantic: 0.5, tag: 0.2 }));
});

// --- Phase 4.2: Candidate.performance / RankingInput.learning --------------

test("Candidate: performance omitted entirely still parses (backward compatibility, Task 8)", () => {
  const candidate = CandidateSchema.parse({
    memoryId: randomUUID(),
    record: baseMemoryRecord(),
    signals: { lexicalScore: 0.8 },
  });
  assert.equal("performance" in candidate, false);
});

test("Candidate: performance: null is accepted explicitly", () => {
  const candidate = CandidateSchema.parse({
    memoryId: randomUUID(),
    record: baseMemoryRecord(),
    signals: {},
    performance: null,
  });
  assert.equal(candidate.performance, null);
});

test("Candidate: a valid performance object is accepted", () => {
  const candidate = CandidateSchema.parse({
    memoryId: randomUUID(),
    record: baseMemoryRecord(),
    signals: {},
    performance: { usefulnessSignal: 0.7, evidenceMass: 12 },
  });
  assert.equal(candidate.performance?.usefulnessSignal, 0.7);
  assert.equal(candidate.performance?.evidenceMass, 12);
});

test("CandidatePerformance: rejects usefulnessSignal outside [0, 1]", () => {
  assert.throws(() => CandidatePerformanceSchema.parse({ usefulnessSignal: 1.1, evidenceMass: 0 }));
  assert.throws(() => CandidatePerformanceSchema.parse({ usefulnessSignal: -0.1, evidenceMass: 0 }));
});

test("CandidatePerformance: rejects a negative evidenceMass", () => {
  assert.throws(() => CandidatePerformanceSchema.parse({ usefulnessSignal: 0.5, evidenceMass: -1 }));
});

test("RankingInput: learning omitted entirely still parses (disabled semantics, backward compatibility)", () => {
  const input = RankingInputSchema.parse({ candidates: [] });
  assert.equal("learning" in input, false);
});

test("RankingInput: an explicit learning.enabled=false is accepted", () => {
  const input = RankingInputSchema.parse({ candidates: [], learning: { enabled: false, maxBoost: 0.15 } });
  assert.equal(input.learning?.enabled, false);
});

test("RankingLearningConfig: rejects maxBoost outside [0, 1]", () => {
  assert.throws(() => RankingLearningConfigSchema.parse({ enabled: true, maxBoost: 1.5 }));
  assert.throws(() => RankingLearningConfigSchema.parse({ enabled: true, maxBoost: -0.01 }));
});

test("RankingLearningConfig: maxBoost may be exactly 0 or exactly 1 (boundary-valid, not silently tightened)", () => {
  assert.equal(RankingLearningConfigSchema.parse({ enabled: true, maxBoost: 0 }).maxBoost, 0);
  assert.equal(RankingLearningConfigSchema.parse({ enabled: true, maxBoost: 1 }).maxBoost, 1);
});

test("ContextPack: rejects a negative tokenCount", () => {
  assert.throws(() => ContextPackSchema.parse({ items: [], tokenCount: -1, truncated: false, omittedCount: 0 }));
});

test("ContextPack: accepts a well-formed empty pack", () => {
  const pack = ContextPackSchema.parse({ items: [], tokenCount: 0, truncated: false, omittedCount: 0 });
  assert.equal(pack.items.length, 0);
});

function baseContextItem(overrides: Record<string, unknown> = {}) {
  return {
    memoryId: randomUUID(),
    content: "example content",
    type: "pattern",
    domain: "backend",
    scope: globalScope(),
    source: { origin: "system" },
    confidence: 0.7,
    score: 0.9,
    rank: 1,
    wasCompressed: false,
    ...overrides,
  };
}

test("ContextItem: accepts a fully-populated item with provenance intact", () => {
  const item = ContextItemSchema.parse(baseContextItem());
  assert.equal(item.confidence, 0.7);
  assert.equal(item.scope.kind, "global");
  assert.equal(item.source.origin, "system");
});

test("ContextItem: rejects unrecognized fields (strict)", () => {
  assert.throws(() => ContextItemSchema.parse(baseContextItem({ extra: "field" })));
});

test("CompileContextInput: has no budget field -- unrecognized 'budget' is rejected (P1-010 must not accept one)", () => {
  assert.throws(() =>
    CompileContextInputSchema.parse({
      task: "example task",
      scope: globalScope(),
      rankedResults: [],
      budget: { maxTokens: 1000 },
    }),
  );
});

test("CompileContextInput: accepts a valid budget-free input", () => {
  const input = CompileContextInputSchema.parse({ task: "example task", scope: globalScope(), rankedResults: [] });
  assert.deepEqual(input.rankedResults, []);
});

test("CompiledContext: has no tokenCount/truncated fields -- unrecognized 'tokenCount' is rejected (that's ContextPack's job)", () => {
  assert.throws(() => CompiledContextSchema.parse({ items: [], duplicatesRemoved: 0, tokenCount: 0 }));
});

test("CompiledContext: accepts a valid empty compiled context", () => {
  const result = CompiledContextSchema.parse({ items: [], duplicatesRemoved: 0 });
  assert.equal(result.duplicatesRemoved, 0);
});

test("RetrievalEvent: taskId defaults to null when omitted", () => {
  const event = RetrievalEventSchema.parse({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    scope: globalScope(),
    queryText: "example query",
    candidateIds: [],
  });
  assert.equal(event.taskId, null);
});

test("ContextEvent: links back to its RetrievalEvent via retrievalEventId", () => {
  const retrievalId = randomUUID();
  const event = ContextEventSchema.parse({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    retrievalEventId: retrievalId,
    scope: globalScope(),
    includedMemoryIds: [],
    omittedMemoryIds: [],
    tokenCount: 0,
  });
  assert.equal(event.retrievalEventId, retrievalId);
});

test("OutcomeEvent: rejects an outcome value outside the fixed set", () => {
  assert.throws(() =>
    OutcomeEventSchema.parse({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      taskId: "task-1",
      outcome: "maybe",
    }),
  );
});

test("FeedbackEvent: useful is nullable (explicit unknown, not just optional)", () => {
  const event = FeedbackEventSchema.parse({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    memoryId: randomUUID(),
    useful: null,
  });
  assert.equal(event.useful, null);
});

test("MemoryMutationEvent: accepts each of the three mutation types", () => {
  for (const mutationType of ["create", "update", "archive"] as const) {
    const event = MemoryMutationEventSchema.parse({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      memoryId: randomUUID(),
      mutationType,
      actor: { origin: "agent" },
    });
    assert.equal(event.mutationType, mutationType);
  }
});

test("MemoryMutationEvent: rejects a mutation type outside the fixed set", () => {
  assert.throws(() =>
    MemoryMutationEventSchema.parse({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      memoryId: randomUUID(),
      mutationType: "delete",
      actor: { origin: "agent" },
    }),
  );
});

// --- P2-003: Phase 2B contract additions -----------------------------------

const CTX_BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  timestamp: "2026-01-01T00:00:00.000Z",
  retrievalEventId: "22222222-2222-4222-8222-222222222222",
  scope: { kind: "global", id: null },
  includedMemoryIds: [],
  omittedMemoryIds: [],
  tokenCount: 0,
};

test("P2-003 backward compatibility: a pre-Phase-2B ContextEvent payload still parses", () => {
  const parsed = ContextEventSchema.parse(CTX_BASE);
  // Every added field defaults, so an existing producer keeps working unchanged.
  assert.deepEqual(parsed.memories, []);
  assert.equal(parsed.candidateCount, null);
  assert.equal(parsed.candidateTokenCount, null);
  assert.equal(parsed.retrievalMs, null);
  assert.equal(parsed.rankingMs, null);
  assert.equal(parsed.compileMs, null);
  assert.equal(parsed.optimizeMs, null);
});

test("P2-003 backward compatibility: a pre-Phase-2B FeedbackEvent payload still parses", () => {
  const parsed = FeedbackEventSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    timestamp: "2026-01-01T00:00:00.000Z",
    memoryId: "33333333-3333-4333-8333-333333333333",
    useful: true,
  });
  assert.equal(parsed.contextId, null);
  assert.equal(parsed.reason, null);
  assert.equal(parsed.taskId, null);
});

test("P2-003 backward compatibility: a pre-Phase-2B OutcomeEvent payload still parses", () => {
  const parsed = OutcomeEventSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    timestamp: "2026-01-01T00:00:00.000Z",
    taskId: "t-1",
    outcome: "success",
  });
  assert.equal(parsed.contextId, null);
});

test("P2-003: the new event fields stay .strict() -- an unrecognized field is rejected", () => {
  assert.throws(() => FeedbackEventSchema.parse({ ...CTX_BASE, memoryId: CTX_BASE.id, useful: true, surprise: 1 }));
  assert.throws(() => ContextEventSchema.parse({ ...CTX_BASE, surprise: 1 }));
});

test("P2-003: FeedbackEvent.reason accepts only the four defined reasons", () => {
  for (const reason of FEEDBACK_REASONS) {
    const parsed = FeedbackEventSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-01-01T00:00:00.000Z",
      memoryId: "33333333-3333-4333-8333-333333333333",
      useful: false,
      reason,
    });
    assert.equal(parsed.reason, reason);
  }
  assert.throws(() =>
    FeedbackEventSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-01-01T00:00:00.000Z",
      memoryId: "33333333-3333-4333-8333-333333333333",
      useful: false,
      reason: "not-a-reason",
    }),
  );
});

test("P2-003: ContextEventMemory rejects a negative token count and a zero rank", () => {
  const ok = ContextEventMemorySchema.parse({ memoryId: "33333333-3333-4333-8333-333333333333", included: true });
  assert.equal(ok.rank, null);
  assert.equal(ok.tokenCount, null);
  assert.throws(() =>
    ContextEventMemorySchema.parse({ memoryId: "33333333-3333-4333-8333-333333333333", included: true, rank: 0 }),
  );
  assert.throws(() =>
    ContextEventMemorySchema.parse({
      memoryId: "33333333-3333-4333-8333-333333333333",
      included: true,
      tokenCount: -1,
    }),
  );
});

test("P2-006: assertContextMembershipConsistent accepts agreeing forms and rejects divergence", () => {
  const a = "33333333-3333-4333-8333-333333333333";
  const b = "44444444-4444-4444-8444-444444444444";

  assert.doesNotThrow(() =>
    assertContextMembershipConsistent({
      includedMemoryIds: [a],
      omittedMemoryIds: [b],
      memories: [
        { memoryId: a, included: true, rank: 1, tokenCount: 3 },
        { memoryId: b, included: false, rank: null, tokenCount: null },
      ],
    }),
  );

  // Order must not matter -- the two forms are sets, not sequences.
  assert.doesNotThrow(() =>
    assertContextMembershipConsistent({
      includedMemoryIds: [b, a],
      omittedMemoryIds: [],
      memories: [
        { memoryId: a, included: true, rank: 2, tokenCount: 3 },
        { memoryId: b, included: true, rank: 1, tokenCount: 3 },
      ],
    }),
  );

  assert.throws(
    () =>
      assertContextMembershipConsistent({
        includedMemoryIds: [a, b],
        omittedMemoryIds: [],
        memories: [{ memoryId: a, included: true, rank: 1, tokenCount: 3 }],
      }),
    /context membership diverged/,
  );

  // A pre-migration event carries no normalized rows; there is nothing to
  // cross-check and that is not an error.
  assert.doesNotThrow(() =>
    assertContextMembershipConsistent({ includedMemoryIds: [a], omittedMemoryIds: [], memories: [] }),
  );
});

test("SimilarityPair: accepts a valid pair and rejects unrecognized fields", () => {
  const a = randomUUID();
  const b = randomUUID();
  const valid = SimilarityPairSchema.parse({ a, b, similarity: 0.75 });
  assert.equal(valid.similarity, 0.75);
  assert.throws(() => SimilarityPairSchema.parse({ a, b, similarity: 0.75, extra: 1 }));
});

test("SimilarityPair: similarity must be within [-1, 1]", () => {
  const a = randomUUID();
  const b = randomUUID();
  assert.throws(() => SimilarityPairSchema.parse({ a, b, similarity: 1.5 }));
  assert.throws(() => SimilarityPairSchema.parse({ a, b, similarity: -1.5 }));
});

test("sortSimilarityPairs: orders by similarity descending, then a, then b ascending", () => {
  const [x, y, z] = [randomUUID(), randomUUID(), randomUUID()].sort();
  const input = [
    { a: y as string, b: z as string, similarity: 0.5 },
    { a: x as string, b: y as string, similarity: 0.9 },
    { a: x as string, b: z as string, similarity: 0.9 },
  ];
  const sorted = sortSimilarityPairs(input);
  assert.deepEqual(sorted.map((p) => [p.a, p.b]), [
    [x, y],
    [x, z],
    [y, z],
  ]);
});

// --- 2C-005: Context redundancy contracts ---------------------------------

test("ContextItem: redundantWith is optional and, when present, must be a uuid", () => {
  const base = { memoryId: randomUUID(), content: "x", type: "fact" as const, domain: null, scope: globalScope(), source: { origin: "system" as const }, confidence: 0.5, score: 1, rank: 1, wasCompressed: false };
  const withoutIt = ContextItemSchema.parse(base);
  assert.equal("redundantWith" in withoutIt, false);
  const withIt = ContextItemSchema.parse({ ...base, redundantWith: randomUUID() });
  assert.ok(typeof withIt.redundantWith === "string");
  assert.throws(() => ContextItemSchema.parse({ ...base, redundantWith: "not-a-uuid" }));
});

test("CompileContextInput: redundancyPairs is optional and defaults to absent", () => {
  const input = CompileContextInputSchema.parse({ task: "t", scope: globalScope(), rankedResults: [] });
  assert.equal("redundancyPairs" in input, false);
});

test("CompileContextInput: redundancyPairs accepts a valid SimilarityPair array", () => {
  const a = randomUUID();
  const b = randomUUID();
  const input = CompileContextInputSchema.parse({
    task: "t",
    scope: globalScope(),
    rankedResults: [],
    redundancyPairs: [{ a, b, similarity: 0.8 }],
  });
  assert.equal(input.redundancyPairs?.length, 1);
});

// --- Phase 3.4: Context sources (code/dependency) ----------------------

function baseContextEventSource(overrides: Record<string, unknown> = {}) {
  return {
    sourceType: "code",
    sourceId: "src-1",
    repositoryId: "repo-1",
    fileId: "file-1",
    relativePath: "src/index.ts",
    relation: null,
    depth: null,
    included: true,
    rank: 1,
    tokenCount: 100,
    ...overrides,
  };
}

test("ContextEventSource: accepts a well-formed code source with relation: null", () => {
  const source = ContextEventSourceSchema.parse(baseContextEventSource());
  assert.equal(source.sourceType, "code");
  assert.equal(source.relation, null);
  assert.equal(source.included, true);
});

test("ContextEventSource: accepts a well-formed dependency source with relation set", () => {
  const source = ContextEventSourceSchema.parse(
    baseContextEventSource({
      sourceType: "dependency",
      relation: "dependency",
      depth: null,
    }),
  );
  assert.equal(source.sourceType, "dependency");
  assert.equal(source.relation, "dependency");
});

test("ContextEventSource: accepts all three dependency relations", () => {
  for (const relation of ["dependency", "dependent", "impact"] as const) {
    const source = ContextEventSourceSchema.parse(
      baseContextEventSource({
        sourceType: "dependency",
        relation,
        depth: relation === "impact" ? 1 : null,
      }),
    );
    assert.equal(source.relation, relation);
  }
});

test("ContextEventSource: rejects code source with relation set", () => {
  assert.throws(() =>
    ContextEventSourceSchema.parse(
      baseContextEventSource({
        sourceType: "code",
        relation: "dependency",
      }),
    ),
  );
});

test("ContextEventSource: rejects dependency source with relation: null", () => {
  assert.throws(() =>
    ContextEventSourceSchema.parse(
      baseContextEventSource({
        sourceType: "dependency",
        relation: null,
      }),
    ),
  );
});

test("ContextEventSource: rejects an unknown sourceType", () => {
  assert.throws(() =>
    ContextEventSourceSchema.parse(
      baseContextEventSource({
        sourceType: "memory",
      }),
    ),
  );
});

test("ContextEventSource: rejects an unknown relation value", () => {
  assert.throws(() =>
    ContextEventSourceSchema.parse(
      baseContextEventSource({
        sourceType: "dependency",
        relation: "cross-references",
      }),
    ),
  );
});

test("ContextEventSource: relation and depth default to null when omitted", () => {
  const source = ContextEventSourceSchema.parse({
    sourceType: "code",
    sourceId: "src-1",
    repositoryId: "repo-1",
    fileId: "file-1",
    relativePath: "src/index.ts",
    included: true,
  });
  assert.equal(source.relation, null);
  assert.equal(source.depth, null);
  assert.equal(source.rank, null);
  assert.equal(source.tokenCount, null);
});

test("ContextEventSource: rejects unrecognized fields (strict)", () => {
  assert.throws(() => ContextEventSourceSchema.parse(baseContextEventSource({ extra: "field" })));
});
