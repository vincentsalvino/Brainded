import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_MEMORY_RELEVANCE, LocalEmbeddingProvider } from '@brain/storage';
import { runAblations } from './ablations.mjs';
import { parseGolden } from './evidence.mjs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const training = parseGolden(read('./golden.json'));
const scope = { kind: 'project', id: 'fixture-brain' };
const holdout = parseGolden({
  ...training,
  cases: read('./relevance-holdout.json').map(row => ({ ...row, scope })),
}).cases;
const provider = new LocalEmbeddingProvider({ localFilesOnly: true });
const vectors = new Map();
const embeddings = {
  embed(text) {
    if (!vectors.has(text)) vectors.set(text, provider.embed(text));
    return vectors.get(text);
  },
};

const results = [];
for (const [suite, cases] of [['calibration', training.cases], ['holdout', holdout]]) {
  const before = (await runAblations(training.memories, cases, embeddings))['hybrid-weighted'];
  const filtered = await runAblations(training.memories, cases, embeddings, true, DEFAULT_MEMORY_RELEVANCE);
  const after = filtered['hybrid-weighted'];
  const lexicalOnly = filtered['bm25-only'];
  const semanticRecoveries = cases.filter(({ labels }, i) => {
    const hasTarget = run => run.perCase[i].keys.slice(0, 5).some(key => labels[key] > 0);
    return hasTarget(after) && !hasTarget(lexicalOnly);
  }).map(({ id }) => id);
  results.push({ suite, before, after, semanticRecoveries });
}
console.log(JSON.stringify({ relevance: DEFAULT_MEMORY_RELEVANCE, results }, null, 2));
for (const { suite, before, after, semanticRecoveries } of results) {
  assert.ok(after.recallAt5 >= before.recallAt5, `${suite}: relevant recall fell`);
  assert.ok(after.negativeAbstention >= (suite === 'calibration' ? 1 : 7 / 8), `${suite}: abstention regressed`);
  if (suite === 'holdout') assert.ok(semanticRecoveries.length > 0, 'Holdout must demonstrate semantic recovery');
  assert.equal(after.scopeLeaks, 0, `${suite}: scope leak`);
}
