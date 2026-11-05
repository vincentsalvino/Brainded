import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGolden, scoreRuns, summarizeTelemetry, summarizeAB, distribution } from './evidence.mjs';
import { runAblations } from './ablations.mjs';

test('golden dataset has 40 source-referenced cases, 4 negatives, and no unauthorized labels', () => {
  const data = parseGolden(JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8')));
  assert.equal(data.cases.length, 40);
  assert.equal(data.cases.filter(c => Object.values(c.labels).every(v => v === 0)).length, 4);
  const bad = structuredClone(data); bad.cases[0].labels.foreign = 2;
  assert.throws(() => parseGolden(bad), /unauthorized/);
  const duplicate = structuredClone(data); duplicate.cases.push(duplicate.cases[0]);
  assert.throws(() => parseGolden(duplicate), /duplicate/);
  data.cases[0].labels.missing = 1;
  assert.throws(() => parseGolden(data), /unknown label/);
});

test('quality metrics distinguish relevance, abstention, leaks, and budget failures', () => {
  const cases = [{ id: 'p', labels: { a: 2, b: 0 } }, { id: 'n', labels: {} }];
  const runs = [{ id: 'p', keys: ['b', 'a'], tokens: 101, budget: 100, leaks: 1, ms: 2 }, { id: 'n', keys: [], tokens: 0, budget: 100, leaks: 0, ms: 4 }];
  const result = scoreRuns(cases, runs);
  assert.equal(result.precisionAt5, .2);
  assert.equal(result.recallAt5, 1);
  assert.ok(Math.abs(result.ndcgAt5 - 1 / Math.log2(3)) < 1e-10);
  assert.equal(result.negativeAbstention, 1);
  assert.equal(result.scopeLeaks, 1);
  assert.equal(result.budgetViolations, 1);
  assert.throws(() => scoreRuns(cases, [runs[0], runs[0]]), /one run/);
  assert.deepEqual(distribution([]), { n: 0, p50: null, p95: null, max: null });
});

test('telemetry attributes only delivered feedback, deduplicates, and exposes missing measurements', () => {
  const input = {
    contexts: [{ id: 'c', task_id: 't', token_count: 40, candidate_token_count: 100, retrieval_ms: 3, ranking_ms: 1, compile_ms: null, optimize_ms: 1, has_sources: 0 }],
    membership: [{ context_event_id: 'c', memory_id: 'a', included: 1, token_count: 10 }, { context_event_id: 'c', memory_id: 'b', included: 1, token_count: 30 }, { context_event_id: 'c', memory_id: 'omitted', included: 0, token_count: null }],
    feedback: [{ context_id: 'c', memory_id: 'a', useful: 1 }, { context_id: 'c', memory_id: 'a', useful: 0 }, { context_id: 'c', memory_id: 'omitted', useful: 1 }, { context_id: null, memory_id: 'b', useful: 1 }],
    outcomes: [{ context_id: 'c', task_id: 'wrong', outcome: 'success' }, { context_id: 'c', task_id: 't', outcome: 'partial' }],
  };
  const t = summarizeTelemetry(input);
  assert.equal(t.labeledItems, 1); assert.equal(t.usefulItems, 1);
  assert.equal(t.confirmedUsefulTokenLowerBound, .25); assert.equal(t.labelCoverage, .5);
  assert.equal(t.memoryOnlySelectionRatio, .4); assert.equal(t.outcomeCoverage, 1);
  assert.equal(t.observedSuccessRate, 0); assert.equal(t.mismatchedOutcomeTaskIds, 1);
  assert.equal(t.pipelineMs.n, 0);
  input.membership[1].token_count = null;
  assert.equal(summarizeTelemetry(input).confirmedUsefulTokenLowerBound, null);
  input.contexts[0].has_sources = 1;
  assert.equal(summarizeTelemetry(input).memoryOnlySelectionRatio, null);
  input.feedback.push({ context_id: 'c', memory_id: 'b', useful: 0, reason: 'incorrect' });
  assert.equal(summarizeTelemetry(input).explicitlyIncorrectJudgments, 1);
  assert.equal(summarizeTelemetry(input).usefulItems, 1);
});

test('unknown evidence stays unavailable instead of becoming zero or success', () => {
  const t = summarizeTelemetry({ contexts: [], membership: [], feedback: [], outcomes: [] });
  assert.equal(t.outcomeCoverage, null); assert.equal(t.usefulFractionAmongLabeled, null);
  assert.equal(t.observedSuccessRate, null); assert.equal(t.memoryOnlySelectionRatio, null);
  assert.equal(summarizeAB([]).tokenReduction, null);
});

test('A/B counts complete pairs only, keeps task failure and human edits visible', () => {
  const row = (taskId, arm, totalTokens, testsPassed = true) => ({ taskId, arm, totalTokens, testsPassed, toolCalls: 4, humanEdits: 2, elapsedMs: 100 });
  const rows = [row('t', 'without-brain', 100), row('t', 'with-brain', 80, false), row('incomplete', 'with-brain', 999)];
  const report = summarizeAB(rows);
  assert.equal(report.completePairs, 1); assert.equal(report.incompleteTasks, 1);
  assert.ok(Math.abs(report.tokenReduction - .2) < 1e-10);
  assert.equal(report.withBrainPassing, 0); assert.equal(report.withoutBrainPassing, 1);
  assert.equal(report.withBrainHumanEdits, 2); assert.equal(report.causalConclusion, null);
  assert.throws(() => summarizeAB([...rows, rows[0]]), /duplicate/);
  assert.throws(() => summarizeAB([{ ...rows[0], totalTokens: -1 }]));
  assert.throws(() => summarizeAB([{ ...rows[0], tokenBasis: 'model-reported' }, { ...rows[1], tokenBasis: 'scripted-payload-estimate' }]), /token basis/);
  const scripted = summarizeAB(rows.slice(0, 2).map(r => ({ ...r, tokenBasis: 'scripted-payload-estimate' })));
  assert.equal(scripted.tokenBasis, 'scripted-payload-estimate');
  assert.equal(scripted.withBrainTokens, 80);
  assert.equal(scripted.elapsedReduction, 0);
});

test('fixture rankings remain identical across random storage UUIDs', async () => {
  const scope = { kind: 'project', id: 'deterministic' };
  const memories = ['first', 'second', 'third'].map(key => ({ key, type: 'fact', content: 'identical query match', scope }));
  const cases = [{ id: 'case', task: 'query match', scope, labels: { first: 2 } }];
  const embeddings = { embed: async () => Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0) };
  const a = await runAblations(memories, cases, embeddings);
  const b = await runAblations(memories, cases, embeddings);
  for (const name of Object.keys(a)) {
    assert.deepEqual(a[name].perCase[0].keys, b[name].perCase[0].keys);
    assert.equal(a[name].perCase[0].tokens, b[name].perCase[0].tokens);
  }
});

test('latest task outcome uses chronology and anonymous contexts do not inflate task success', () => {
  const report = summarizeTelemetry({
    contexts: [{ id: 'a', task_id: 'task', token_count: 0 }, { id: 'b', task_id: null, token_count: 0 }], membership: [], feedback: [],
    outcomes: [
      { context_id: 'a', task_id: 'task', outcome: 'failure', timestamp: '2026-11-05T01:00:00Z' },
      { context_id: 'b', task_id: 'anonymous', outcome: 'success', timestamp: '2026-11-05T02:00:00Z' },
      { context_id: 'a', task_id: 'task', outcome: 'success', timestamp: '2026-11-04T01:00:00Z' },
    ],
  });
  assert.equal(report.latestOutcomeTasks, 1); assert.equal(report.observedSuccessRate, 0);
  assert.equal(report.anonymousContextDeliveries, 1);
});
