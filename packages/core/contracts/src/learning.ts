import { z } from "zod";

// Phase 4.1 (PHASE_4_SPEC.md 2.1). Raw, rebuildable aggregate counts only -- no derived score.
// usefulnessSignal/evidenceMass are computed on read, in Phase 4.2, from these counts (F3/F4);
// storing them here would mean a formula or K/outcomeWeight change needs a migration or a
// rebuild, which is exactly what keeping this table raw-only avoids.
//
// scopeKey is '*' (global) only in Phase 4.1/4.2 (F8) -- present now so a project-specific
// bucket can be added later with no migration, not populated yet.
export const MemoryPerformanceRawSchema = z
  .object({
    memoryId: z.string().uuid(),
    scopeKey: z.string().min(1),
    usefulCount: z.number().int().nonnegative(),
    notUsefulCount: z.number().int().nonnegative(),
    // reason='redundant' feeds neither stream (E14/F5) -- tracked separately, not folded in.
    redundantReasonCount: z.number().int().nonnegative(),
    // subset of notUsefulCount; reason='incorrect' also raises a human review flag (E14/F5).
    incorrectReasonCount: z.number().int().nonnegative(),
    // Tier-2 credit (E12), stored UNWEIGHTED (1/includedMemoryIds.length per eligible outcome).
    // config.outcomeWeight is applied only on read, in computeUsefulnessSignal (F4) -- see the
    // 2026-09-04 correction in PHASE_4_SPEC.md 4/PHASE_4_DECISIONS.md F3.
    dilutedSuccessEvidence: z.number().nonnegative(),
    dilutedFailureEvidence: z.number().nonnegative(),
    // Raw, undiluted counts -- observability only, never fed into the formula directly.
    successContextCount: z.number().int().nonnegative(),
    failureContextCount: z.number().int().nonnegative(),
    // Distinct (memoryId, contextId) Tier-1 observations that actually contributed (F16a dedup).
    labeledContextCount: z.number().int().nonnegative(),
    lastFeedbackAt: z.string().datetime().nullable(),
    lastOutcomeAt: z.string().datetime().nullable(),
  })
  .strict();
export type MemoryPerformanceRaw = z.infer<typeof MemoryPerformanceRawSchema>;

// Phase 4.2 config (PHASE_4_SPEC.md 2.2). Defined now, as a stable contract, but consumed by
// no Phase 4.1 code path -- Phase 4.1 never reads `enabled`/`k`/`outcomeWeight`/`maxBoost`.
export const LearningConfigSchema = z
  .object({
    enabled: z.boolean(),
    k: z.number().positive(),
    outcomeWeight: z.number().nonnegative(),
    maxBoost: z.number().min(0).max(1),
  })
  .strict();
export type LearningConfig = z.infer<typeof LearningConfigSchema>;

// F10: disabled by default. F4: outcomeWeight starts at 0 -- outcome data is 100%-success/
// zero-variance in the live corpus (PHASE_4_FINDINGS.md 5-6), so a nonzero weight would be
// tuned against noise. F2: maxBoost=0.15 bounds the future post-score multiplier to +-15%.
export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  enabled: false,
  k: 5,
  outcomeWeight: 0,
  maxBoost: 0.15,
};
