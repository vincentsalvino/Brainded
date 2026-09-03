import type { MemoryPerformanceRaw, MemoryPerformanceStore } from "@brain/contracts";

/**
 * In-memory MemoryPerformanceStore for unit-testing core packages (Phase 4.2's
 * LearningSignalService, in particular) without a real database. Tests seed exact rows via
 * `seed()` -- there is no independent raw feedback/outcome log behind this fake to derive rows
 * from, so `rebuildAll()` has nothing to replay and simply reports the current row count. That is
 * a deliberate simplification, not a gap in the shared contract: F11's "rebuild equals
 * incremental" invariant is specific to SqliteMemoryPerformanceStore's real event replay and is
 * tested directly against it (packages/storage), not via this fake.
 */
export class FakeMemoryPerformanceStore implements MemoryPerformanceStore {
  private readonly rows = new Map<string, MemoryPerformanceRaw>();
  private shouldFail = false;
  /** Real call count, not a mock's recorded-arguments log -- enough to assert "decorate() made
   *  zero store reads while disabled" without a mocking library. */
  getPerformanceBatchCallCount = 0;

  seed(raw: MemoryPerformanceRaw): void {
    this.rows.set(raw.memoryId, raw);
  }

  /** Lets a test simulate the performance store being unavailable (Task 10 degradation test). */
  simulateFailure(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  async getPerformanceBatch(memoryIds: string[]): Promise<Map<string, MemoryPerformanceRaw>> {
    this.getPerformanceBatchCallCount++;
    if (this.shouldFail) {
      throw new Error("simulated performance store failure");
    }
    const map = new Map<string, MemoryPerformanceRaw>();
    for (const id of memoryIds) {
      const row = this.rows.get(id);
      if (row) map.set(id, row);
    }
    return map;
  }

  async rebuildAll(): Promise<{ memoriesRebuilt: number }> {
    return { memoriesRebuilt: this.rows.size };
  }
}
