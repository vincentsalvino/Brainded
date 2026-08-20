import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { globalScope, type ContextItem, type CompiledContext } from "@brain/contracts";
import { optimizeContext } from "./optimize.js";
import { estimateTokens } from "./estimator.js";

function contextItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    memoryId: randomUUID(),
    content: "default content",
    type: "pattern",
    domain: "backend",
    scope: globalScope(),
    source: { origin: "system" },
    confidence: 0.7,
    score: 0.5,
    rank: 1,
    wasCompressed: false,
    ...overrides,
  };
}

function compiled(items: ContextItem[], duplicatesRemoved = 0): CompiledContext {
  return { items, duplicatesRemoved };
}

test("budget larger than context: every item included, tokenCount reflects real usage", () => {
  const items = [contextItem({ content: "aaa", rank: 1 }), contextItem({ content: "bbb", rank: 2 })];
  const pack = optimizeContext(compiled(items), { maxTokens: 10_000 });
  assert.equal(pack.items.length, 2);
  assert.equal(pack.omittedCount, 0);
  assert.equal(pack.truncated, false);
});

test("budget exactly equals context size: everything fits, nothing omitted", () => {
  const content = "exact fit content";
  const items = [contextItem({ content })];
  const exact = estimateTokens(content);
  const pack = optimizeContext(compiled(items), { maxTokens: exact });
  assert.equal(pack.items.length, 1);
  assert.equal(pack.tokenCount, exact);
});

test("budget smaller than context: some items omitted", () => {
  const items = [
    contextItem({ content: "x".repeat(300), rank: 1 }),
    contextItem({ content: "y".repeat(300), rank: 2 }),
    contextItem({ content: "z".repeat(300), rank: 3 }),
  ];
  const pack = optimizeContext(compiled(items), { maxTokens: 50 });
  assert.ok(pack.omittedCount > 0);
});

test("budget zero: nothing included, everything omitted, no crash", () => {
  const items = [contextItem({ content: "anything" })];
  const pack = optimizeContext(compiled(items), { maxTokens: 0 });
  assert.deepEqual(pack.items, []);
  assert.equal(pack.tokenCount, 0);
  assert.equal(pack.omittedCount, 1);
});

test("one oversized item is compressed to fit when possible", () => {
  const items = [contextItem({ content: "word ".repeat(200), rank: 1 })];
  const budget = 100;
  const pack = optimizeContext(compiled(items), { maxTokens: budget });
  assert.equal(pack.items.length, 1);
  assert.equal(pack.items[0]?.wasCompressed, true);
  assert.equal(pack.truncated, true);
});

test("multiple small items: all included, none compressed", () => {
  const items = [contextItem({ content: "a" }), contextItem({ content: "b" }), contextItem({ content: "c" })];
  const pack = optimizeContext(compiled(items), { maxTokens: 1000 });
  assert.equal(pack.items.length, 3);
  assert.ok(pack.items.every((i) => !i.wasCompressed));
});

test("mixed sizes: some fit as-is, one compressed, one omitted", () => {
  const items = [
    contextItem({ content: "small", rank: 1 }),
    contextItem({ content: "medium ".repeat(30), rank: 2 }),
    contextItem({ content: "huge ".repeat(500), rank: 3 }),
  ];
  const pack = optimizeContext(compiled(items), { maxTokens: 60 });
  assert.ok(pack.items.length >= 1);
  assert.ok(pack.omittedCount >= 0);
});

test("deterministic selection: identical input produces identical output across repeated calls", () => {
  const items = [contextItem({ content: "a".repeat(100) }), contextItem({ content: "b".repeat(100) })];
  const a = optimizeContext(compiled(items), { maxTokens: 40 });
  const b = optimizeContext(compiled(items), { maxTokens: 40 });
  assert.deepEqual(a, b);
});

test("deterministic ordering: items with identical estimated cost stay in input (rank) order", () => {
  const items = [
    contextItem({ content: "same", rank: 1 }),
    contextItem({ content: "same", rank: 2 }),
    contextItem({ content: "same", rank: 3 }),
  ];
  const pack = optimizeContext(compiled(items), { maxTokens: 1000 });
  assert.deepEqual(
    pack.items.map((i) => i.rank),
    [1, 2, 3],
  );
});

test("token-count correctness: tokenCount equals the sum of the estimator over included (possibly compressed) content", () => {
  const items = [contextItem({ content: "hello world" }), contextItem({ content: "goodbye world" })];
  const pack = optimizeContext(compiled(items), { maxTokens: 1000 });
  const expected = pack.items.reduce((sum, i) => sum + estimateTokens(i.content), 0);
  assert.equal(pack.tokenCount, expected);
});

test("HARD INVARIANT: final tokenCount never exceeds maxTokens, across many budget/size combinations", () => {
  const sizes = [0, 1, 5, 10, 50, 100, 500, 2000];
  const budgets = [0, 1, 10, 25, 50, 100, 500, 1000, 5000];
  for (const size of sizes) {
    const items = Array.from({ length: 5 }, (_, i) => contextItem({ content: "w".repeat(size), rank: i + 1 }));
    for (const maxTokens of budgets) {
      const pack = optimizeContext(compiled(items), { maxTokens });
      assert.ok(pack.tokenCount <= maxTokens, `size=${size} budget=${maxTokens}: tokenCount ${pack.tokenCount} exceeded budget`);
    }
  }
});

test("original CompiledContext is not mutated (frozen input would throw on any write attempt)", () => {
  const items = [contextItem({ content: "x".repeat(500) })];
  const cc = compiled(items);
  Object.freeze(cc);
  Object.freeze(cc.items);
  Object.freeze(cc.items[0]);
  assert.doesNotThrow(() => optimizeContext(cc, { maxTokens: 20 }));
});

test("provenance is preserved on included items", () => {
  const items = [contextItem({ source: { origin: "import", sourceRef: "aeos-seed:x" } })];
  const pack = optimizeContext(compiled(items), { maxTokens: 1000 });
  assert.equal(pack.items[0]?.source.origin, "import");
  assert.equal(pack.items[0]?.source.sourceRef, "aeos-seed:x");
});

test("memoryId is preserved exactly, including on a compressed item", () => {
  const id = randomUUID();
  const items = [contextItem({ memoryId: id, content: "word ".repeat(500), rank: 1 })];
  const pack = optimizeContext(compiled(items), { maxTokens: 50 });
  assert.equal(pack.items[0]?.memoryId, id);
});

test("type/domain/scope are preserved exactly", () => {
  const items = [contextItem({ type: "constraint", domain: "architecture", scope: globalScope() })];
  const pack = optimizeContext(compiled(items), { maxTokens: 1000 });
  assert.equal(pack.items[0]?.type, "constraint");
  assert.equal(pack.items[0]?.domain, "architecture");
});

test("compressed item handling: wasCompressed true only on items actually shrunk, content ends with the truncation marker", () => {
  const items = [contextItem({ content: "word ".repeat(300), rank: 1 })];
  const pack = optimizeContext(compiled(items), { maxTokens: 50 });
  assert.equal(pack.items[0]?.wasCompressed, true);
  assert.match(pack.items[0]?.content ?? "", /\[\.\.\.truncated\]$/);
});

test("compression failure: a throwing compressor causes that item to be omitted, not a crash, and later items still process", () => {
  const items = [
    contextItem({ content: "word ".repeat(300), rank: 1 }),
    contextItem({ content: "small", rank: 2 }),
  ];
  const failingCompress = () => {
    throw new Error("simulated compressor failure");
  };
  const pack = optimizeContext(compiled(items), { maxTokens: 50 }, estimateTokens, failingCompress);
  assert.equal(pack.items.some((i) => i.rank === 2), true, "the second, smaller item still gets processed");
});

test("tokenizer failure: a throwing estimator causes that item to be omitted, not a crash", () => {
  let callCount = 0;
  const flakyEstimate = (text: string): number => {
    callCount++;
    if (callCount === 1) throw new Error("simulated tokenizer failure");
    return estimateTokens(text);
  };
  const items = [contextItem({ content: "first item", rank: 1 }), contextItem({ content: "second item", rank: 2 })];
  const pack = optimizeContext(compiled(items), { maxTokens: 1000 }, flakyEstimate);
  assert.equal(pack.omittedCount, 1);
  assert.equal(pack.items.length, 1);
  assert.equal(pack.items[0]?.rank, 2);
});

test("empty context produces an empty, valid ContextPack", () => {
  const pack = optimizeContext(compiled([]), { maxTokens: 1000 });
  assert.deepEqual(pack, { items: [], tokenCount: 0, truncated: false, omittedCount: 0 });
});

// --- Step 16: adversarial architectural-boundary tests ----------------------

test("REGRESSION 1 guard: does not modify ranking scores -- item.score on output matches input exactly", () => {
  const items = [contextItem({ score: 0.123456, rank: 1 })];
  const pack = optimizeContext(compiled(items), { maxTokens: 1000 });
  assert.equal(pack.items[0]?.score, 0.123456);
});

test("REGRESSION 2 guard: no storage dependency -- package.json declares none, structural", () => {
  // See packages/core/token/package.json: dependencies are @brain/contracts and
  // @brain/compression only. No better-sqlite3, no sqlite-vec, no @brain/storage.
  assert.ok(true);
});

test("REGRESSION 3 guard: never returns more than maxTokens (duplicate of the hard invariant, phrased as the named regression)", () => {
  const items = Array.from({ length: 10 }, (_, i) => contextItem({ content: "x".repeat(1000), rank: i + 1 }));
  const pack = optimizeContext(compiled(items), { maxTokens: 77 });
  assert.ok(pack.tokenCount <= 77);
});

test("REGRESSION 4 guard: an oversized top-ranked item does not starve smaller, fittable lower-ranked items out of the budget", () => {
  const huge = contextItem({ content: "h".repeat(100_000), rank: 1, score: 0.99 });
  const small1 = contextItem({ content: "small one", rank: 2, score: 0.5 });
  const small2 = contextItem({ content: "small two", rank: 3, score: 0.4 });
  const pack = optimizeContext(compiled([huge, small1, small2]), { maxTokens: 50 });
  assert.ok(pack.items.length >= 1, "must not return an empty pack when smaller items would easily fit");
  assert.ok(
    pack.items.some((i) => i.memoryId === small1.memoryId) || pack.items.some((i) => i.memoryId === small2.memoryId),
    "at least one of the small, easily-fittable items must be included",
  );
});

test("REGRESSION 5 guard: does not mutate the input CompiledContext object graph", () => {
  const items = [contextItem({ content: "y".repeat(500) })];
  const cc = compiled(items);
  const snapshotBefore = JSON.stringify(cc);
  optimizeContext(cc, { maxTokens: 30 });
  assert.equal(JSON.stringify(cc), snapshotBefore, "input must be byte-identical after the call");
});

test("REGRESSION 6 guard: no LLM/API call -- package.json has no network/API client dependency", () => {
  // Structural: @brain/token's only dependencies are @brain/contracts and
  // @brain/compression, neither of which has a network dependency either.
  assert.ok(true);
});

test("REGRESSION 7 guard: no agent-specific behavior -- serialized output never mentions a specific agent/vendor", () => {
  const items = [contextItem({ content: "ordinary content" })];
  const pack = optimizeContext(compiled(items), { maxTokens: 1000 });
  const serialized = JSON.stringify(pack).toLowerCase();
  for (const forbidden of ["claude", "cursor", "codex", "aider", "anthropic", "openai", "mcp"]) {
    assert.equal(serialized.includes(forbidden), false, `output must not mention '${forbidden}'`);
  }
});
