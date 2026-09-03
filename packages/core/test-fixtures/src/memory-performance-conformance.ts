import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { MemoryPerformanceRaw, MemoryPerformanceStore } from "@brain/contracts";

/**
 * ONE behavioural contract for MemoryPerformanceStore's read side (getPerformanceBatch), run
 * against every implementation -- same discipline as store-conformance.ts (P2-001), applied here
 * to Phase 4.1's new store. rebuildAll() is deliberately not covered here: its real invariant
 * (rebuild output equals incremental output exactly, F11) is specific to SqliteMemoryPerformanceStore's
 * raw-event replay and is already exercised directly in memory-performance-store.test.ts; a fake
 * seeded by direct assignment has no independent raw-event log to replay, so "rebuild" isn't a
 * meaningfully shared contract across implementations.
 */

export interface PerformanceConformanceStore {
  store: MemoryPerformanceStore;
  cleanup: () => void;
}

export interface PerformanceConformanceHarness {
  name: string;
  /** Build a store containing exactly `seeds`, queryable by their own memoryId. */
  setup(seeds: MemoryPerformanceRaw[]): Promise<PerformanceConformanceStore>;
}

function seedRow(overrides: Partial<MemoryPerformanceRaw> = {}): MemoryPerformanceRaw {
  return {
    memoryId: randomUUID(),
    scopeKey: "*",
    usefulCount: 3,
    notUsefulCount: 1,
    redundantReasonCount: 0,
    incorrectReasonCount: 0,
    dilutedSuccessEvidence: 0.2,
    dilutedFailureEvidence: 0,
    successContextCount: 1,
    failureContextCount: 0,
    labeledContextCount: 4,
    lastFeedbackAt: "2026-01-01T00:00:00.000Z",
    lastOutcomeAt: null,
    ...overrides,
  };
}

export function runMemoryPerformanceStoreConformance(harness: PerformanceConformanceHarness): void {
  const label = (name: string) => `[conformance:${harness.name}] ${name}`;

  test(label("getPerformanceBatch returns exactly the seeded row for a requested id"), async () => {
    const seed = seedRow();
    const { store, cleanup } = await harness.setup([seed]);
    try {
      const batch = await store.getPerformanceBatch([seed.memoryId]);
      assert.deepEqual(batch.get(seed.memoryId), seed);
    } finally {
      cleanup();
    }
  });

  test(label("a memoryId with no aggregate is simply absent from the returned map (cold start, not a zero row)"), async () => {
    const { store, cleanup } = await harness.setup([]);
    try {
      const batch = await store.getPerformanceBatch([randomUUID()]);
      assert.equal(batch.size, 0);
      assert.equal(batch.has(randomUUID()), false);
    } finally {
      cleanup();
    }
  });

  test(label("an empty request returns an empty map, never every row"), async () => {
    const seed = seedRow();
    const { store, cleanup } = await harness.setup([seed]);
    try {
      assert.equal((await store.getPerformanceBatch([])).size, 0);
    } finally {
      cleanup();
    }
  });

  test(label("only the requested ids are returned, even when more rows exist"), async () => {
    const wanted = seedRow();
    const other = seedRow();
    const { store, cleanup } = await harness.setup([wanted, other]);
    try {
      const batch = await store.getPerformanceBatch([wanted.memoryId]);
      assert.equal(batch.size, 1);
      assert.ok(batch.has(wanted.memoryId));
      assert.equal(batch.has(other.memoryId), false);
    } finally {
      cleanup();
    }
  });

  test(label("scopeKey on a returned row is '*' -- Phase 4.1/4.2 is global-bucket-only (F8)"), async () => {
    const seed = seedRow();
    const { store, cleanup } = await harness.setup([seed]);
    try {
      const row = (await store.getPerformanceBatch([seed.memoryId])).get(seed.memoryId);
      assert.equal(row?.scopeKey, "*");
    } finally {
      cleanup();
    }
  });
}
