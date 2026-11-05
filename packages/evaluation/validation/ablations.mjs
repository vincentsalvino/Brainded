import { openDatabase, SqliteMemoryRepository, SqliteRetrievalStore } from '@brain/storage';
import { mergeCandidates } from '@brain/retrieval';
import { rank } from '@brain/ranking';
import { compileContext } from '@brain/context';
import { optimizeContext, estimateTokens } from '@brain/token';
import { scopeIncludes } from '@brain/contracts';
import { scoreRuns } from './evidence.mjs';

export async function runAblations(memories, cases, embeddings, semantic = true, relevance) {
  const db = openDatabase(':memory:');
  try {
    if (semantic && !db.vectorSearchAvailable) throw new Error('Vector ablation requested but sqlite-vec unavailable');
    const repo = new SqliteMemoryRepository(db.raw, embeddings);
    const stableIds = new Map(), keys = new Map();
    for (const [index, m] of memories.entries()) {
      const row = await repo.create({ type: m.type, content: m.content, scope: m.scope, source: { origin: 'import', sourceRef: m.sourceRef ?? 'historical-fixture' } });
      // Production IDs are random UUIDs. Canonical fixture IDs keep rank()'s
      // documented final tie-break reproducible without changing production SQL.
      const stable = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      stableIds.set(row.id, stable); keys.set(stable, m.key);
    }
    const canonical = xs => xs.map(c => ({ ...c, memoryId: stableIds.get(c.memoryId), record: { ...c.record, id: stableIds.get(c.memoryId) } }));
    const store = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable, relevance);
    const variants = ['bm25-only', ...(semantic ? ['hybrid-merge-order', 'hybrid-weighted', 'hybrid-budget-256', 'hybrid-budget-1024'] : [])];
    const runs = Object.fromEntries(variants.map(v => [v, []]));
    for (const c of cases) {
      const query = { text: c.task, scope: c.scope, limit: 50 };
      const startLex = performance.now();
      const lex = canonical(await store.lexicalSearch(query));
      const lexMs = performance.now() - startLex;
      const startSem = performance.now();
      const sem = semantic ? canonical(await store.semanticSearch(query)) : [];
      const retrievalMs = lexMs + performance.now() - startSem;
      const merged = mergeCandidates(lex, sem);
      for (const name of variants) {
        const started = performance.now();
        const candidates = name === 'bm25-only' ? lex : merged;
        const ranked = rank({ candidates });
        let items = name === 'hybrid-merge-order' ? candidates.map(x => ({ ...x, content: x.record.content, scope: x.record.scope })) : ranked.map(x => ({ ...x, content: x.record.content, scope: x.record.scope }));
        const budget = name.includes('budget-') ? Number(name.split('-').at(-1)) : null;
        if (budget !== null) items = optimizeContext(compileContext({ task: c.task, scope: c.scope, rankedResults: ranked }), { maxTokens: budget }).items;
        runs[name].push({ id: c.id, keys: items.map(i => keys.get(i.memoryId)), tokens: items.reduce((n, i) => n + estimateTokens(i.content), 0), ms: (name === 'bm25-only' ? lexMs : retrievalMs) + performance.now() - started, budget, leaks: items.filter(i => !scopeIncludes(i.scope, c.scope)).length });
      }
    }
    return Object.fromEntries(variants.map(name => [name, { ...scoreRuns(cases, runs[name]), perCase: runs[name] }]));
  } finally { db.close(); }
}
