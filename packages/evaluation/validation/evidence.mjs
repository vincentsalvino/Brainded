import { z } from 'zod';
import { scopeIncludes, ScopeRefSchema, MEMORY_TYPES } from '@brain/contracts';
import { precisionAtK, recallAtK, ndcgAtK, mean } from '../dist/metrics.js';

const memory = z.object({ key: z.string().min(1), content: z.string().min(1), type: z.enum(MEMORY_TYPES), scope: ScopeRefSchema, sourceRef: z.string().min(1) }).strict();
const query = z.object({ id: z.string().min(1), task: z.string().min(1), scope: ScopeRefSchema, labels: z.record(z.union([z.literal(0), z.literal(1), z.literal(2)])) }).strict();
export function parseGolden(value) {
  const data = z.object({ version: z.literal(1), provenance: z.string(), memories: z.array(memory).min(1), cases: z.array(query).min(1) }).strict().parse(value);
  for (const [rows, label] of [[data.memories, 'memory'], [data.cases, 'case']]) {
    const keys = rows.map(r => r.key ?? r.id);
    if (new Set(keys).size !== keys.length) throw new Error(`duplicate ${label}`);
  }
  const byKey = new Map(data.memories.map(m => [m.key, m]));
  for (const c of data.cases) for (const [key, grade] of Object.entries(c.labels)) {
    if (!byKey.has(key)) throw new Error(`unknown label: ${key}`);
    if (grade > 0 && !scopeIncludes(byKey.get(key).scope, c.scope)) throw new Error(`unauthorized positive label: ${key}`);
  }
  return data;
}

export function distribution(values) {
  const sorted = values.filter(v => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
  return { n: sorted.length, p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) ?? null };
}

// Empty-label cases measure abstention, never inflate relevance denominators.
export function scoreRuns(cases, runs, k = 5) {
  const byId = new Map(cases.map(c => [c.id, c]));
  if (runs.length !== cases.length || new Set(runs.map(r => r.id)).size !== runs.length) throw new Error('one run per case required');
  const positives = [], negatives = [];
  for (const r of runs) {
    const c = byId.get(r.id);
    if (!c || new Set(r.keys).size !== r.keys.length) throw new Error('unknown case or duplicate result');
    const total = Object.values(c.labels).filter(g => g > 0).length;
    (total ? positives : negatives).push({ r, c });
  }
  return {
    cases: runs.length, positiveCases: positives.length, negativeCases: negatives.length,
    precisionAt5: positives.length ? mean(positives.map(({ r, c }) => precisionAtK(r.keys, c.labels, k))) : null,
    recallAt5: positives.length ? mean(positives.map(({ r, c }) => recallAtK(r.keys, c.labels, k))) : null,
    ndcgAt5: positives.length ? mean(positives.map(({ r, c }) => ndcgAtK(r.keys, c.labels, k))) : null,
    negativeAbstention: negatives.length ? negatives.filter(({ r }) => r.keys.length === 0).length / negatives.length : null,
    estimatedTokens: distribution(runs.map(r => r.tokens)), latencyMs: distribution(runs.map(r => r.ms)),
    scopeLeaks: runs.reduce((n, r) => n + r.leaks, 0),
    budgetViolations: runs.filter(r => r.budget !== null && r.tokens > r.budget).length,
  };
}

/** First explicit judgment per delivery+memory, matching the learning dedup rule.
 * Unknown/unattributed/omitted feedback cannot label delivered context. */
export function summarizeTelemetry({ contexts, membership, feedback, outcomes }) {
  const contextIds = new Set(contexts.map(c => c.id));
  const contextById = new Map(contexts.map(c => [c.id, c]));
  const chronological = rows => [...rows].sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? '') || (a.rowid ?? 0) - (b.rowid ?? 0));
  const included = membership.filter(m => m.included === 1 && contextIds.has(m.context_event_id));
  const seen = new Map();
  for (const f of chronological(feedback)) {
    if (f.context_id === null || f.useful === null || !contextIds.has(f.context_id)) continue;
    const taskId = contextById.get(f.context_id).task_id;
    if (taskId && f.task_id && taskId !== f.task_id) continue;
    const key = `${f.context_id}:${f.memory_id}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  let labeled = 0, useful = 0, usefulTokens = 0, labeledTokens = 0, totalTokens = 0, missingTokens = 0;
  const notUsefulByReason = {};
  for (const m of included) {
    if (m.token_count === null) missingTokens++; else totalTokens += m.token_count;
    const f = seen.get(`${m.context_event_id}:${m.memory_id}`);
    if (!f) continue;
    labeled++;
    if (f.useful === 1) useful++;
    else notUsefulByReason[f.reason ?? 'unspecified'] = (notUsefulByReason[f.reason ?? 'unspecified'] ?? 0) + 1;
    if (m.token_count !== null) {
      labeledTokens += m.token_count;
      if (f.useful === 1) usefulTokens += m.token_count;
    }
  }
  const taskIds = new Set(contexts.map(c => c.task_id).filter(Boolean));
  const correlatedOutcomes = chronological(outcomes).filter(o => {
    const c = contextById.get(o.context_id);
    return c?.task_id && c.task_id === o.task_id;
  });
  const completedTasks = new Set(correlatedOutcomes.map(o => contexts.find(c => c.id === o.context_id)?.task_id).filter(Boolean));
  // Count each task once, keeping its latest correlated outcome; outcomes alone
  // cannot prove that Brain caused success or that a memory was useful.
  const latest = new Map();
  for (const o of correlatedOutcomes) latest.set(o.task_id, o);
  const success = [...latest.values()].filter(o => o.outcome === 'success').length;
  const memoryOnly = contexts.filter(c => !c.has_sources && c.candidate_token_count > 0);
  const candidates = memoryOnly.reduce((n, c) => n + c.candidate_token_count, 0);
  return {
    deliveries: contexts.length, tasksWithContext: taskIds.size, tasksWithCorrelatedOutcome: completedTasks.size,
    outcomeCoverage: taskIds.size ? completedTasks.size / taskIds.size : null,
    latestOutcomeTasks: latest.size, latestSuccessTasks: success,
    observedSuccessRate: latest.size ? success / latest.size : null,
    deliveredMemoryItems: included.length, labeledItems: labeled, usefulItems: useful,
    notUsefulByReason,
    explicitlyIncorrectJudgments: notUsefulByReason.incorrect ?? 0,
    labelCoverage: included.length ? labeled / included.length : null,
    usefulFractionAmongLabeled: labeled ? useful / labeled : null,
    usefulTokenFractionAmongLabeled: labeledTokens ? usefulTokens / labeledTokens : null,
    confirmedUsefulTokenLowerBound: !missingTokens && totalTokens ? usefulTokens / totalTokens : null,
    missingTokenItems: missingTokens,
    estimatedTokens: distribution(contexts.map(c => c.token_count)),
    retrievalMs: distribution(contexts.map(c => c.retrieval_ms)),
    pipelineMs: distribution(contexts.map(c => [c.retrieval_ms, c.ranking_ms, c.compile_ms, c.optimize_ms].every(v => v !== null) ? c.retrieval_ms + c.ranking_ms + c.compile_ms + c.optimize_ms : null)),
    memoryOnlySelectionRatio: candidates ? memoryOnly.reduce((n, c) => n + c.token_count, 0) / candidates : null,
    memoryOnlySelectionDeliveries: memoryOnly.length,
    // These events cannot be assigned to a particular scope or time window.
    unscopedUnattributedFeedbackInSource: feedback.filter(f => !f.context_id).length,
    anonymousContextDeliveries: contexts.filter(c => !c.task_id).length,
    mismatchedOutcomeTaskIds: outcomes.filter(o => { const c = contexts.find(c => c.id === o.context_id); return c?.task_id && c.task_id !== o.task_id; }).length,
  };
}

const armSchema = z.object({
  taskId: z.string().min(1),
  arm: z.enum(['with-brain', 'without-brain']),
  tokenBasis: z.enum(['scripted-payload-estimate', 'model-reported']).optional(),
  totalTokens: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  testsPassed: z.boolean(),
  humanEdits: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
}).strict();
export function summarizeAB(raw) {
  const rows = raw.map(r => armSchema.parse(r));
  const tasks = new Map();
  for (const row of rows) {
    const pair = tasks.get(row.taskId) ?? {};
    if (pair[row.arm]) throw new Error('duplicate task arm');
    pair[row.arm] = row; tasks.set(row.taskId, pair);
  }
  const pairs = [...tasks.values()].filter(p => p['with-brain'] && p['without-brain']);
  const bases = new Set(pairs.flatMap(pair => Object.values(pair).map(row => row.tokenBasis ?? 'unspecified')));
  if (bases.size > 1) throw new Error('paired results must use one token basis');
  const total = (arm, key) => pairs.reduce((n, p) => n + p[arm][key], 0);
  const baseline = total('without-brain', 'totalTokens');
  const baselineMs = total('without-brain', 'elapsedMs');
  return { completePairs: pairs.length, incompleteTasks: tasks.size - pairs.length,
    tokenBasis: bases.values().next().value ?? null,
    tokenReduction: baseline ? 1 - total('with-brain', 'totalTokens') / baseline : null,
    elapsedReduction: baselineMs ? 1 - total('with-brain', 'elapsedMs') / baselineMs : null,
    withBrainTokens: total('with-brain', 'totalTokens'), withoutBrainTokens: baseline,
    withBrainPassing: pairs.filter(p => p['with-brain'].testsPassed).length,
    withoutBrainPassing: pairs.filter(p => p['without-brain'].testsPassed).length,
    withBrainToolCalls: total('with-brain', 'toolCalls'), withoutBrainToolCalls: total('without-brain', 'toolCalls'),
    withBrainHumanEdits: total('with-brain', 'humanEdits'), withoutBrainHumanEdits: total('without-brain', 'humanEdits'),
    withBrainElapsedMs: total('with-brain', 'elapsedMs'), withoutBrainElapsedMs: total('without-brain', 'elapsedMs'),
    causalConclusion: null, reason: 'Paired observations require independent task execution, frozen inputs, randomized arm order, and human review; counts alone are not causal evidence.' };
}
