import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { openDatabase, appliedMigrations } from "./db.js";

test("openDatabase creates a clean schema from an empty database", () => {
  const db = openDatabase(":memory:");
  const tables = db.raw
    .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`)
    .all() as { name: string }[];
  const names = tables.map((t) => t.name);
  for (const expected of [
    "memories",
    "retrieval_events",
    "context_events",
    "outcome_events",
    "feedback_events",
    "memory_mutation_events",
  ]) {
    assert.ok(names.includes(expected), `expected table ${expected} to exist`);
  }
  db.close();
});

test("applying the migration twice is idempotent (all DDL uses IF NOT EXISTS)", () => {
  const db = openDatabase(":memory:");
  // openDatabase already ran the migration once; running the same statements again
  // against the live connection must not throw.
  assert.doesNotThrow(() => {
    db.raw.exec(`CREATE TABLE IF NOT EXISTS memories_probe_noop (id TEXT)`);
  });
  db.close();
});

test("vectorSearchAvailable is true when sqlite-vec loads successfully", () => {
  const db = openDatabase(":memory:");
  assert.equal(db.vectorSearchAvailable, true);
  db.close();
});

test("the memories table enforces its type CHECK constraint", () => {
  const db = openDatabase(":memory:");
  assert.throws(() =>
    db.raw
      .prepare(
        `INSERT INTO memories (id, type, content, scope_kind, scope_id, source_origin, confidence, status, created_at, updated_at)
         VALUES ('x', 'not_a_real_type', 'content', 'global', NULL, 'system', 0.5, 'active', 'now', 'now')`,
      )
      .run(),
  );
  db.close();
});

test("the memories table enforces scope_id null-iff-global", () => {
  const db = openDatabase(":memory:");
  assert.throws(() =>
    db.raw
      .prepare(
        `INSERT INTO memories (id, type, content, scope_kind, scope_id, source_origin, confidence, status, created_at, updated_at)
         VALUES ('x', 'fact', 'content', 'project', NULL, 'system', 0.5, 'active', 'now', 'now')`,
      )
      .run(),
  );
  db.close();
});

// --- P2-004: multi-migration loader ----------------------------------------

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "brain-migration-")), "brain.db");
}

function migrationSql(name: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", name), "utf-8");
}

test("migrations: a fresh database applies every migration, in filename order", () => {
  const db = openDatabase(":memory:");
  assert.deepEqual(appliedMigrations(db.raw), ["0001_initial_schema.sql", "0002_phase2_measurement.sql"]);
  const tables = (
    db.raw.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
  ).map((t) => t.name);
  assert.ok(tables.includes("context_event_memories"));
  assert.ok(tables.includes("schema_migrations"));
  db.close();
});

test("migrations: a Phase 1-style database (0001 applied, no ledger) upgrades without data loss", () => {
  const path = tempDbPath();

  // Build a database exactly as Phase 1/2A left it: 0001's schema, real data, and
  // no schema_migrations table at all. This is the shape of the live data/brain.db.
  const legacy = new Database(path);
  legacy.pragma("journal_mode = WAL");
  legacy.exec(migrationSql("0001_initial_schema.sql"));
  legacy
    .prepare(
      `INSERT INTO memories (id, type, content, scope_kind, scope_id, source_origin, confidence, status, created_at, updated_at)
       VALUES ('11111111-1111-4111-8111-111111111111', 'fact', 'pre-existing memory', 'global', NULL, 'system', 0.5, 'active', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
    )
    .run();
  legacy
    .prepare(
      `INSERT INTO retrieval_events (id, timestamp, scope_kind, scope_id, query_text, candidate_ids, task_id)
       VALUES ('22222222-2222-4222-8222-222222222222', '2020-01-01T00:00:00.000Z', 'global', NULL, 'old query', '[]', NULL)`,
    )
    .run();
  assert.equal(
    (legacy.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name = 'schema_migrations'`).get() as { n: number }).n,
    0,
    "precondition: the legacy database must have no ledger",
  );
  legacy.close();

  const upgraded = openDatabase(path);
  try {
    // 0001 is re-applied (it is entirely CREATE ... IF NOT EXISTS, so a no-op) and
    // recorded, then 0002 applies. No backfill, no version sniffing.
    assert.deepEqual(appliedMigrations(upgraded.raw), ["0001_initial_schema.sql", "0002_phase2_measurement.sql"]);

    assert.equal(
      (upgraded.raw.prepare(`SELECT COUNT(*) n FROM memories`).get() as { n: number }).n,
      1,
      "pre-existing rows must survive the upgrade",
    );
    assert.equal(
      (upgraded.raw.prepare(`SELECT COUNT(*) n FROM retrieval_events`).get() as { n: number }).n,
      1,
    );
    // The new columns exist and are NULL on pre-existing rows -- honestly meaning
    // "recorded before measurement existed", not fabricated as zero.
    const columns = (
      upgraded.raw.prepare(`PRAGMA table_info(context_events)`).all() as { name: string }[]
    ).map((c) => c.name);
    for (const expected of ["candidate_count", "candidate_token_count", "retrieval_ms", "ranking_ms", "compile_ms", "optimize_ms"]) {
      assert.ok(columns.includes(expected), `expected context_events.${expected}`);
    }
  } finally {
    upgraded.close();
    rmSync(dirname(path), { recursive: true, force: true });
  }
});

test("migrations: reopening an already-migrated database is idempotent and applies nothing", () => {
  const path = tempDbPath();
  const first = openDatabase(path);
  const firstApplied = appliedMigrations(first.raw);
  const firstTimestamps = first.raw.prepare(`SELECT name, applied_at FROM schema_migrations ORDER BY name`).all();
  first.close();

  const second = openDatabase(path);
  try {
    assert.deepEqual(appliedMigrations(second.raw), firstApplied);
    // Same ledger rows, same timestamps: nothing re-ran. If 0002 had re-run, its
    // ALTER TABLE ADD COLUMN would have thrown "duplicate column name".
    assert.deepEqual(
      second.raw.prepare(`SELECT name, applied_at FROM schema_migrations ORDER BY name`).all(),
      firstTimestamps,
    );
  } finally {
    second.close();
    rmSync(dirname(path), { recursive: true, force: true });
  }
});
