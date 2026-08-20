import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Matches @xenova/transformers' all-MiniLM-L6-v2 output dimensionality -- the same
// local embedding model AEOS validated (AUDIT_AEOS.md 13). See local-embeddings.ts.
export const EMBEDDING_DIMENSIONS = 384;

export interface BrainDatabase {
  raw: Database.Database;
  /** false if the sqlite-vec extension failed to load on this platform -- memory
   *  CRUD and lexical search still work; SqliteRetrievalStore.semanticSearch()
   *  throws a clear error instead, for the caller's degradation logic to catch
   *  (PHASE_1_READINESS.md risk: "sqlite-vec native-extension fragility across
   *  platforms" -- a full parallel in-process-cosine storage path is not built for
   *  this: the existing throw-and-let-the-caller-degrade pattern already covers it
   *  without a second vector storage implementation). */
  vectorSearchAvailable: boolean;
  close(): void;
}

/**
 * Opens (creating if needed) the Brain's single SQLite database: WAL mode, FTS5 +
 * triggers, sqlite-vec loaded, schema applied from the single migration source of
 * truth. `path` may be a real file path or ':memory:' for tests.
 */
export function openDatabase(path: string): BrainDatabase {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  let vectorSearchAvailable = true;
  try {
    sqliteVec.load(db);
  } catch (error) {
    vectorSearchAvailable = false;
    console.error(
      "sqlite-vec failed to load; semantic search is unavailable, memory storage and lexical search are unaffected:",
      error,
    );
  }

  applyMigrations(db);
  if (vectorSearchAvailable) ensureVectorTable(db);

  return {
    raw: db,
    vectorSearchAvailable,
    close: () => db.close(),
  };
}

/**
 * The migration ledger. Bootstrap-only DDL, and the one piece of schema that
 * cannot live in a migration file -- you need the ledger before you can record
 * that a migration ran. Everything else stays in migrations/*.sql, so there is
 * still exactly one source of schema truth for the Brain's own tables.
 */
const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`;

/**
 * Applies every migration in migrations/ that has not been applied yet, in
 * filename order, each inside its own transaction.
 *
 * Filename order is the version order -- files are zero-padded and sequential
 * (0001_, 0002_, ...), so a lexicographic sort is the intended order and a new
 * migration cannot be inserted before an applied one without renaming it.
 *
 * Upgrade path for a database created before this ledger existed (any Phase 1 or
 * Phase 2A file, including a live one): the ledger is empty, so 0001 is applied
 * again. That is safe by construction -- every statement in 0001 is
 * CREATE ... IF NOT EXISTS, so re-running it is a no-op against existing tables --
 * and it is then recorded, after which 0002 applies cleanly. No backfill, no
 * version sniffing, no special case.
 *
 * Later migrations are NOT required to be self-idempotent (0002 uses
 * ALTER TABLE ADD COLUMN, which SQLite offers no IF NOT EXISTS for). The ledger is
 * what guarantees each runs exactly once; the transaction is what guarantees a
 * failure leaves nothing half-applied.
 */
function applyMigrations(db: Database.Database): void {
  db.exec(SCHEMA_MIGRATIONS_DDL);

  const applied = new Set(
    (db.prepare(`SELECT name FROM schema_migrations`).all() as { name: string }[]).map((r) => r.name),
  );

  const migrationsDir = join(__dirname, "..", "migrations");
  const pending = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => !applied.has(file));

  for (const file of pending) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    const record = db.prepare(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`);
    db.transaction(() => {
      db.exec(sql);
      record.run(file, new Date().toISOString());
    })();
  }
}

/** Migrations applied to this database, in application order. Diagnostics only. */
export function appliedMigrations(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT name FROM schema_migrations ORDER BY name`).all() as { name: string }[]
  ).map((r) => r.name);
}

function ensureVectorTable(db: Database.Database): void {
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(` +
      `memory_id TEXT PRIMARY KEY, ` +
      `embedding float[${EMBEDDING_DIMENSIONS}]` +
      `)`,
  );
}
