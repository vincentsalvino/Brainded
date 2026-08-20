import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MEMORY_TYPES, MemoryRecordSchema, MemoryCreateInputSchema, MemoryUpdateInputSchema } from "./memory.js";
import { globalScope, projectScope } from "./scope.js";

function baseRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    type: "fact",
    content: "example",
    domain: null,
    scope: globalScope(),
    source: { origin: "system" },
    confidence: 0.5,
    status: "active",
    tags: [],
    supersedes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("accepts a valid record of every one of the 12 memory types", () => {
  for (const type of MEMORY_TYPES) {
    const record = MemoryRecordSchema.parse(baseRecord({ type }));
    assert.equal(record.type, type);
  }
  assert.equal(MEMORY_TYPES.length, 12);
});

test("rejects unrecognized fields on MemoryRecord (strict -- no silent drop, unlike AEOS's non-strict parser)", () => {
  assert.throws(() => MemoryRecordSchema.parse(baseRecord({ unexpectedField: "must fail loudly" })));
});

test("rejects unrecognized fields on MemoryCreateInput", () => {
  assert.throws(() =>
    MemoryCreateInputSchema.parse({
      type: "fact",
      content: "x",
      scope: projectScope("p1"),
      notAField: true,
    }),
  );
});

test("create input defaults confidence to 0.5 when omitted", () => {
  const input = MemoryCreateInputSchema.parse({ type: "fact", content: "x", scope: projectScope("p1") });
  assert.equal(input.confidence, 0.5);
});

test("create input defaults tags to an empty array when omitted", () => {
  const input = MemoryCreateInputSchema.parse({ type: "fact", content: "x", scope: projectScope("p1") });
  assert.deepEqual(input.tags, []);
});

test("create input rejects confidence outside the 0-1 range", () => {
  assert.throws(() =>
    MemoryCreateInputSchema.parse({ type: "fact", content: "x", scope: projectScope("p1"), confidence: 1.5 }),
  );
});

test("create input rejects empty content", () => {
  assert.throws(() =>
    MemoryCreateInputSchema.parse({ type: "fact", content: "", scope: projectScope("p1") }),
  );
});

test("update input allows the archived transition", () => {
  const update = MemoryUpdateInputSchema.parse({ id: randomUUID(), status: "archived" });
  assert.equal(update.status, "archived");
});

test("update input rejects any status value other than 'archived'", () => {
  assert.throws(() => MemoryUpdateInputSchema.parse({ id: randomUUID(), status: "active" }));
});

test("update input rejects attempts to change type (immutable per PHASE_1_SPEC.md)", () => {
  assert.throws(() => MemoryUpdateInputSchema.parse({ id: randomUUID(), type: "decision" }));
});

test("update input rejects attempts to change scope (immutable per PHASE_1_SPEC.md)", () => {
  assert.throws(() => MemoryUpdateInputSchema.parse({ id: randomUUID(), scope: projectScope("p2") }));
});
