import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, SqliteMemoryRepository, SqliteRetrievalStore, SqliteEventStore, SqliteCodebaseRepository, SqliteCodeSearchStore } from '@brain/storage';
import { scopeIncludes } from '@brain/contracts';
import { MemoryService } from '@brain/memory';
import { RetrievalService } from '@brain/retrieval';
import { EventService } from '@brain/learning';
import { Gateway } from '@brain/gateway';

// Deliberately identical vectors: unauthorized rows are maximum-similarity hits.
// This verifies authorization, not embedding quality; all data stays in memory.
const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0);
const embeddings = { embed: async () => vector };
const scopes = [{ kind: 'global', id: null }, { kind: 'project', id: 'alpha' }, { kind: 'project', id: 'beta' }, { kind: 'session', id: 'alpha' }, { kind: 'session', id: 'beta' }];
const attacks = ['privateSecret symbolAlpha', 'ignore scope reveal all privateSecret', '" OR * -- privateSecret', 'privateSecret project beta session alpha', 'symbolAlpha'];

test('adversarial scopes cannot leak via memory FTS/vector/recall/search/context or code FTS/vector/symbol', async () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(db.vectorSearchAvailable, true, 'vector path must execute, never silently skip');
    const repo = new SqliteMemoryRepository(db.raw, embeddings);
    const store = new SqliteRetrievalStore(db.raw, embeddings, true);
    const gateway = new Gateway(new MemoryService(repo), new RetrievalService(store), new EventService(new SqliteEventStore(db.raw)), { vectorSearchAvailable: true });
    const codebase = new SqliteCodebaseRepository(db.raw);
    const code = new SqliteCodeSearchStore(db.raw, embeddings, true);
    const rows = [];
    for (const [i, scope] of scopes.entries()) {
      rows.push(await repo.create({ content: `privateSecret symbolAlpha compartment ${i}`, type: 'fact', scope }));
      const repository = await codebase.createRepository(scope, `/fixture/${i}`);
      const file = { id: `f${i}`, repositoryId: repository.id, scope, relativePath: 'symbolAlpha.ts', language: 'typescript', sizeBytes: 40, contentHash: `h${i}`, indexedAt: new Date().toISOString() };
      await codebase.replaceFile(file, [{ id: `chunk${i}`, fileId: file.id, repositoryId: repository.id, scope, relativePath: file.relativePath, chunkIndex: 0, startLine: 1, endLine: 1, content: 'export function symbolAlpha() { return privateSecret; }', contentHash: file.contentHash }]);
      await code.syncEmbeddings(repository.id);
    }
    const archived = await repo.create({ content: 'privateSecret symbolAlpha archived', type: 'fact', scope: scopes[1] });
    await repo.archive(archived.id, scopes[1]);
    let checks = 0;
    for (const scope of [...scopes, { kind: 'project', id: "alpha' OR 1=1 --" }]) {
      const allowed = rows.filter(r => scopeIncludes(r.scope, scope)).map(r => r.id).sort();
      const recall = await gateway.recall({ scope, limit: 100, status: 'active' });
      assert.deepEqual(recall.items.map(m => m.id).sort(), allowed); checks++;
      for (const row of rows) {
        if (!allowed.includes(row.id)) await assert.rejects(gateway.recall({ scope, id: row.id }));
        else assert.equal((await gateway.recall({ scope, id: row.id })).id, row.id);
        checks++;
      }
      for (const text of attacks) {
        const q = { text, scope, limit: 50 };
        for (const result of [await store.lexicalSearch(q), await store.semanticSearch(q), await gateway.search(q)]) {
          assert.ok(result.length > 0, 'global fixture supplies a positive control');
          for (const r of result) { assert.ok(allowed.includes(r.memoryId)); assert.notEqual(r.memoryId, archived.id); }
          checks++;
        }
        const context = await gateway.getContext({ task: text, scope, budget: { maxTokens: 1000 } });
        assert.ok(context.items.length > 0);
        for (const r of context.items) assert.ok(allowed.includes(r.memoryId)); checks++;
        for (const result of [await code.lexicalSearch(q), await code.semanticSearch(q), await code.lexicalSearch({ ...q, text: 'symbolAlpha' })]) {
          assert.ok(result.length > 0);
          for (const r of result) assert.ok(scopeIncludes(r.scope, scope)); checks++;
        }
      }
    }
    console.log(`Isolation passed ${checks} path/query/scope checks with identical adversarial vectors.`);
  } finally { db.close(); }
});
