import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globalScope, projectScope } from "@brain/contracts";
import { FakeCodebaseRepository, FakeCodeDependencyStore } from "@brain/test-fixtures";
import { CodebaseIndexer } from "./indexer.js";
import { DependencySynchronizer } from "./dependency-synchronizer.js";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "brain-dep-sync-"));
}

async function setup(root: string) {
  const codebase = new FakeCodebaseRepository();
  const store = new FakeCodeDependencyStore();
  const indexer = new CodebaseIndexer(codebase);
  const synchronizer = new DependencySynchronizer(codebase, store);
  const cold = await indexer.indexRepository({ scope: globalScope(), rootPath: root });
  return { codebase, store, indexer, synchronizer, repositoryId: cold.repositoryId };
}

async function reindexAndSync(
  indexer: CodebaseIndexer,
  synchronizer: DependencySynchronizer,
  root: string,
  repositoryId: string,
) {
  await indexer.indexRepository({ scope: globalScope(), rootPath: root });
  return synchronizer.syncDependencies({ scope: globalScope(), rootPath: root, repositoryId });
}

test("initial sync parses every eligible file and classifies internal/external/unresolved correctly", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), `import { b } from "./b";\nimport "zod";\nimport "./missing";\n`);
    writeFileSync(join(root, "src", "b.ts"), `export const b = 1;\n`);
    writeFileSync(join(root, "README.md"), `# not eligible\n`);

    const { synchronizer, repositoryId } = await setup(root);
    const result = await synchronizer.syncDependencies({ scope: globalScope(), rootPath: root, repositoryId });

    assert.equal(result.filesExamined, 2, "only the two .ts files are eligible; README.md is not");
    assert.equal(result.filesParsed, 2);
    assert.equal(result.filesUnchanged, 0);
    assert.equal(result.filesFailed, 0);
    assert.equal(result.internalEdges, 1, "a.ts -> b.ts");
    assert.equal(result.externalEdges, 1, "a.ts -> zod");
    assert.equal(result.unresolvedEdges, 1, "a.ts -> ./missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unchanged sync reparses zero files", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), `import { b } from "./b";\n`);
    writeFileSync(join(root, "src", "b.ts"), `export const b = 1;\n`);

    const { indexer, synchronizer, repositoryId } = await setup(root);
    await synchronizer.syncDependencies({ scope: globalScope(), rootPath: root, repositoryId });
    const second = await reindexAndSync(indexer, synchronizer, root, repositoryId);

    assert.equal(second.filesParsed, 0);
    assert.equal(second.filesUnchanged, 2);
    assert.equal(second.edgesCreated, 0);
    assert.equal(second.resolutionsUpdated, 0, "nothing in the file inventory changed either");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("changing one source file re-parses only that file", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), `import { b } from "./b";\n`);
    writeFileSync(join(root, "src", "b.ts"), `export const b = 1;\n`);

    const { indexer, synchronizer, repositoryId } = await setup(root);
    await synchronizer.syncDependencies({ scope: globalScope(), rootPath: root, repositoryId });

    writeFileSync(join(root, "src", "a.ts"), `import { b } from "./b";\nimport "zod";\n`);
    const second = await reindexAndSync(indexer, synchronizer, root, repositoryId);

    assert.equal(second.filesParsed, 1, "only a.ts changed");
    assert.equal(second.filesUnchanged, 1, "b.ts is untouched");
    assert.equal(second.internalEdges, 1);
    assert.equal(second.externalEdges, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleting a source file removes its outgoing edges", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), `import { b } from "./b";\n`);
    writeFileSync(join(root, "src", "b.ts"), `export const b = 1;\n`);

    const { store, indexer, synchronizer, repositoryId } = await setup(root);
    await synchronizer.syncDependencies({ scope: globalScope(), rootPath: root, repositoryId });

    unlinkSync(join(root, "src", "a.ts"));
    await reindexAndSync(indexer, synchronizer, root, repositoryId);

    const remaining = await store.listEdges(repositoryId);
    assert.deepEqual(remaining, [], "a.ts's own outgoing edge must be gone");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleting a target file invalidates the source's resolution to unresolved, without reparsing the source", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), `import { b } from "./b";\n`);
    writeFileSync(join(root, "src", "b.ts"), `export const b = 1;\n`);

    const { store, indexer, synchronizer, repositoryId } = await setup(root);
    await synchronizer.syncDependencies({ scope: globalScope(), rootPath: root, repositoryId });
    const before = (await store.listEdges(repositoryId))[0];
    assert.equal(before?.resolution, "internal");

    unlinkSync(join(root, "src", "b.ts"));
    const second = await reindexAndSync(indexer, synchronizer, root, repositoryId);

    assert.equal(second.filesParsed, 0, "a.ts's own content never changed -- only re-resolution ran");
    assert.equal(second.resolutionsUpdated, 1);
    const after = (await store.listEdges(repositoryId))[0];
    assert.equal(after?.resolution, "unresolved");
    assert.equal(after?.targetFileId, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("adding a previously-missing target resolves the existing edge without reparsing the source", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), `import { b } from "./b";\n`);

    const { store, indexer, synchronizer, repositoryId } = await setup(root);
    const first = await synchronizer.syncDependencies({ scope: globalScope(), rootPath: root, repositoryId });
    assert.equal(first.unresolvedEdges, 1);

    writeFileSync(join(root, "src", "b.ts"), `export const b = 1;\n`);
    const second = await reindexAndSync(indexer, synchronizer, root, repositoryId);

    assert.equal(second.filesParsed, 1, "only the newly-added b.ts itself needed parsing (it has no imports)");
    assert.equal(second.resolutionsUpdated, 1, "a.ts's existing edge flips to internal via re-resolution, not reparsing");
    const edges = await store.listEdges(repositoryId);
    const aEdge = edges.find((e) => e.specifier === "./b");
    assert.equal(aEdge?.resolution, "internal");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unsupported file language is skipped, not counted, and never aborts the run", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), `import { b } from "./b";\n`);
    writeFileSync(join(root, "src", "b.ts"), `export const b = 1;\n`);
    writeFileSync(join(root, "src", "script.py"), `import os\n`);

    const { synchronizer, repositoryId } = await setup(root);
    const result = await synchronizer.syncDependencies({ scope: globalScope(), rootPath: root, repositoryId });

    assert.equal(result.filesExamined, 2, "script.py is never counted as eligible");
    assert.equal(result.filesFailed, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one file's read failure is isolated -- other files still sync, failure is reported", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), `import { b } from "./b";\n`);
    writeFileSync(join(root, "src", "b.ts"), `export const b = 1;\n`);

    const { codebase, synchronizer, repositoryId } = await setup(root);
    // Simulate a file that CodebaseIndexer knew about but is now unreadable (e.g. a
    // race with deletion) by deleting it from disk WITHOUT re-running the indexer,
    // so FakeCodebaseRepository still reports it as present.
    unlinkSync(join(root, "src", "b.ts"));

    const result = await synchronizer.syncDependencies({ scope: globalScope(), rootPath: root, repositoryId });

    assert.equal(result.filesFailed, 1);
    assert.equal(result.failures[0]?.relativePath, "src/b.ts");
    assert.equal(result.filesParsed, 1, "a.ts still parses successfully despite b.ts's failure");
    void codebase;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scope isolation: identical relative paths and content in two repositories never cross-resolve", async () => {
  const rootA = tempRepo();
  const rootB = tempRepo();
  try {
    for (const root of [rootA, rootB]) {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "a.ts"), `import { b } from "./b";\n`);
      writeFileSync(join(root, "src", "b.ts"), `export const b = 1;\n`);
    }

    const codebase = new FakeCodebaseRepository();
    const store = new FakeCodeDependencyStore();
    const indexer = new CodebaseIndexer(codebase);
    const synchronizer = new DependencySynchronizer(codebase, store);

    const repoA = await indexer.indexRepository({ scope: projectScope("project-a"), rootPath: rootA });
    const repoB = await indexer.indexRepository({ scope: projectScope("project-b"), rootPath: rootB });
    await synchronizer.syncDependencies({ scope: projectScope("project-a"), rootPath: rootA, repositoryId: repoA.repositoryId });
    await synchronizer.syncDependencies({ scope: projectScope("project-b"), rootPath: rootB, repositoryId: repoB.repositoryId });

    const edgesA = await store.listEdges(repoA.repositoryId);
    const edgesB = await store.listEdges(repoB.repositoryId);
    assert.equal(edgesA.length, 1);
    assert.equal(edgesB.length, 1);
    assert.notEqual(edgesA[0]?.id, edgesB[0]?.id, "distinct edge ids across repositories despite identical paths/content");
    assert.notEqual(edgesA[0]?.targetFileId, edgesB[0]?.targetFileId);
    assert.equal(edgesA[0]?.resolution, "internal");
    assert.equal(edgesB[0]?.resolution, "internal");
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});
