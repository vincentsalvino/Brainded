export interface ChunkPolicy {
  maxLines: number;
  overlapLines: number;
}

// 0 overlap is a deliberate, documented starting point -- not an oversight. See
// PHASE_3_SPEC.md's Chunking section: add overlap only if 3.2's retrieval-quality
// evaluation shows boundary-split context loss. A plain options object, not a
// pluggable strategy interface -- nothing today needs more than one policy.
export const DEFAULT_CHUNK_POLICY: ChunkPolicy = { maxLines: 200, overlapLines: 0 };

export interface ChunkSpan {
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
}

/**
 * Deterministic line-window chunking: identical (content, policy) always produces
 * an identical span list (invariant 6). A single trailing newline is not counted as
 * an extra blank final line -- the common case of a file ending in "\n" should not
 * chunk one line "longer" than a file without one.
 */
export function chunkContent(content: string, policy: ChunkPolicy = DEFAULT_CHUNK_POLICY): ChunkSpan[] {
  if (content.length === 0) return [];

  const lines = content.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const step = Math.max(1, policy.maxLines - policy.overlapLines);
  const spans: ChunkSpan[] = [];
  let chunkIndex = 0;
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + policy.maxLines, lines.length);
    spans.push({
      chunkIndex,
      startLine: start + 1,
      endLine: end,
      content: lines.slice(start, end).join("\n"),
    });
    chunkIndex++;
    if (end >= lines.length) break;
  }
  return spans;
}
