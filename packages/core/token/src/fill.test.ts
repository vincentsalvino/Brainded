import { test } from "node:test";
import assert from "node:assert/strict";
import { fillBudget } from "./fill.js";

interface Fixture { content: string; rank: number; wasCompressed: boolean; id: string }

function item(id: string, content: string, rank: number): Fixture {
  return { id, content, rank, wasCompressed: false };
}

const identity = (i: Fixture): string => i.id;
const charEstimate = (text: string): number => text.length;
const noCompress = (content: string): { content: string; wasCompressed: boolean } => ({ content, wasCompressed: false });

test("fillBudget: generic over any {content,rank,wasCompressed} shape, not just ContextItem", () => {
  const items = [item("a", "12345", 1), item("b", "123", 2)];
  const result = fillBudget(items, { maxTokens: 100 }, charEstimate, noCompress, identity);
  assert.equal(result.included.length, 2);
  assert.equal(result.tokenCount, 8);
});

test("fillBudget: a tiny budget omits everything predictably, never throws", () => {
  const items = [item("a", "12345", 1)];
  const result = fillBudget(items, { maxTokens: 0 }, charEstimate, noCompress, identity);
  assert.deepEqual(result.included, []);
  assert.equal(result.omittedCount, 1);
});

test("fillBudget: identify() is used in the omission warning path (smoke test -- does not assert console output, only that it does not throw)", () => {
  const failingEstimate = (): number => { throw new Error("boom"); };
  const result = fillBudget([item("x", "abc", 1)], { maxTokens: 10 }, failingEstimate, noCompress, identity);
  assert.equal(result.omittedCount, 1);
});
