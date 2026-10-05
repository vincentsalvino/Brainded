import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Phase 2C.2. A replayable, manually labeled real-model redundancy benchmark.
 * Deliberately NOT EvalExample/dataset.ts's shape -- that schema is a
 * task+ranked-memories fixture (a different axis entirely, see
 * docs/phase-2c/PHASE_2C_PILOT_REPORT.md's note on A/A'/C' vs A/B/C never being the
 * same thing). This is a flat list of CONTENT PAIRS with a human-declared
 * label, for measuring cosine similarity against a fixed expectation --
 * nothing here is ever retrieved, ranked, or scoped.
 */

export const REDUNDANCY_PAIR_CATEGORIES = ["A", "B", "C", "D"] as const;
export type RedundancyPairCategory = (typeof REDUNDANCY_PAIR_CATEGORIES)[number];

export const RedundancyPairSchema = z
  .object({
    id: z.string().min(1),
    domain: z.string().min(1),
    /** A = near-verbatim redundant, B = paraphrase redundant, C = same-domain distinct, D = unrelated. */
    category: z.enum(REDUNDANCY_PAIR_CATEGORIES),
    contentA: z.string().min(1),
    contentB: z.string().min(1),
    notes: z.string().nullable().default(null),
    /**
     * Phase 2C.3 author-bias mitigation: which independent authoring pass a
     * pair came from (e.g. "batch-1", "batch-2"). null for every Phase 2C.2
     * pair, authored before batching existed. Batch 2 must be written without
     * inspecting batch 1's measured similarities -- this field only records
     * identity for audit; it never influences scoring.
     */
    batch: z.string().nullable().default(null),
  })
  .strict();
export type RedundancyPair = z.infer<typeof RedundancyPairSchema>;

/**
 * Derived, never stored redundantly on the fixture itself: A/B (same rule) ->
 * redundant, C/D (different rule) -> distinct. A dataset that stored both
 * `category` and `expectedLabel` independently could silently disagree with
 * itself; this function is the single source of truth for the mapping.
 */
export function expectedLabelForCategory(category: RedundancyPairCategory): "redundant" | "distinct" {
  return category === "A" || category === "B" ? "redundant" : "distinct";
}

/** JSONL, one pair per line. Same strict-parse-with-line-numbers discipline as dataset.ts's parseDataset. */
export function parseRedundancyPairs(contents: string, sourceName = "<inline>"): RedundancyPair[] {
  const pairs: RedundancyPair[] = [];
  const lines = contents.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line.length === 0 || line.startsWith("//")) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(`${sourceName}:${i + 1}: not valid JSON -- ${(error as Error).message}`);
    }

    const parsed = RedundancyPairSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${sourceName}:${i + 1}: invalid pair -- ${parsed.error.message}`);
    }
    pairs.push(parsed.data);
  }

  const ids = new Set(pairs.map((p) => p.id));
  if (ids.size !== pairs.length) {
    throw new Error(`${sourceName}: duplicate pair id`);
  }
  return pairs;
}

export function loadRedundancyPairs(path: string): RedundancyPair[] {
  return parseRedundancyPairs(readFileSync(path, "utf-8"), path);
}
