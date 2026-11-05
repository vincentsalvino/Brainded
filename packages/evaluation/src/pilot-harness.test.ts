import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotDatabase, assignArm, pilotTaskId } from "./pilot-harness.js";

test("snapshotDatabase: includes committed WAL writes without changing the source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "phase43-snapshot-"));
  const source = join(dir, "source.db");
  const snapshot = join(dir, "snapshot.db");
  const writer = new Database(source);
  writer.pragma("journal_mode = WAL");
  writer.pragma("wal_autocheckpoint = 0");
  writer.exec("CREATE TABLE evidence (value TEXT); INSERT INTO evidence VALUES ('committed in WAL')");
  const mainBefore = readFileSync(source);
  const walBefore = readFileSync(`${source}-wal`);
  try {
    await snapshotDatabase(source, snapshot);
    const copy = new Database(snapshot, { readonly: true });
    try {
      assert.deepEqual(copy.prepare("SELECT value FROM evidence").all(), [{ value: "committed in WAL" }]);
      assert.equal(copy.pragma("integrity_check", { simple: true }), "ok");
    } finally { copy.close(); }
    assert.deepEqual(readFileSync(source), mainBefore);
    assert.deepEqual(readFileSync(`${source}-wal`), walBefore);
    await assert.rejects(snapshotDatabase(source, source), /new, distinct/);
    await assert.rejects(snapshotDatabase(source, snapshot), /new, distinct/);
  } finally {
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snapshotDatabase: throws loudly rather than silently snapshotting nothing", async () => {
  await assert.rejects(snapshotDatabase("/does/not/exist.db", "/tmp/whatever.db"));
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
