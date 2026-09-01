import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverFiles } from "./discovery.js";

const noIgnore = () => false;

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "brain-codebase-discovery-"));
}

test("discovers every file in a small fixture repository, with POSIX-style relative paths", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export {}");
    writeFileSync(join(root, "README.md"), "# hi");
    const files = await discoverFiles(root, noIgnore);
    const paths = files.map((f) => f.relativePath).sort();
    assert.deepEqual(paths, ["README.md", "src/index.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports sizeBytes and an absolutePath alongside relativePath", async () => {
  const root = tempRepo();
  try {
    writeFileSync(join(root, "a.txt"), "hello");
    const files = await discoverFiles(root, noIgnore);
    assert.equal(files.length, 1);
    assert.equal(files[0]?.sizeBytes, 5);
    assert.ok(files[0]?.absolutePath.endsWith("a.txt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignored paths are excluded from discovery entirely", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "module.exports = {}");
    writeFileSync(join(root, "src.ts"), "export {}");
    const isIgnored = (p: string) => p.startsWith("node_modules/");
    const files = await discoverFiles(root, isIgnored);
    assert.deepEqual(
      files.map((f) => f.relativePath),
      ["src.ts"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an empty directory produces no discovered files", async () => {
  const root = tempRepo();
  try {
    assert.deepEqual(await discoverFiles(root, noIgnore), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nested directories are walked recursively", async () => {
  const root = tempRepo();
  try {
    mkdirSync(join(root, "a", "b", "c"), { recursive: true });
    writeFileSync(join(root, "a", "b", "c", "deep.ts"), "export {}");
    const files = await discoverFiles(root, noIgnore);
    assert.deepEqual(
      files.map((f) => f.relativePath),
      ["a/b/c/deep.ts"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a symlink escaping the repository root is not discovered", async (t) => {
  const root = tempRepo();
  const outside = tempRepo();
  try {
    writeFileSync(join(outside, "secret.txt"), "outside content");
    try {
      symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
    } catch {
      t.skip("symlink creation not permitted in this environment");
      return;
    }
    writeFileSync(join(root, "inside.txt"), "inside content");
    const files = await discoverFiles(root, noIgnore);
    assert.deepEqual(
      files.map((f) => f.relativePath),
      ["inside.txt"],
      "the escaping symlink must never be returned as a discovered file",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a symlink pointing inside the repository root is discovered normally", async (t) => {
  const root = tempRepo();
  try {
    writeFileSync(join(root, "real.txt"), "real content");
    try {
      symlinkSync(join(root, "real.txt"), join(root, "alias.txt"));
    } catch {
      t.skip("symlink creation not permitted in this environment");
      return;
    }
    const files = await discoverFiles(root, noIgnore);
    const paths = files.map((f) => f.relativePath).sort();
    assert.deepEqual(paths, ["alias.txt", "real.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
