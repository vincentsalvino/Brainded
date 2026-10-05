import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Brain Corpus Hygiene V1: the live corpus (docs/agent-integration/BRAIN_CORPUS_HYGIENE.md)
// turned out to be entirely pilot/evaluation provenance -- but forensics traced that to
// manual/interactive tool calls during Phase 2C, not to this package's own test code, which
// already resolves the real data/brain.db only via an explicit path + copyFileSync
// (historical-replay-real-corpus.test.ts) or an explicit snapshot/restore path
// (pilot-harness.ts) -- never a literal default. This test pins that: it fails the build the
// moment a future file under src/ hardcodes the live path as a fallback instead of taking it
// as an explicit, caller-supplied argument.

// dist-test/db-isolation-boundary.test.js -> dist-test -> package root -> src
// (flat layout, same reasoning as packages/mcp/src/boundaries.test.ts: dist-test and src are
// siblings, not nested, so this must step INTO src rather than assume dist-test's parent is it).
const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sourceFiles(dir: string): string[] {
  const results = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name))
    .map((e) => join(dir, e.name));
  assert.ok(results.length > 0, `no .ts source files found under ${dir} -- wrong directory?`);
  return results;
}

test("boundary: no non-test source file defaults/falls back to the live data/brain.db path", () => {
  // Matches a literal live-path string used as a fallback (`?? "...data/brain.db"`,
  // `|| "...data/brain.db"`, or a bare default-parameter literal) -- not an explicit
  // argument a caller passes in, which every current, correctly-isolated usage already is.
  const liveDbFallback = /(\?\?|\|\|)\s*["'`][^"'`]*data\/brain\.db["'`]|=\s*["'`][^"'`]*data\/brain\.db["'`]\s*[,)]/;
  for (const file of sourceFiles(srcDir)) {
    const source = readFileSync(file, "utf-8");
    assert.ok(
      !liveDbFallback.test(source),
      `${file} appears to default to the live data/brain.db path -- pilot/evaluation code must always take an explicit, isolated DB path from its caller`,
    );
  }
});
