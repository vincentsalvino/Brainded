import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  globalScope,
  projectScope,
  type CodebaseRecord,
  type CodebaseRepository,
  type CodeChunkRecord,
  type CodeFileRecord,
  type ScopeRef,
} from "@brain/contracts";
import { FakeCodebaseRepository } from "@brain/test-fixtures";
import { CodebaseIndexer } from "./indexer.js";
import { deriveFileId } from "./hash.js";

/** Delegates every call to `inner` except replaceFile, which fails for one chosen
 *  relativePath while `failing` is true -- used to exercise per-file failure
 *  isolation without any prototype-chain trickery. */
class FlakyCodebaseRepository implements CodebaseRepository {
  failing = true;
  constructor(
    private readonly inner: CodebaseRepository,
    private readonly failOnRelativePath: string,
  ) {}
  findRepository(scope: ScopeRef, rootPath: string): Promise<CodebaseRecord | null> {
    return this.inner.findRepository(scope, rootPath);
  }
  createRepository(scope: ScopeRef, rootPath: string): Promise<CodebaseRecord> {
    return this.inner.createRepository(scope, rootPath);
  }
  markIndexed(repositoryId: string): Promise<void> {
    return this.inner.markIndexed(repositoryId);
  }
  listFiles(repositoryId: string): Promise<CodeFileRecord[]> {
    return this.inner.listFiles(repositoryId);
  }
  replaceFile(file: CodeFileRecord, chunks: CodeChunkRecord[]) {
    if (this.failing && file.relativePath === this.failOnRelativePath) {
      throw new Error("simulated persistence failure");
    }
    return this.inner.replaceFile(file, chunks);
  }
  removeFile(fileId: string) {
    return this.inner.removeFile(fileId);
  }
}

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "brain-codebase-indexer-"));
}

function writeFixture(root: string) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(root, "README.md"), "# hello\n");
}

test("first index: discovers, persists files and chunks", async () => {
  const root = tempRepo();
  try {
    writeFixture(root);
    const repo = new FakeCodebaseRepository();
    const indexer = new CodebaseIndexer(repo);
    const result = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });

    assert.equal(result.filesDiscovered, 2);
    assert.equal(result.filesIndexed, 2);
    assert.equal(result.filesUnchanged, 0);
    assert.equal(result.filesUpdated, 0);
    assert.equal(result.filesRemoved, 0);
    assert.equal(result.filesSkipped, 0);
    assert.equal(result.chunksCreated, 2);

    const files = await repo.listFiles(result.repositoryId);
    assert.deepEqual(files.map((f) => f.relativePath).sort(), ["README.md", "src/index.ts"]);
    assert.equal(files.find((f) => f.relativePath === "src/index.ts")?.language, "typescript");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("second index, nothing changed: zero duplicates, everything reported unchanged", async () => {
  const root = tempRepo();
  try {
    writeFixture(root);
    const repo = new FakeCodebaseRepository();
    const indexer = new CodebaseIndexer(repo);
    await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });
    const second = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });

    assert.equal(second.filesUnchanged, 2);
    assert.equal(second.filesIndexed, 0);
    assert.equal(second.filesUpdated, 0);
    assert.equal(second.chunksCreated, 0);
    const files = await repo.listFiles(second.repositoryId);
    assert.equal(files.length, 2, "no duplicate file rows across repeated indexing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one file changed: only that file is reprocessed, unrelated files untouched", async () => {
  const root = tempRepo();
  try {
    writeFixture(root);
    const repo = new FakeCodebaseRepository();
    const indexer = new CodebaseIndexer(repo);
    const first = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });
    const readmeBefore = (await repo.listFiles(first.repositoryId)).find((f) => f.relativePath === "README.md");

    writeFileSync(join(root, "src", "index.ts"), "export const x = 2; // changed\n");
    const second = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });

    assert.equal(second.filesUpdated, 1);
    assert.equal(second.filesUnchanged, 1);
    assert.equal(second.filesIndexed, 0);

    const readmeAfter = (await repo.listFiles(second.repositoryId)).find((f) => f.relativePath === "README.md");
    assert.equal(readmeAfter?.contentHash, readmeBefore?.contentHash, "the untouched file's hash must not change");
    assert.equal(readmeAfter?.indexedAt, readmeBefore?.indexedAt, "the untouched file must not be re-written at all");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one file deleted: it stops being queryable", async () => {
  const root = tempRepo();
  try {
    writeFixture(root);
    const repo = new FakeCodebaseRepository();
    const indexer = new CodebaseIndexer(repo);
    const first = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });

    rmSync(join(root, "README.md"));
    const second = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });

    assert.equal(second.filesRemoved, 1);
    const files = await repo.listFiles(first.repositoryId);
    assert.deepEqual(
      files.map((f) => f.relativePath),
      ["src/index.ts"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one file added: only the new file is indexed", async () => {
  const root = tempRepo();
  try {
    writeFixture(root);
    const repo = new FakeCodebaseRepository();
    const indexer = new CodebaseIndexer(repo);
    await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });

    writeFileSync(join(root, "src", "new.ts"), "export const y = 2;\n");
    const second = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });

    assert.equal(second.filesIndexed, 1);
    assert.equal(second.filesUnchanged, 2);
    const files = await repo.listFiles(second.repositoryId);
    assert.deepEqual(
      files.map((f) => f.relativePath).sort(),
      ["README.md", "src/index.ts", "src/new.ts"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("binary files are skipped, not chunked as text", async () => {
  const root = tempRepo();
  try {
    writeFixture(root);
    writeFileSync(join(root, "image.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const repo = new FakeCodebaseRepository();
    const indexer = new CodebaseIndexer(repo);
    const result = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });

    assert.equal(result.filesSkipped, 1);
    assert.deepEqual(result.skipped, [{ relativePath: "image.bin", reason: "binary" }]);
    const files = await repo.listFiles(result.repositoryId);
    assert.equal(files.some((f) => f.relativePath === "image.bin"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignored paths never reach persistence", async () => {
  const root = tempRepo();
  try {
    writeFixture(root);
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "module.exports = {}");
    const repo = new FakeCodebaseRepository();
    const indexer = new CodebaseIndexer(repo);
    const result = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });

    assert.equal(result.filesDiscovered, 2, "node_modules must be filtered before it is even counted as discovered");
    const files = await repo.listFiles(result.repositoryId);
    assert.equal(files.some((f) => f.relativePath.startsWith("node_modules")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two projects with identical relative paths remain isolated", async () => {
  const rootA = tempRepo();
  const rootB = tempRepo();
  try {
    writeFileSync(join(rootA, "src.ts"), "export const a = 1;\n");
    writeFileSync(join(rootB, "src.ts"), "export const b = 2;\n");
    const repo = new FakeCodebaseRepository();
    const indexer = new CodebaseIndexer(repo);
    const resultA = await indexer.indexRepository({ scope: projectScope("proj-a"), rootPath: rootA });
    const resultB = await indexer.indexRepository({ scope: projectScope("proj-b"), rootPath: rootB });

    assert.notEqual(resultA.repositoryId, resultB.repositoryId);
    const filesA = await repo.listFiles(resultA.repositoryId);
    const filesB = await repo.listFiles(resultB.repositoryId);
    assert.equal(filesA.length, 1);
    assert.equal(filesB.length, 1);
    assert.notEqual(filesA[0]?.id, filesB[0]?.id, "identical relativePath in two repositories must not collide");
    assert.notEqual(filesA[0]?.contentHash, filesB[0]?.contentHash);
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

test("file identity depends only on (repositoryId, relativePath) -- never on rootPath or absolutePath", async () => {
  const rootA = tempRepo();
  const rootB = tempRepo();
  try {
    writeFileSync(join(rootA, "same.ts"), "export const x = 1;\n");
    writeFileSync(join(rootB, "same.ts"), "export const x = 1;\n");
    const repo = new FakeCodebaseRepository();
    const indexer = new CodebaseIndexer(repo);
    const resultA = await indexer.indexRepository({ scope: globalScope(), rootPath: rootA });
    const resultB = await indexer.indexRepository({ scope: globalScope(), rootPath: rootB });

    const fileA = (await repo.listFiles(resultA.repositoryId))[0] as CodeFileRecord;
    const fileB = (await repo.listFiles(resultB.repositoryId))[0] as CodeFileRecord;

    // The stored id must equal the pure path-derived hash for each repository's own
    // id -- proving the indexer never folded rootPath/absolutePath into identity.
    assert.equal(fileA.id, deriveFileId(resultA.repositoryId, "same.ts"));
    assert.equal(fileB.id, deriveFileId(resultB.repositoryId, "same.ts"));
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

test("a per-file failure is isolated: the run completes, the file is skipped and reported, and is retried next run", async () => {
  const root = tempRepo();
  try {
    writeFixture(root);
    const inner = new FakeCodebaseRepository();
    const flaky = new FlakyCodebaseRepository(inner, "src/index.ts");

    const indexer = new CodebaseIndexer(flaky);
    const first = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });

    assert.equal(first.filesSkipped, 1);
    assert.equal(first.filesIndexed, 1, "the non-failing file (README.md) must still be indexed");
    assert.equal(first.skipped[0]?.relativePath, "src/index.ts");
    assert.equal((await inner.listFiles(first.repositoryId)).some((f) => f.relativePath === "src/index.ts"), false);

    flaky.failing = false;
    const second = await indexer.indexRepository({ scope: projectScope("p1"), rootPath: root });
    assert.equal(second.filesIndexed, 1, "the previously-failed file must be retried, not permanently skipped");
    assert.equal(
      (await inner.listFiles(second.repositoryId)).some((f) => f.relativePath === "src/index.ts"),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("indexing requires zero network calls: no networking module is imported anywhere in this package's src", () => {
  // import.meta.url here is dist-test/indexer.test.js at runtime -- src/ is a
  // sibling directory, checked directly (not dist-test) because compiled output
  // uses require()-free ESM import syntax that could hide a transformed call the
  // .ts source-level grep is meant to catch in the first place.
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const forbidden = [
    /from\s+["']node:(http|https|net|dgram|tls)["']/,
    /require\(\s*["'](http|https|net|dgram|tls)["']\s*\)/,
    /\bfetch\s*\(/,
  ];
  const offenders: string[] = [];
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const content = readFileSync(join(srcDir, name), "utf-8");
    for (const pattern of forbidden) {
      if (pattern.test(content)) offenders.push(`${name}: ${pattern}`);
    }
  }
  assert.deepEqual(offenders, []);
});
