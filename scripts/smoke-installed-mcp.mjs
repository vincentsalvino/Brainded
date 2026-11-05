import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [, , cli, database, cache] = process.argv;
if (!cli || !database || !cache || process.argv.length !== 5) {
  throw new Error('Usage: node scripts/smoke-installed-mcp.mjs <installed cli.js> <scratch db> <model cache>');
}
const cwd = dirname(resolve(database));
const generated = execFileSync(process.execPath, [resolve(cli), '--config', resolve(database)], { cwd, encoding: 'utf8' });
const config = JSON.parse(generated).mcpServers['ai-brain'];
assert.equal(config.args[0], resolve(cli));
assert.equal(config.args[1], resolve(database));
const scope = { kind: 'project', id: 'installer-smoke' };

async function useInstalledClient(check) {
  const client = new Client({ name: 'installer-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    ...config, cwd,
    env: { BRAIN_LOCAL_FILES_ONLY: '1', BRAIN_MODEL_CACHE_DIR: resolve(cache) },
  });
  try {
    await client.connect(transport);
    await check(client, async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError ?? false, false, JSON.stringify(result.content));
      return result.structuredContent;
    });
  } finally {
    await client.close();
  }
}

let memoryId;
await useInstalledClient(async (client, call) => {
  assert.equal((await client.listTools()).tools.length, 10);
  assert.match(client.getInstructions() ?? '', /brain_record_outcome/);
  assert.deepEqual(await call('brain_status', {}), { ok: true, vectorSearchAvailable: true });
  const memory = await call('brain_remember', {
    type: 'rule', scope, content: 'Every HTTP endpoint validates JSON payloads with a Zod schema.',
  });
  memoryId = memory.id;
  const paraphrase = await call('brain_search', { text: 'Reject malformed incoming requests before handling.', scope });
  assert.ok(paraphrase.results.some(result => result.memoryId === memoryId && result.signals.semanticScore > 0));
  const taskId = 'installer-smoke-unrelated';
  const empty = await call('brain_context', { task: 'Where can I see Jupiter through a backyard telescope?', scope, maxTokens: 200, taskId });
  assert.deepEqual(empty.items, []);
  assert.ok(empty.contextId);
  await call('brain_record_outcome', { taskId, contextId: empty.contextId, outcome: 'success' });
});
await useInstalledClient(async (_client, call) => {
  assert.equal((await call('brain_recall', { id: memoryId, scope })).id, memoryId);
});
console.log('Installed MCP passed discovery, semantic search, unrelated abstention, and persistence after restart.');
