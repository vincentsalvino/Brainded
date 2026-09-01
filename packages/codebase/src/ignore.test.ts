import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIgnoreMatcher } from "./ignore.js";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "brain-codebase-ignore-"));
}

test("default patterns exclude .git, node_modules, dist, build, coverage", async () => {
  const root = tempRepo();
  try {
    const isIgnored = await loadIgnoreMatcher(root);
    assert.equal(isIgnored(".git/config"), true);
    assert.equal(isIgnored("node_modules/pkg/index.js"), true);
    assert.equal(isIgnored("dist/index.js"), true);
    assert.equal(isIgnored("build/out.js"), true);
    assert.equal(isIgnored("coverage/lcov.info"), true);
    assert.equal(isIgnored("src/index.ts"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("*.tmp and .tmp/ are ignored by default", async () => {
  const root = tempRepo();
  try {
    const isIgnored = await loadIgnoreMatcher(root);
    assert.equal(isIgnored("scratch.tmp"), true);
    assert.equal(isIgnored(".tmp/file"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a repository .gitignore is respected", async () => {
  const root = tempRepo();
  try {
    writeFileSync(join(root, ".gitignore"), "*.log\nvendor/\n");
    const isIgnored = await loadIgnoreMatcher(root);
    assert.equal(isIgnored("app.log"), true);
    assert.equal(isIgnored("vendor/lib.js"), true);
    assert.equal(isIgnored("src/index.ts"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing .gitignore is not an error", async () => {
  const root = tempRepo();
  try {
    await assert.doesNotReject(() => loadIgnoreMatcher(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extra caller-supplied patterns are unioned with the defaults", async () => {
  const root = tempRepo();
  try {
    const isIgnored = await loadIgnoreMatcher(root, ["*.generated.ts"]);
    assert.equal(isIgnored("schema.generated.ts"), true);
    assert.equal(isIgnored("node_modules/x"), true, "defaults must still apply alongside extras");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gitignore negation is honored", async () => {
  const root = tempRepo();
  try {
    writeFileSync(join(root, ".gitignore"), "*.log\n!keep.log\n");
    const isIgnored = await loadIgnoreMatcher(root);
    assert.equal(isIgnored("app.log"), true);
    assert.equal(isIgnored("keep.log"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
