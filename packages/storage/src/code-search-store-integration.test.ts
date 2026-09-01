import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, type CodeFileRecord, type CodeChunkRecord } from "@brain/contracts";
import { LocalEmbeddingProvider } from "./local-embedding-provider.js";
import { openDatabase } from "./db.js";
import { SqliteCodebaseRepository } from "./codebase-repository.js";
import { SqliteCodeSearchStore } from "./code-search-store.js";

// Integration test, deliberately separate from the main storage suite -- same
// reason local-embedding-provider.test.ts is: exercises the real
// @huggingface/transformers model, not FakeEmbeddingProvider. PHASE_3_SPEC.md
// REAL-MODEL INTEGRATION: queries here deliberately share little/no exact
// vocabulary with the target chunk, so a pass here is evidence semantic retrieval
// works, not just that lexical retrieval happened to also match.

async function seed(
  codebase: SqliteCodebaseRepository,
  repositoryId: string,
  relativePath: string,
  content: string,
): Promise<CodeChunkRecord> {
  const file: CodeFileRecord = {
    id: `file-${relativePath}`,
    repositoryId,
    scope: globalScope(),
    relativePath,
    language: "typescript",
    sizeBytes: content.length,
    contentHash: `hash-${relativePath}`,
    indexedAt: new Date().toISOString(),
  };
  const chunk: CodeChunkRecord = {
    id: `chunk-${relativePath}`,
    fileId: file.id,
    repositoryId,
    scope: globalScope(),
    relativePath,
    chunkIndex: 0,
    startLine: 1,
    endLine: content.split("\n").length,
    content,
    contentHash: file.contentHash,
  };
  await codebase.replaceFile(file, [chunk]);
  return chunk;
}

test(
  "integration: semantic search finds the boundary-enforcement chunk for a paraphrased query with no exact token overlap",
  { timeout: 120_000 },
  async () => {
    const db = openDatabase(":memory:");
    const embeddings = new LocalEmbeddingProvider();
    const codebase = new SqliteCodebaseRepository(db.raw);
    const search = new SqliteCodeSearchStore(db.raw, embeddings, db.vectorSearchAvailable);
    const repository = await codebase.createRepository(globalScope(), "/repo-integration");

    const target = await seed(
      codebase,
      repository.id,
      "src/repositories/user-repository.ts",
      "export class UserRepository { async save(user: User) { return this.db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(user.id, user.email); } } // route handlers must call this repository -- they must never import the database driver directly.",
    );
    await seed(codebase, repository.id, "src/utils/weather.ts", "export function currentForecast() { return { sunny: true, temperatureC: 21 }; }");
    await seed(codebase, repository.id, "src/routes/health.ts", "router.get('/health', (req, res) => { res.send('ok'); });");

    await search.syncEmbeddings(repository.id);

    // Mission spec's own example phrasing (PHASE_3_SPEC.md REAL-MODEL INTEGRATION):
    // shares no literal tokens with "UserRepository"/"db.prepare"/"INSERT INTO".
    const results = await search.semanticSearch({
      text: "where do we prevent database access from handlers?",
      scope: globalScope(),
      limit: 5,
    });

    console.log(
      "\n[real-model semantic] query: \"where do we prevent database access from handlers?\"\n" +
        results.map((r) => `  ${r.relativePath} score=${r.signals.semanticScore?.toFixed(4)}`).join("\n"),
    );

    assert.ok(results.length > 0, "expected at least one semantic result");
    assert.equal(results[0]?.chunkId, target.id, "the repository-boundary chunk must rank first");
    db.close();
  },
);
