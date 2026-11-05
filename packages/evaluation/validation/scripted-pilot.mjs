import { spawnSync } from 'node:child_process';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateTokens } from '@brain/token';
import { createBrain } from '../../mcp/dist/bootstrap.js';
import { snapshotDatabase } from '../dist/pilot-harness.js';
import { summarizeAB } from './evidence.mjs';

const root = realpathSync(fileURLToPath(new URL('../../..', import.meta.url)));
const [, , source, destination] = process.argv;
if (!source || !destination || process.argv.length !== 4) {
  throw new Error('Usage: node scripted-pilot.mjs <source SQLite database> <new results directory>');
}
const out = resolve(destination);
if (existsSync(out)) throw new Error('Results directory must be new');
if (!existsSync(source)) throw new Error('Source database does not exist');

// Both arms use the same evidence checks. The expected path is used only
// to score the result and fingerprint the source revision.
const cases = [
  {
    id: 'workflow-adherence',
    task: 'Locate the persisted workflow adherence counters for feedback and outcome coverage.',
    search: 'async getWorkflowAdherence()',
    file: 'packages/storage/src/event-store.ts',
    checks: ['async getWorkflowAdherence()', 'WITH tracked_tasks AS', 'AS tasksWithOutcome'],
  },
  {
    id: 'skeleton-loading',
    task: 'Locate the shared SkeletonLines loading component and check the aria-hidden skeleton markup.',
    search: 'export function SkeletonLines(',
    file: 'packages/visualizer/src/ui/components/Skeleton.tsx',
    checks: ['export function SkeletonLines(', 'aria-hidden="true"'],
  },
  {
    id: 'online-backup',
    task: 'Find the pre-task SQLite snapshot helper and check whether it uses the online backup API.',
    search: 'export async function snapshotDatabase(',
    file: 'packages/evaluation/src/pilot-harness.ts',
    checks: ['export async function snapshotDatabase(', 'await source.backup(snapshotPath)'],
  },
];

function findFiles(search) {
  const result = spawnSync('rg', ['-l', '-F', '-g', '*.ts', '-g', '*.tsx', '--', search, 'packages'], {
    cwd: root, encoding: 'utf8', timeout: 15000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(`rg failed: ${result.stderr}`);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(path => path.replaceAll('\\', '/')).sort();
}

function memoryFiles(content) {
  const prefixes = [...new Set(content.match(/\bpackages\/[\w-]+/g) ?? [])];
  const paths = content.match(/\b(?:packages|src)\/(?:[\w.-]+\/)*[\w.-]+\.tsx?\b/g) ?? [];
  return [...new Set(paths.flatMap(path => path.startsWith('packages/') ? [path] : prefixes.map(prefix => `${prefix}/${path}`)))];
}

function readEvidence(path, search) {
  if (!path.startsWith('packages/') || path.split('/').includes('..')) return [];
  const candidate = resolve(root, path);
  if (!existsSync(candidate)) return [];
  const resolved = realpathSync(candidate);
  const inside = relative(root, resolved);
  if (isAbsolute(inside) || inside.startsWith('..')) return [];
  const lines = readFileSync(resolved, 'utf8').split(/\r?\n/);
  const line = lines.findIndex(text => text.includes(search));
  if (line === -1) return [];
  return lines.slice(Math.max(0, line - 12), line + 26);
}

async function runArm(task, arm, gateway, runId) {
  const started = performance.now();
  const calls = [];
  const record = (name, request, result) => {
    calls.push({ name, tokens: estimateTokens(JSON.stringify({ name, request, result })) });
    return result;
  };
  const taskId = `${runId}-${task.id}`;
  let delivery;
  let sourceFile;
  let evidence = [];
  let usefulMemoryId;

  function verify(path) {
    const snippet = record('read-evidence', { path, search: task.search }, readEvidence(path, task.search));
    if (!task.checks.every(check => snippet.some(line => line.includes(check)))) return false;
    sourceFile = path;
    evidence = snippet;
    return true;
  }

  if (arm === 'with-brain') {
    const request = { task: task.task, scope: { kind: 'project', id: 'ai-brain' }, taskId, budget: { maxTokens: 900 } };
    delivery = record('brain_context', request, await gateway.getContext(request));
    if (!delivery.contextId) throw new Error('Brain did not record the scripted delivery');
    for (const item of delivery.items) {
      if (memoryFiles(item.content).some(verify)) {
        usefulMemoryId = item.memoryId;
        break;
      }
    }
  }

  if (!sourceFile) {
    const candidates = record('rg-file-search', { search: task.search }, findFiles(task.search));
    candidates.some(verify);
  }

  const testsPassed = sourceFile === task.file;
  if (delivery) {
    if (testsPassed && usefulMemoryId) {
      const feedback = { taskId, contextId: delivery.contextId, memoryId: usefulMemoryId, useful: true, reason: null, notes: null };
      record('brain_feedback', feedback, await gateway.feedback(feedback));
    }
    const outcome = { taskId, contextId: delivery.contextId, outcome: testsPassed ? 'success' : 'failure', signal: { testsPassed }, sessionId: null, notes: null };
    record('brain_record_outcome', outcome, await gateway.recordOutcome(outcome));
  }

  return {
    observation: {
      taskId, arm, tokenBasis: 'scripted-payload-estimate',
      totalTokens: estimateTokens(task.task) + estimateTokens(JSON.stringify({ sourceFile, evidence })) + calls.reduce((sum, call) => sum + call.tokens, 0),
      toolCalls: calls.length, testsPassed, humanEdits: 0, elapsedMs: performance.now() - started,
    },
    details: { caseId: task.id, arm, sourceFile, usedMemory: Boolean(testsPassed && usefulMemoryId), deliveredMemories: delivery?.items.length ?? 0, calls },
  };
}

mkdirSync(out);
const scratch = mkdtempSync(join(tmpdir(), 'brain-workflow-pilot-'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
let brain;
try {
  const db = await snapshotDatabase(source, join(scratch, 'pilot.db'));
  const snapshotSha256 = hash(db);
  brain = createBrain(db, { localFilesOnly: true });
  const observations = [];
  const details = [];
  const runId = randomUUID();
  const first = randomInt(2);
  const sourceHashes = Object.fromEntries(cases.map(task => [task.file, hash(join(root, task.file))]));
  for (const [index, task] of cases.entries()) {
    const arms = ['with-brain', 'without-brain'];
    if ((index + first) % 2) arms.reverse();
    for (const arm of arms) {
      const result = await runArm(task, arm, brain.gateway, runId);
      observations.push(result.observation);
      details.push(result.details);
    }
  }
  for (const [path, expectedHash] of Object.entries(sourceHashes)) {
    if (hash(join(root, path)) !== expectedHash) throw new Error(`Source changed during the pilot: ${path}`);
  }
  const summary = summarizeAB(observations);
  writeFileSync(join(out, 'task-ab.jsonl'), observations.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
  writeFileSync(join(out, 'pilot.json'), JSON.stringify({
    runId, generatedAt: new Date().toISOString(), snapshotSha256, sourceHashes,
    method: 'Three paired local source verification tasks. One Brain instance with first-use embedding latency. Randomized first arm and alternating order. Tokens estimate serialized scripted requests and results plus task and answer payload. No model-generated text or billing usage.',
    summary, cases, details,
  }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(summary, null, 2));
  if (observations.some(row => !row.testsPassed)) process.exitCode = 1;
} finally {
  brain?.close();
  rmSync(scratch, { recursive: true, force: true });
}
