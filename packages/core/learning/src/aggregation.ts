import type { MemoryPerformanceRaw, LearningConfig, CandidatePerformance } from "@brain/contracts";

/**
 * Phase 4.2 (PHASE_2_DECISIONS.md E5, PHASE_4_DECISIONS.md F4). Pure -- no I/O, no storage
 * dependency, no event reads, no ranking imports. `raw`'s diluted evidence is stored UNWEIGHTED
 * (1/includedMemoryIds per eligible outcome, applied at write time in
 * packages/storage/src/memory-performance-store.ts); `config.outcomeWeight` is applied here, on
 * read, exactly once -- never in storage. This is what makes changing `outcomeWeight` a config
 * change, never a migration or a rebuild.
 */
export function computeUsefulnessSignal(raw: MemoryPerformanceRaw, config: LearningConfig): CandidatePerformance {
  const positiveEvidence = raw.usefulCount + config.outcomeWeight * raw.dilutedSuccessEvidence;
  const negativeEvidence = raw.notUsefulCount + config.outcomeWeight * raw.dilutedFailureEvidence;

  const posterior = (positiveEvidence + 1) / (positiveEvidence + negativeEvidence + 2); // Beta(1,1)
  const evidenceMass = positiveEvidence + negativeEvidence;
  const usefulnessSignal = 0.5 + (posterior - 0.5) * (evidenceMass / (evidenceMass + config.k));

  return { usefulnessSignal, evidenceMass };
}
