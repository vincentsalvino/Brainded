import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This task's Step 14: the thin-adapter / composition-root boundary must be
// mechanically enforced, not just documented in a comment. These tests read the
// actual source files -- they fail the build the moment a handler reaches past
// Gateway, exactly the way P1-004..P1-014's own tests fail the build the moment
// a layer reaches past its contract.

// import.meta.url here is dist-test/boundaries.test.js (the compile-then-test
// pattern -- see tsconfig.test.json), not src/ -- go up to the package root
// first, then into src, so this reads the actual .ts sources under test rather
// than silently scanning an unrelated (or nonexistent) directory.
const mcpPackageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcpSrcDir = join(mcpPackageRoot, "src");
const gatewaySrcDir = join(mcpPackageRoot, "..", "gateway", "src");

function sourceFiles(dir: string): string[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(dir, f));
  // An empty result means this resolved to the wrong directory (e.g. dist-test
  // instead of src), not "nothing to check" -- every package here always has
  // source files. Fail loudly instead of letting every test below pass vacuously.
  assert.ok(files.length > 0, `no .ts source files found under ${dir} -- wrong directory?`);
  return files;
}

// Matches the specifier in every real ES import/export form: `from "x"`
// (static import, re-export), bare `import "x"` (side-effect only), and
// dynamic `import("x")` -- a first version of this only matched `from "x"`
// and silently missed side-effect and dynamic imports (caught by planting one
// and watching the test not fail; see this task's Step 14 / P1-017's
// plant-a-violation technique, applied here to this test itself).
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
}

test("boundary: only bootstrap.ts imports @brain/storage inside packages/mcp/src", () => {
  for (const file of sourceFiles(mcpSrcDir)) {
    const importsStorage = importSpecifiers(readFileSync(file, "utf-8")).some(
      (s) => s === "@brain/storage" || s.startsWith("@brain/storage/"),
    );
    if (file.endsWith("bootstrap.ts")) {
      assert.ok(importsStorage, "bootstrap.ts is expected to be the composition root -- update this test if that changes");
    } else {
      assert.ok(!importsStorage, `${file} must not import @brain/storage -- only bootstrap.ts (the composition root) may`);
    }
  }
});

test("boundary: only bootstrap.ts imports core service packages directly -- everything else goes through @brain/gateway", () => {
  const forbidden = [
    "@brain/memory",
    "@brain/retrieval",
    "@brain/ranking",
    "@brain/context",
    "@brain/token",
    "@brain/learning",
    "@brain/knowledge",
    "@brain/compression",
  ];
  for (const file of sourceFiles(mcpSrcDir)) {
    if (file.endsWith("bootstrap.ts")) continue;
    for (const spec of importSpecifiers(readFileSync(file, "utf-8"))) {
      assert.ok(!forbidden.includes(spec), `${file} imports ${spec} directly -- MCP adapter files must go through @brain/gateway only`);
    }
  }
});

test("boundary: server.ts contains no ranking/token/retrieval/compression/storage logic", () => {
  const source = readFileSync(join(mcpSrcDir, "server.ts"), "utf-8");
  const forbiddenPatterns: RegExp[] = [
    /\.prepare\s*\(/,
    /\bsqlite\b/i,
    /\brank\s*\(/,
    /\bcompress\s*\(/,
    /\boptimizeContext\s*\(/,
    /\bestimateTokens\s*\(/,
    /\bgetCandidates\s*\(/,
  ];
  for (const pattern of forbiddenPatterns) {
    assert.ok(!pattern.test(source), `server.ts matches ${pattern} -- this logic belongs in Gateway/Core, not the adapter`);
  }
});

test("boundary: every registered tool handler calls exactly one gateway method", () => {
  const source = readFileSync(join(mcpSrcDir, "server.ts"), "utf-8");
  const toolCount = [...source.matchAll(/server\.registerTool\(/g)].length;
  const gatewayCallCount = [...source.matchAll(/await gateway\.\w+\(/g)].length;
  assert.equal(toolCount, 10, "expected all 10 brain_* tools from this task's MCP tool surface");
  assert.equal(gatewayCallCount, toolCount, "each handler must call exactly one gateway method -- a mismatch means logic is leaking into, or missing from, the adapter");
});

test("boundary: Gateway stays transport-independent -- nothing in @brain/gateway imports the MCP SDK", () => {
  for (const file of sourceFiles(gatewaySrcDir)) {
    const importsMcp = importSpecifiers(readFileSync(file, "utf-8")).some((s) => s.startsWith("@modelcontextprotocol/"));
    assert.ok(!importsMcp, `${file} imports the MCP SDK -- Gateway must stay usable behind any transport, not just MCP`);
  }
});
