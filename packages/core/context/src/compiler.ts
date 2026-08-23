import { CompileContextInputSchema, type CompileContextInput, type CompiledContext, type ContextItem } from "@brain/contracts";

/**
 * Candidate generation (P1-008) already answered "what's potentially relevant."
 * Ranking (P1-009) already answered "what's most relevant, in order." This
 * package answers one narrower question: "what should be assembled for an
 * agent" -- selection and organization, at full fidelity, with provenance
 * intact. It does NOT decide how many tokens that costs (P1-011), does not
 * compress or summarize anything (Step 10 -- source fidelity is preserved
 * exactly), does not call an LLM, does not know Claude/Cursor/Codex/Aider exist,
 * and does not touch a database, the filesystem, or the network -- every input
 * it needs is already on the RankedResult objects the caller provides.
 *
 * Selection rule (Step 6/7, considered and deliberately minimal): the only thing
 * this stage omits is an EXACT content-string duplicate of an already-selected,
 * higher-ranked item. It does not threshold on score/relevance (that already
 * happened in ranking) and does not attempt semantic/near-duplicate detection
 * (explicitly not required, and "do not accidentally remove useful but related
 * memories merely because they contain similar text" -- fuzzy similarity is easy
 * to get wrong and was not asked for).
 *
 * Ordering: rankedResults arrives already sorted by P1-009; this function
 * iterates in that order and never re-sorts, except for redundancy demotion
 * (P2C-005): items marked as redundant via redundancyPairs are moved to the end
 * of the output array, after all non-redundant items, preserving relative order
 * within each group. No grouping/sectioning is applied -- every item already
 * carries `type`, so a consumer can group however it wants without the Brain
 * baking one particular grouping in (Step 7: "do not create sections merely
 * because they sound useful").
 */
export function compileContext(rawInput: CompileContextInput): CompiledContext {
  const input = CompileContextInputSchema.parse(rawInput);

  // 2C.1: which memoryIds survive exact-content dedup, computed over the
  // WHOLE list before the main loop runs. The redundancy guard below needs
  // to know whether a pair's anchor (the `a` side) is ultimately present in
  // the output, independent of where in rankedResults it sits. Checking this
  // against a set built incrementally DURING the same pass that builds items
  // (as a single loop naturally would) silently assumes `a` is always
  // visited before `b` -- true when redundancy orientation was rank-only,
  // no longer true once a more scope-specific memory can anchor a
  // better-ranked, less specific one (docs/PHASE_2C_PILOT_REPORT.md's real
  // finding: that exact case silently failed to demote at all).
  const survivingMemoryIds = new Set<string>();
  {
    const seen = new Set<string>();
    for (const ranked of input.rankedResults) {
      if (seen.has(ranked.record.content)) continue;
      seen.add(ranked.record.content);
      survivingMemoryIds.add(ranked.memoryId);
    }
  }

  const seenContent = new Set<string>();
  const nonRedundant: ContextItem[] = [];
  const redundant: ContextItem[] = [];
  let duplicatesRemoved = 0;

  // 2C-005: memoryId -> the higher-ranked memoryId it duplicates. Built before
  // the main loop so membership can be checked in one pass. Pairs arrive
  // similarity-descending (sortSimilarityPairs); first write wins so a memory
  // redundant with more than one other points at its STRONGEST match, not
  // whichever pair happened to be processed last. The redundancy marking is
  // gated on survivingMemoryIds.has(redundantWith) below: if a pair's
  // reference target (the `a` side) is dropped by content-dedup, the
  // redundant marking must not apply, since the reference no longer exists
  // in the output.
  const redundantWithById = new Map<string, string>();
  for (const pair of input.redundancyPairs ?? []) {
    if (!redundantWithById.has(pair.b)) redundantWithById.set(pair.b, pair.a);
  }

  for (const ranked of input.rankedResults) {
    if (seenContent.has(ranked.record.content)) {
      duplicatesRemoved++;
      continue;
    }
    seenContent.add(ranked.record.content);

    const item: ContextItem = {
      memoryId: ranked.memoryId,
      content: ranked.record.content,
      type: ranked.record.type,
      domain: ranked.record.domain,
      scope: ranked.record.scope,
      source: ranked.record.source,
      confidence: ranked.record.confidence,
      score: ranked.score,
      rank: ranked.rank,
      // Always false here -- P1-010 never compresses. Reserved for P1-011.
      wasCompressed: false,
    };

    const redundantWith = redundantWithById.get(ranked.memoryId);
    if (redundantWith !== undefined && survivingMemoryIds.has(redundantWith)) {
      redundant.push({ ...item, redundantWith });
    } else {
      nonRedundant.push(item);
    }
  }

  return { items: [...nonRedundant, ...redundant], duplicatesRemoved };
}
