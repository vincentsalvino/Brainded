import type { ContextItem, CodeContextItem, DependencyContextItem, ContextSourceWrapper, DependencyExpansionPolicy } from "@brain/contracts";
import { DEFAULT_DEPENDENCY_EXPANSION_POLICY } from "@brain/contracts";

type Tier1Entry =
  | { sourceType: "memory"; item: ContextItem; score: number }
  | { sourceType: "code"; item: CodeContextItem; score: number };

const GUARANTEE_WINDOW = 3;

function tier1Id(entry: Tier1Entry): string {
  return entry.sourceType === "memory" ? entry.item.memoryId : entry.item.chunkId;
}

function sortTier1(entries: Tier1Entry[]): Tier1Entry[] {
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aId = tier1Id(a);
    const bId = tier1Id(b);
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
}

/**
 * Ordering guarantee, not an inclusion guarantee (inclusion depends on the
 * token budget, unknown at this pure-selection stage -- see PHASE_3_SPEC.md
 * Mixed-Source Prioritization). If a source has >=1 candidate but none land in
 * the top GUARANTEE_WINDOW positions purely from score-scale mismatch, its
 * single best item is promoted into the last window position -- but never when
 * the other source would be pushed out of the window entirely (never demote a
 * source's only representative).
 */
function applyStarvationSafetyNet(sorted: Tier1Entry[]): Tier1Entry[] {
  const window = sorted.slice(0, GUARANTEE_WINDOW);
  const has = (list: Tier1Entry[], type: "memory" | "code"): boolean => list.some((e) => e.sourceType === type);

  for (const type of ["memory", "code"] as const) {
    const other = type === "memory" ? "code" : "memory";
    if (has(sorted, type) && !has(window, type) && has(window, other)) {
      const bestIndex = sorted.findIndex((e) => e.sourceType === type);
      if (bestIndex >= GUARANTEE_WINDOW) {
        const copy = [...sorted];
        const [best] = copy.splice(bestIndex, 1);
        copy.splice(GUARANTEE_WINDOW - 1, 0, best as Tier1Entry);
        return copy;
      }
    }
  }
  return sorted;
}

export function selectSources(
  memoryItems: ContextItem[],
  codeItems: CodeContextItem[],
  dependencyItemsBySeedFileId: Map<string, DependencyContextItem[]>,
  policy: Pick<DependencyExpansionPolicy, "maxDependencySeedFiles"> = DEFAULT_DEPENDENCY_EXPANSION_POLICY,
): ContextSourceWrapper[] {
  const tier1: Tier1Entry[] = [
    ...memoryItems.map((item): Tier1Entry => ({ sourceType: "memory", item, score: item.score })),
    ...codeItems.map((item): Tier1Entry => ({ sourceType: "code", item, score: item.score })),
  ];
  const ordered = applyStarvationSafetyNet(sortTier1(tier1));

  const result: ContextSourceWrapper[] = [];
  // Seeded by distinct fileId, not by code entry: two chunks of the same file
  // (both landing in the top tier-1 positions) must consume exactly one seed
  // slot and splice that file's dependency block exactly once, not once per
  // chunk -- see PHASE_3_SPEC.md Phase 3.4, Dependency Enrichment.
  const seededFileIds = new Set<string>();
  for (const entry of ordered) {
    if (entry.sourceType === "memory") {
      result.push({ sourceType: "memory", content: entry.item.content, rank: 0, wasCompressed: entry.item.wasCompressed, item: entry.item });
      continue;
    }
    result.push({ sourceType: "code", content: entry.item.content, rank: 0, wasCompressed: entry.item.wasCompressed, item: entry.item });
    if (seededFileIds.size < policy.maxDependencySeedFiles && !seededFileIds.has(entry.item.fileId)) {
      seededFileIds.add(entry.item.fileId);
      for (const dep of dependencyItemsBySeedFileId.get(entry.item.fileId) ?? []) {
        result.push({ sourceType: "dependency", content: dep.content, rank: 0, wasCompressed: dep.wasCompressed, item: dep });
      }
    }
  }

  return result.map((w, index) => ({ ...w, rank: index + 1 }));
}
