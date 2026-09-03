import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotDatabase, assignArm, pilotTaskId } from "./pilot-harness.js";

test("snapshotDatabase: copies the source file byte-for-byte, source untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "phase43-snapshot-"));
  const source = join(dir, "source.db");
  const snapshot = join(dir, "snapshot.db");
  writeFileSync(source, "pretend-sqlite-bytes");

  snapshotDatabase(source, snapshot);

  assert.equal(readFileSync(snapshot, "utf-8"), "pretend-sqlite-bytes");
  assert.equal(readFileSync(source, "utf-8"), "pretend-sqlite-bytes", "the source must be untouched by taking a snapshot");
  rmSync(dir, { recursive: true, force: true });
});

test("snapshotDatabase: throws loudly rather than silently snapshotting nothing", () => {
  assert.throws(() => snapshotDatabase("/does/not/exist.db", "/tmp/whatever.db"));
});

test("assignArm: odd task numbers are OFF, even are ON -- deterministic, not based on expected quality", () => {
  assert.equal(assignArm(1), "learning-off");
  assert.equal(assignArm(2), "learning-on");
  assert.equal(assignArm(19), "learning-off");
  assert.equal(assignArm(20), "learning-on");
});

test("assignArm: rejects a non-positive-integer task number rather than silently misassigning", () => {
  assert.throws(() => assignArm(0));
  assert.throws(() => assignArm(-1));
  assert.throws(() => assignArm(1.5));
});

test("pilotTaskId: produces a stable, cohort-tagged, zero-padded id", () => {
  assert.equal(pilotTaskId(3, "fix-typo"), "phase4.3-organic-03-fix-typo");
  assert.equal(pilotTaskId(20, "refactor-x"), "phase4.3-organic-20-refactor-x");
});
