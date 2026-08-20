// Deliberately conservative (over-, never under-) character-based approximation
// -- non-blocking implementation detail (IMPLEMENTATION_READINESS.md/
// PHASE_1_TASKS.md's "conservative token-estimation ratio"), not architecture.
// ~4 chars/token is the commonly-cited average for English BPE tokenizers; 3 is
// used here specifically to err toward overestimating, since exceeding a budget
// is the failure mode that matters (PHASE_1_SPEC.md Token Budgeting). Isolated
// in its own file, exported standalone, and accepted as an optional parameter by
// optimizeContext() -- swappable for a real per-model tokenizer later without
// touching any caller.
export const CHARS_PER_TOKEN = 3;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
