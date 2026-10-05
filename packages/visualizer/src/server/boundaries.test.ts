import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This package's thin-adapter / composition-root boundary, mechanically enforced
// the same way packages/mcp/src/boundaries.test.ts enforces its own -- these tests
// read the actual source files and fail the build the moment a file reaches past
// its layer. The single most important test here is "nothing under src/ui imports
// storage": the AEOS predecessor visualizer's failure was exactly a browser bundle
// with a direct database credential baked in (see docs/architecture/VISUALIZER_ARCHITECTURE.md).

// dist-test/server/boundaries.test.js -> dist-test/server -> dist-test -> package root
// (two levels up, not one: this package's rootDir is "src", so "server/boundaries.test.ts"'s
// relative path is preserved under dist-test, unlike mcp's flat src/*.test.ts layout).
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverDir = join(pkgRoot, "src", "server");
const uiDir = join(pkgRoot, "src", "ui");

function walk(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
    results.push(full);
  }
  return results;
}

/**
 * Recursive, unlike mcp/src/boundaries.test.ts's flat version -- this package has
 * subfolders (routes/, components/, pages/, styles/). Some subfolders (styles/)
 * legitimately contain zero .ts/.tsx files, so the "did I resolve the wrong
 * directory" sanity check applies only to the top-level total, not to every
 * directory visited during the walk.
 */
function sourceFiles(dir: string): string[] {
  const results = walk(dir);
  assert.ok(results.length > 0, `no .ts/.tsx source files found anywhere under ${dir} -- wrong directory?`);
  return results;
}

// Matches every real ES import/export form: `from "x"`, bare `import "x"`
// (side-effect only), and dynamic `import("x")`.
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
}

test("boundary: only bootstrap.ts imports @brain/storage under src/server", () => {
  for (const file of sourceFiles(serverDir)) {
    const importsStorage = importSpecifiers(readFileSync(file, "utf-8")).some(
      (s) => s === "@brain/storage" || s.startsWith("@brain/storage/"),
    );
    if (basename(file) === "bootstrap.ts") {
      assert.ok(importsStorage, "bootstrap.ts is expected to be the composition root -- update this test if that changes");
    } else {
      assert.ok(!importsStorage, `${file} must not import @brain/storage -- only bootstrap.ts (the composition root) may`);
    }
  }
});

test("boundary: nothing under src/ui imports @brain/storage, better-sqlite3, or sqlite-vec", () => {
  const forbidden = ["@brain/storage", "better-sqlite3", "sqlite-vec"];
  for (const file of sourceFiles(uiDir)) {
    for (const spec of importSpecifiers(readFileSync(file, "utf-8"))) {
      assert.ok(
        !forbidden.some((f) => spec === f || spec.startsWith(f + "/")),
        `${file} imports ${spec} -- the browser must never have a path to the database, structurally, not just by convention`,
      );
    }
  }
});

test("boundary: no file under src/ (server or ui) contains raw SQL / .prepare( / better-sqlite3 patterns -- that logic lives exclusively in @brain/storage", () => {
  const forbiddenPatterns: RegExp[] = [/\.prepare\s*\(/, /\bbetter-sqlite3\b/, /\bCREATE\s+TABLE\b/i, /\bSELECT\b.*\bFROM\b/i];
  for (const file of [...sourceFiles(serverDir), ...sourceFiles(uiDir)]) {
    const source = readFileSync(file, "utf-8");
    for (const pattern of forbiddenPatterns) {
      assert.ok(!pattern.test(source), `${file} matches ${pattern} -- SQL belongs in @brain/storage only`);
    }
  }
});

test("boundary: every route handler calls exactly one queryService method", () => {
  const routesDir = join(serverDir, "routes");
  let handlerCount = 0;
  let callCount = 0;
  for (const file of sourceFiles(routesDir)) {
    const source = readFileSync(file, "utf-8");
    handlerCount += [...source.matchAll(/export\s+async\s+function\s+handle\w+/g)].length;
    callCount += [...source.matchAll(/await\s+queryService\.\w+\(/g)].length;
  }
  assert.equal(handlerCount, 5, "expected exactly 5 route handlers for V0.1 (overview, list contexts, context detail, memory graph, memory detail)");
  assert.equal(
    callCount,
    handlerCount,
    "each handler must call exactly one queryService method -- a mismatch means logic is leaking into, or missing from, the route layer",
  );
});
