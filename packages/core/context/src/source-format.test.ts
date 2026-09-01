import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCodeContent, formatDependencyContent } from "./source-format.js";

test("formatCodeContent: header line is path:start-end, followed by the raw content unmodified", () => {
  const text = formatCodeContent({ relativePath: "packages/gateway/src/gateway.ts", startLine: 120, endLine: 174, content: "export class Gateway {}" });
  assert.equal(text, "[CODE] packages/gateway/src/gateway.ts:120-174\nexport class Gateway {}");
});

test("formatDependencyContent: 'dependency' relation reads as direct imports, epistemically exact", () => {
  const text = formatDependencyContent("packages/gateway/src/gateway.ts", "dependency", [
    { fileId: "f1", relativePath: "packages/core/retrieval/src/service.ts", depth: null },
    { fileId: "f2", relativePath: "packages/core/ranking/src/rank.ts", depth: null },
  ]);
  assert.equal(
    text,
    "[DEPENDENCY] packages/gateway/src/gateway.ts directly imports:\n- packages/core/retrieval/src/service.ts\n- packages/core/ranking/src/rank.ts",
  );
});

test("formatDependencyContent: 'dependent' relation never claims something will break", () => {
  const text = formatDependencyContent("packages/storage/src/db.ts", "dependent", [
    { fileId: "f1", relativePath: "packages/storage/src/index.ts", depth: null },
  ]);
  assert.equal(text, "[DEPENDENCY] packages/storage/src/db.ts is directly imported by:\n- packages/storage/src/index.ts");
  assert.ok(!text.toLowerCase().includes("break"));
});

test("formatDependencyContent: 'impact' relation states depth and uses 'transitively depends on', never 'will break'", () => {
  const text = formatDependencyContent("packages/storage/src/db.ts", "impact", [
    { fileId: "f1", relativePath: "packages/mcp/src/bootstrap.ts", depth: 1 },
  ]);
  assert.equal(
    text,
    "[POTENTIAL IMPACT] packages/storage/src/db.ts transitively depends on this file at depth 1:\n- packages/mcp/src/bootstrap.ts",
  );
  assert.ok(!text.toLowerCase().includes("will break"));
});
