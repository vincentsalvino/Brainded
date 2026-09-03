import type { Candidate, LearningConfig, MemoryPerformanceStore } from "@brain/contracts";
import { computeUsefulnessSignal } from "./aggregation.js";

/**
 * Phase 4.2 (PHASE_2_DECISIONS.md E7, PHASE_4_SPEC.md 6). I/O via the injected
 * MemoryPerformanceStore interface only -- never a concrete driver (D4), never called by
 * @brain/ranking. Invoked by Gateway, between retrieval and rank().
 *
 * `config` is public/readonly so Gateway can read `enabled`/`maxBoost` off this one instance to
 * build rank()'s own `learning` field -- one source of truth, not a second copy of LearningConfig
 * threaded separately through Gateway's constructor.
 */
export class LearningSignalService {
  constructor(
    private readonly store: MemoryPerformanceStore,
    readonly config: LearningConfig,
  ) {}

  async decorate(candidates: Candidate[]): Promise<Candidate[]> {
    if (!this.config.enabled) return candidates; // F10: true no-op, zero store reads

    let raw;
    try {
      raw = await this.store.getPerformanceBatch(candidates.map((c) => c.memoryId));
    } catch (error) {
      // Learning is optional retrieval enrichment, never a reason brain_context/brain_search
      // fails -- same discipline as vector search / redundancy detection / code retrieval
      // degradation elsewhere in this pipeline.
      console.warn("learning: performance store read failed, continuing without it:", error);
      return candidates;
    }

    return candidates.map((c) => {
      const row = raw.get(c.memoryId);
      if (!row) return c; // no aggregate row -- cold start, performance stays absent
      return { ...c, performance: computeUsefulnessSignal(row, this.config) };
    });
  }
}
