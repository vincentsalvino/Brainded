import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DEFAULT_MEMORY_RELEVANCE, openDatabase, SqliteRetrievalStore, LocalEmbeddingProvider } from '@brain/storage';
import { mergeCandidates } from '@brain/retrieval';
import { rank } from '@brain/ranking';
import { estimateTokens } from '@brain/token';
import { runAblations } from './ablations.mjs';
import { loadDataset } from '../dist/dataset.js';
import { snapshotDatabase } from '../dist/pilot-harness.js';
import { parseGolden, scoreRuns, summarizeTelemetry, summarizeAB } from './evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const allowed = new Set(['--db', '--out', '--ab', '--task-id']);
const seenArgs = new Set();
for (let i = 0; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || seenArgs.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node run.mjs --db <explicit SQLite path> --out <new results directory> [--ab <JSONL>] [--task-id <id>]');
  seenArgs.add(args[i]);
}
const arg = name => args[args.indexOf(name) + 1];
if (!args.includes('--db') || !args.includes('--out')) throw new Error('--db and --out are required; no live database default');
const source = resolve(arg('--db')), out = resolve(arg('--out'));
if (existsSync(out)) throw new Error('Output directory must be new so earlier evidence cannot be overwritten');
if (!existsSync(source)) throw new Error('Source database does not exist');
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'brain-validation-'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const fingerprint = hash(fileURLToPath(import.meta.url));
const goldenPath = join(here, 'golden.json');
const golden = parseGolden(JSON.parse(readFileSync(goldenPath, 'utf8')));
const runTests = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-isolation=none', join(here, 'evidence.test.mjs'), join(here, 'isolation.test.mjs')], { cwd: root, encoding: 'utf8', timeout: 120000 });
writeFileSync(join(out, 'validation-tests.tap'), `${runTests.stdout ?? ''}${runTests.stderr ?? ''}`);
const report = { version: 1, generatedAt: new Date().toISOString(), timezone: 'Asia/Taipei', runtime: process.version, platform: `${process.platform}/${process.arch}`, runnerSha256: fingerprint, goldenSha256: hash(goldenPath), sourcePath: source, goldenProvenance: golden.provenance, testsPassed: runTests.status === 0, ablations: {}, limitations: [
  'Golden labels are authored regression fixtures grounded in repository references, not 40 independent real user tasks or a statistical holdout.',
  'BM25 and vector fusion use production components. Weighted ranking is not a neural reranker; none is installed.',
  'Context token counts use the production ceil(characters/3) estimate and exclude the MCP envelope. Paired observations declare their own measurement basis.',
  'Candidate-to-delivery selection ratio is not total workflow token savings. Selective feedback leaves most deliveries unjudged.',
  'Historical outcomes are self-reported and contain pilot activity. Tasks that never contacted Brain are invisible.',
  'Cold model start is separate; fixture stage latency includes cached embeddings and is not representative live latency.',
  'Current-corpus replay is not a time-causal historical replay: content and eligibility can have changed since delivery.',
  'No speedup, correctness improvement, or user time saved is claimed without paired task execution.',
] };
report.sourceHashes = Object.fromEntries([
  'package-lock.json', 'packages/evaluation/validation/run.mjs',
  'packages/evaluation/validation/evidence.mjs', 'packages/evaluation/validation/ablations.mjs',
  'packages/evaluation/validation/evidence.test.mjs', 'packages/evaluation/validation/isolation.test.mjs',
  'packages/evaluation/src/pilot-harness.ts', 'packages/storage/src/local-embedding-provider.ts',
  'packages/storage/src/retrieval-store.ts', 'packages/storage/src/db.ts',
  'packages/core/ranking/src/rank.ts', 'packages/core/token/src/optimize.ts',
].map(path => [path, hash(join(root, path))]));
let audit;
try {
  const snapshot = join(scratch, 'snapshot.db');
  await snapshotDatabase(source, snapshot);
  report.snapshotSha256 = hash(snapshot);
  report.databaseBytes = statSync(snapshot).size;
  audit = openDatabase(snapshot); // only the isolated copy may migrate or run FTS integrity commands
  const db = audit.raw;
  const count = table => db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
  report.storage = {
    integrity: db.pragma('integrity_check'), foreignKeyViolations: db.pragma('foreign_key_check'),
    counts: Object.fromEntries(['memories', 'retrieval_events', 'context_events', 'feedback_events', 'outcome_events', 'memory_mutation_events', 'repositories', 'code_files', 'code_chunks'].map(t => [t, count(t)])),
    scopes: db.prepare('SELECT scope_kind,scope_id,status,count(*) count FROM memories GROUP BY 1,2,3 ORDER BY 1,2,3').all(),
    provenance: db.prepare('SELECT source_origin,count(*) count FROM memories GROUP BY 1').all(),
    activeWithoutCreateAudit: db.prepare("SELECT count(*) n FROM memories m WHERE m.status='active' AND NOT EXISTS(SELECT 1 FROM memory_mutation_events e WHERE e.memory_id=m.id AND e.mutation_type='create')").get().n,
    vectorAvailable: audit.vectorSearchAvailable,
    vectorRows: audit.vectorSearchAvailable ? count('memory_vectors') : null,
    activeWithoutVector: audit.vectorSearchAvailable ? db.prepare("SELECT count(*) n FROM memories m LEFT JOIN memory_vectors v ON v.memory_id=m.id WHERE m.status='active' AND v.memory_id IS NULL").get().n : null,
    supersedesEdges: db.prepare('SELECT count(*) n FROM memories WHERE supersedes IS NOT NULL').get().n,
    memoriesUpdatedAfterCreation: db.prepare('SELECT count(*) n FROM memories WHERE updated_at > created_at').get().n,
    activeSupersededTargets: db.prepare("SELECT count(DISTINCT old.id) n FROM memories old JOIN memories newer ON newer.supersedes=old.id WHERE old.status='active' AND newer.status='active'").get().n,
    exactDuplicateActiveGroups: db.prepare("SELECT count(*) n FROM (SELECT content,scope_kind,scope_id FROM memories WHERE status='active' GROUP BY 1,2,3 HAVING count(*)>1)").get().n,
    memoriesWithoutTaskProvenance: db.prepare('SELECT count(*) n FROM memories WHERE source_task_id IS NULL').get().n,
    ftsIntegrity: null,
  };
  try { db.exec("INSERT INTO memories_fts(memories_fts,rank) VALUES ('integrity-check',1)"); report.storage.ftsIntegrity = 'ok'; }
  catch (e) { report.storage.ftsIntegrity = String(e); }
  const contexts = db.prepare('SELECT c.*, EXISTS(SELECT 1 FROM context_event_sources s WHERE s.context_event_id=c.id) has_sources FROM context_events c ORDER BY timestamp,rowid').all();
  const telemetry = {
    contexts,
    membership: db.prepare('SELECT * FROM context_event_memories').all(),
    feedback: db.prepare('SELECT * FROM feedback_events ORDER BY timestamp,rowid').all(),
    outcomes: db.prepare('SELECT * FROM outcome_events ORDER BY timestamp,rowid').all(),
  };
  const summarize = cs => summarizeTelemetry({ ...telemetry, contexts: cs });
  report.telemetry = { all: summarize(contexts), byScope: {} };
  for (const key of [...new Set(contexts.map(c => `${c.scope_kind}:${c.scope_id ?? ''}`))]) {
    report.telemetry.byScope[key] = summarize(contexts.filter(c => `${c.scope_kind}:${c.scope_id ?? ''}` === key));
  }
  report.telemetry.recent30Days = summarize(contexts.filter(c => Date.parse(c.timestamp) >= Date.now() - 30 * 86400000));
  if (seenArgs.has('--task-id')) {
    report.telemetry.requestedTaskId = arg('--task-id');
    report.telemetry.currentTask = summarize(contexts.filter(c => c.task_id === report.telemetry.requestedTaskId));
  }
  report.ab = summarizeAB(args.includes('--ab') ? readFileSync(resolve(arg('--ab')), 'utf8').split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s)) : []);

  // Explicit offline mode: missing cached model is reported as unavailable,
  // never silently replaced with synthetic embeddings or a network download.
  const embeddings = new LocalEmbeddingProvider({ localFilesOnly: true });
  const cache = new Map();
  const cached = { embed: async text => { if (!cache.has(text)) cache.set(text, embeddings.embed(text)); return cache.get(text); } };
  const startModel = performance.now();
  try { await cached.embed('Brain validation offline model probe'); report.model = { available: true, coldStartMs: performance.now() - startModel, name: 'Xenova/all-MiniLM-L6-v2', localFilesOnly: true }; }
  catch (e) { report.model = { available: false, error: String(e), localFilesOnly: true }; }
  const canVector = report.model.available && audit.vectorSearchAvailable;
  if (!report.model.available) throw new Error('Cached local model unavailable. Storage diagnostics were recorded; cache the model separately and rerun.');
  report.ablations = await runAblations(golden.memories, golden.cases, cached, canVector);
  const filtered = await runAblations(golden.memories, golden.cases, cached, canVector, DEFAULT_MEMORY_RELEVANCE);
  if (canVector) report.ablations['hybrid-relevance'] = filtered['hybrid-weighted'];
  const historicalPath = join(here, '../datasets/phase1-realworld.jsonl');
  const historical = loadDataset(historicalPath);
  report.historicalFixture = { sha256: hash(historicalPath), examples: historical.length, provenance: 'Existing phase1-realworld.jsonl: original feedback-derived cases plus synthetic isolation/pilot regression cases. Not an independent organic holdout.', ablations: {} };
  const historyRuns = {};
  for (const example of historical) {
    const result = await runAblations(example.memories, [example], cached, canVector);
    for (const [name, value] of Object.entries(result)) (historyRuns[name] ??= []).push(...value.perCase);
  }
  for (const [name, runs] of Object.entries(historyRuns)) report.historicalFixture.ablations[name] = { ...scoreRuns(historical, runs), perCase: runs };

  // Replay current project queries against the snapshot without writing events.
  const liveStore = new SqliteRetrievalStore(db, cached, audit.vectorSearchAvailable, DEFAULT_MEMORY_RELEVANCE);
  report.currentCorpusReplay = [];
  const replayCases = [
    { text: 'Compute workflow outcome coverage and feedback denominators', scope: { kind: 'project', id: 'ai-brain' } },
    { text: 'Reuse SkeletonLines for loading states and reduced motion', scope: { kind: 'project', id: 'ai-brain' } },
    { text: 'quasar neutrino banana unrelated measurement', scope: { kind: 'project', id: 'ai-brain' } },
  ];
  for (const q of replayCases) {
    const lex = await liveStore.lexicalSearch({ ...q, limit: 20 });
    const sem = audit.vectorSearchAvailable ? await liveStore.semanticSearch({ ...q, limit: 20 }) : [];
    report.currentCorpusReplay.push({ query: q.text, scope: q.scope, lexicalCount: lex.length, semanticCount: sem.length, ranked: rank({ candidates: mergeCandidates(lex, sem) }).map(r => ({ memoryId: r.memoryId, score: r.score, estimatedTokens: estimateTokens(r.record.content) })) });
  }
  report.gates = {
    validationTests: report.testsPassed,
    integrity: report.storage.integrity.every(r => Object.values(r).every(v => v === 'ok')),
    foreignKeys: report.storage.foreignKeyViolations.length === 0,
    fts: report.storage.ftsIntegrity === 'ok',
    goldenIsolation: Object.values(report.ablations).every(r => r.scopeLeaks === 0),
    budgets: Object.values(report.ablations).every(r => r.budgetViolations === 0),
    vectorAblationsExecuted: canVector,
    historicalIsolation: Object.values(report.historicalFixture.ablations).every(r => r.scopeLeaks === 0),
    historicalBudgets: Object.values(report.historicalFixture.ablations).every(r => r.budgetViolations === 0),
  };
  if (report.telemetry.currentTask) {
    const task = report.telemetry.currentTask;
    report.gates.requestedTaskWorkflow = task.deliveries > 0 && task.tasksWithCorrelatedOutcome === 1;
  }
  // Research readiness is separate from correctness gates. A truthful red
  // finding must remain visible even when implementation tests all pass.
  report.readiness = {
    unrelatedQueryAbstention: report.ablations['hybrid-relevance']?.negativeAbstention === 1,
    pairedWorkflowEvidence: report.ab.tokenBasis === 'model-reported' && report.ab.completePairs >= 20,
    codeAnchorsHaveIndexedSources: report.storage.counts.code_files > 0,
    learningDefaultEnable: false,
  };
} catch (e) {
  report.error = String(e);
  process.exitCode = 1;
} finally {
  audit?.close(); rmSync(scratch, { recursive: true, force: true });
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2));
  const pct = n => n === null || n === undefined ? 'unavailable' : `${(n * 100).toFixed(1)}%`;
  const rows = Object.entries(report.ablations).map(([name, r]) => `| ${name} | ${pct(r.precisionAt5)} | ${pct(r.recallAt5)} | ${r.ndcgAt5?.toFixed(3)} | ${pct(r.negativeAbstention)} | ${r.estimatedTokens.p50} | ${r.latencyMs.p95?.toFixed(1)} |`).join('\n');
  const historicalRows = Object.entries(report.historicalFixture?.ablations ?? {}).map(([name,r]) => '| '+name+' | '+pct(r.recallAt5)+' | '+r.ndcgAt5?.toFixed(3)+' |').join('\n');
  const t = report.telemetry?.recent30Days;
  const storage = report.storage;
  const storageSummary = storage ? JSON.stringify({ counts: storage.counts, integrity: storage.integrity, foreignKeyViolations: storage.foreignKeyViolations.length, ftsIntegrity: storage.ftsIntegrity, activeWithoutVector: storage.activeWithoutVector, activeWithoutCreateAudit: storage.activeWithoutCreateAudit, supersedesEdges: storage.supersedesEdges, activeSupersededTargets: storage.activeSupersededTargets, exactDuplicateActiveGroups: storage.exactDuplicateActiveGroups }, null, 2) : 'Unavailable';
  const ab = report.ab;
  const pairSummary = ab?.completePairs
    ? `${ab.completePairs} pairs. Measurement basis: ${ab.tokenBasis}. With Brain: ${ab.withBrainElapsedMs.toFixed(1)} ms, ${ab.withBrainTokens} tokens, ${ab.withBrainPassing}/${ab.completePairs} passed. Without Brain: ${ab.withoutBrainElapsedMs.toFixed(1)} ms, ${ab.withoutBrainTokens} tokens, ${ab.withoutBrainPassing}/${ab.completePairs} passed.`
    : 'No complete paired observations.';
  const task = report.telemetry?.currentTask;
  const taskSummary = task ? `\n\nRequested task: ${task.deliveries} context deliveries, ${task.tasksWithCorrelatedOutcome} correlated task outcomes, ${task.labeledItems}/${task.deliveredMemoryItems} memory items judged.` : '';
  writeFileSync(join(out, 'RESULTS.md'), `# Brain device validation\n\nGenerated ${report.generatedAt} (UTC; device timezone Asia/Taipei).\n\nCorrectness gates: ${JSON.stringify(report.gates ?? {})}. Research readiness: ${JSON.stringify(report.readiness ?? {})}. ${report.error ?? ''}\n\n## Retrieval ablations\n\n40 authored repository regression cases; labels require human review. No statistical significance claim. Precision@5 divides by five even if fewer results exist.\n\n| Stage | P@5 | R@5 | NDCG@5 | Negative abstention | Median estimated tokens | p95 ms |\n|---|---:|---:|---:|---:|---:|---:|\n${rows}\n\n## Existing seven-case historical fixture\n\n| Stage | R@5 | NDCG@5 |\n|---|---:|---:|\n${historicalRows}\n\nRe-executed under the same current model and runtime, not compared across different datasets.\n\n## Storage\n\n\`\`\`json\n${storageSummary}\n\`\`\`\n\n## Observed workflow in last 30 days\n\n${t ? `${t.deliveries} deliveries; ${t.tasksWithContext} tasks with context; ${t.tasksWithCorrelatedOutcome} with correlated outcomes (${pct(t.outcomeCoverage)} coverage). ${t.usefulItems}/${t.labeledItems} explicitly judged delivered memories were useful; labels cover ${pct(t.labelCoverage)} of delivered memory items. Retrieval p50/p95: ${t.retrievalMs.p50}/${t.retrievalMs.p95} ms. Median estimated context: ${t.estimatedTokens.p50} tokens. Memory-only delivery/candidate ratio: ${pct(t.memoryOnlySelectionRatio)} (selection, not workflow savings).` : 'Unavailable.'}\n\nA/B results: ${pairSummary}${taskSummary}\n\n## Limits\n\n${report.limitations.map(s => `- ${s}`).join('\n')}\n\nFull per-scope denominators, storage checks, provenance hashes, and per-case results are in results.json. No live memory content is exported by the telemetry report.\n`);
  if (report.gates && Object.values(report.gates).some(v => !v)) process.exitCode = 1;
  console.log(JSON.stringify({ out, gates: report.gates, error: report.error, counts: report.storage?.counts, ablations: Object.fromEntries(Object.entries(report.ablations).map(([k, v]) => [k, { recallAt5: v.recallAt5, ndcgAt5: v.ndcgAt5, negativeAbstention: v.negativeAbstention }])) }, null, 2));
}
