import type {
  EvalExample,
  EvalReport,
  ExampleResult,
  MetricsAtK,
  Significance,
  Strategy,
} from "./types.js";
import type { Labels } from "./metrics.js";
import { gradeOf, mean, ndcgAtK, precisionAtK, recallAtK, reciprocalRank, relevantCount } from "./metrics.js";

export const DEFAULT_K_VALUES = [1, 3, 5, 10];

/**
 * Below this many graded observations, a metric difference between two
 * strategies is noise. The Phase 1 real-world corpus has 2 tasks and 5 feedback
 * observations, so every report produced today is INDICATIVE -- and says so.
 *
 * This threshold exists to stop a 0.02 NDCG delta from reading as progress. It is
 * a reporting guard, not a statistical test; a real significance test needs far
 * more data than this project will have for some time.
 */
export const SIGNIFICANCE_MIN_EXAMPLES = 20;
export const SIGNIFICANCE_MIN_OBSERVATIONS = 100;

function classify(exampleCount: number, observationCount: number): { significance: Significance; reason: string } {
  if (exampleCount >= SIGNIFICANCE_MIN_EXAMPLES && observationCount >= SIGNIFICANCE_MIN_OBSERVATIONS) {
    return {
      significance: "SIGNIFICANT",
      reason: `${exampleCount} examples / ${observationCount} graded observations meets the reporting threshold`,
    };
  }
  return {
    significance: "INDICATIVE",
    reason:
      `${exampleCount} examples / ${observationCount} graded observations is below the reporting threshold ` +
      `(${SIGNIFICANCE_MIN_EXAMPLES}/${SIGNIFICANCE_MIN_OBSERVATIONS}). Differences between strategies are ` +
      `directional evidence only, not a measured improvement.`,
  };
}

export async function evaluate(
  examples: EvalExample[],
  strategy: Strategy,
  options: { name: string; kValues?: number[] },
): Promise<EvalReport> {
  const kValues = options.kValues ?? DEFAULT_K_VALUES;
  const perExample: ExampleResult[] = [];

  for (const example of examples) {
    const labels = example.labels as Labels;
    const ranked = await strategy(example);
    const topKey = ranked[0] ?? null;

    perExample.push({
      exampleId: example.id,
      ranked,
      topKey,
      topGrade: topKey === null ? 0 : gradeOf(labels, topKey),
      reciprocalRank: reciprocalRank(ranked, labels),
      atK: kValues.map((k) => ({
        k,
        precision: precisionAtK(ranked, labels, k),
        recall: recallAtK(ranked, labels, k),
        ndcg: ndcgAtK(ranked, labels, k),
      })),
    });
  }

  // Examples with nothing relevant to find would drag every average toward 0
  // while measuring nothing about the strategy. They stay in `perExample` (they
  // are still evidence about recall behaviour) but are excluded from aggregates.
  const scorable = examples
    .map((example, i) => ({ example, result: perExample[i] as ExampleResult }))
    .filter(({ example }) => relevantCount(example.labels as Labels) > 0);

  const atK: MetricsAtK[] = kValues.map((k, ki) => ({
    k,
    precision: mean(scorable.map(({ result }) => (result.atK[ki] as MetricsAtK).precision)),
    recall: mean(scorable.map(({ result }) => (result.atK[ki] as MetricsAtK).recall)),
    ndcg: mean(scorable.map(({ result }) => (result.atK[ki] as MetricsAtK).ndcg)),
  }));

  const labeledObservationCount = examples.reduce(
    (sum, example) => sum + Object.keys(example.labels).length,
    0,
  );
  const { significance, reason } = classify(examples.length, labeledObservationCount);

  return {
    strategy: options.name,
    exampleCount: examples.length,
    labeledObservationCount,
    mrr: mean(scorable.map(({ result }) => result.reciprocalRank)),
    atK,
    perExample,
    significance,
    significanceReason: reason,
  };
}

/** Fixed-width comparison table. Deliberately plain text -- it belongs in a CI log. */
export function formatComparison(reports: EvalReport[]): string {
  const lines: string[] = [];
  const first = reports[0];
  if (!first) return "(no reports)";

  lines.push(`examples: ${first.exampleCount}   graded observations: ${first.labeledObservationCount}`);
  lines.push(`significance: ${first.significance} -- ${first.significanceReason}`);
  lines.push("");
  lines.push(["strategy".padEnd(12), "MRR".padStart(7), ...first.atK.flatMap((m) => [`P@${m.k}`.padStart(7), `R@${m.k}`.padStart(7), `NDCG@${m.k}`.padStart(9)])].join(""));

  for (const report of reports) {
    lines.push(
      [
        report.strategy.padEnd(12),
        report.mrr.toFixed(3).padStart(7),
        ...report.atK.flatMap((m) => [
          m.precision.toFixed(3).padStart(7),
          m.recall.toFixed(3).padStart(7),
          m.ndcg.toFixed(3).padStart(9),
        ]),
      ].join(""),
    );
  }

  lines.push("");
  lines.push("top-ranked item per example (grade of the item each strategy put first):");
  for (const example of first.perExample) {
    lines.push(`  ${example.exampleId}`);
    for (const report of reports) {
      const result = report.perExample.find((r) => r.exampleId === example.exampleId);
      lines.push(`    ${report.strategy.padEnd(10)} grade=${result?.topGrade ?? "-"}  ${result?.topKey ?? "(none)"}`);
    }
  }

  return lines.join("\n");
}
