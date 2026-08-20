import { test } from "node:test";
import assert from "node:assert/strict";
import { compress, MIN_COMPRESSION_FLOOR_TOKENS } from "./compress.js";

// Simple, deterministic test estimator: 1 token per 3 characters, ceil'd --
// matches the shape of the real default estimator in @brain/token without
// depending on that package (this package must stay dependency-free).
const estimate = (text: string): number => Math.ceil(text.length / 3);

test("content already within budget is returned unchanged, wasCompressed false", () => {
  const result = compress("short", 100, estimate);
  assert.equal(result.content, "short");
  assert.equal(result.wasCompressed, false);
});

test("oversized content is truncated to fit, with a marker, wasCompressed true", () => {
  const long = "x".repeat(1000);
  const result = compress(long, 50, estimate);
  assert.equal(result.wasCompressed, true);
  assert.ok(estimate(result.content) <= 50, "truncated result must fit the target");
  assert.match(result.content, /\[\.\.\.truncated\]$/);
});

test("truncated output never exceeds targetTokens per the given estimator, across many sizes", () => {
  const long = "the quick brown fox jumps over the lazy dog ".repeat(50);
  for (const target of [MIN_COMPRESSION_FLOOR_TOKENS, 25, 50, 100, 200]) {
    const result = compress(long, target, estimate);
    assert.ok(estimate(result.content) <= target, `target=${target} violated: got ${estimate(result.content)}`);
  }
});

test("below the minimum floor, content is returned unmodified (cannot fit, not a mangled fragment)", () => {
  const long = "x".repeat(1000);
  const result = compress(long, MIN_COMPRESSION_FLOOR_TOKENS - 1, estimate);
  assert.equal(result.content, long, "unmodified -- the caller's own budget check will catch that this still doesn't fit");
  assert.equal(result.wasCompressed, false);
});

test("works correctly with a non-linear/arbitrary estimator, not just a fixed ratio", () => {
  // An estimator that counts words, not characters -- proves the binary search
  // doesn't assume any particular chars-per-token relationship.
  const wordEstimate = (text: string): number => text.split(/\s+/).filter(Boolean).length;
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const result = compress(long, 30, wordEstimate);
  assert.ok(wordEstimate(result.content) <= 30);
  assert.equal(result.wasCompressed, true);
});

test("empty content needs no compression", () => {
  const result = compress("", 10, estimate);
  assert.equal(result.content, "");
  assert.equal(result.wasCompressed, false);
});

test("deterministic: identical input produces identical output across repeated calls", () => {
  const long = "the quick brown fox ".repeat(30);
  const a = compress(long, 40, estimate);
  const b = compress(long, 40, estimate);
  assert.deepEqual(a, b);
});
