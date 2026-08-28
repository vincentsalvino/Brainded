import { test } from "node:test";
import assert from "node:assert/strict";
import { containmentCoefficient, isNearDuplicate } from "./lexical-containment.js";

// --- containmentCoefficient: pure tokenization + set math ------------------

test("containmentCoefficient: empty content on both sides is 0, never NaN", () => {
  assert.equal(containmentCoefficient("", ""), 0);
});

test("containmentCoefficient: stopword-only content on both sides is 0, never NaN", () => {
  assert.equal(containmentCoefficient("the a an", "and or but"), 0);
});

test("containmentCoefficient: stopwords are actually excluded from the token sets", () => {
  // Raw overlap would be 1/3 (only "fox" shared, out of 3 raw tokens each side).
  // With "the"/"a" removed, overlap becomes 1/2 -- proves removal actually happened.
  assert.equal(containmentCoefficient("the quick fox", "a slow fox"), 0.5);
});

test("containmentCoefficient: project identifiers are not specially stripped", () => {
  // If the shared "phase2c-example-project" prefix were stripped, intersection
  // would drop from 4 tokens to 1 ("rule") and containment would be 0.2, not 0.8.
  const a = "phase2c-example-project rule one";
  const b = "phase2c-example-project rule two";
  assert.equal(containmentCoefficient(a, b), 0.8);
});

// --- isNearDuplicate: the exact Phase 2C.6 Rule H, defaults applied --------

test("isNearDuplicate: cosine 0.81 is a duplicate with zero lexical overlap", () => {
  const result = isNearDuplicate({ cosineSimilarity: 0.81, contentA: "apple banana cherry", contentB: "xylophone zebra yellow" });
  assert.equal(result, true);
});

test("isNearDuplicate: cosine exactly 0.80 is a duplicate (boundary inclusive)", () => {
  const result = isNearDuplicate({ cosineSimilarity: 0.8, contentA: "one two three", contentB: "four five six" });
  assert.equal(result, true);
});

test("isNearDuplicate: real T4~T6 pair (cosine 0.799007, containment 1.0) is a duplicate", () => {
  const result = isNearDuplicate({
    cosineSimilarity: 0.799007,
    contentA: "Route handlers must never access SQLite directly.",
    contentB: "Task API route handlers must never directly access the SQLite database. All persistence operations must go through TaskRepository.",
  });
  assert.equal(result, true);
});

test("isNearDuplicate: real N1~G pair (cosine 0.785122, containment 0.50) is a duplicate at the containment boundary", () => {
  const result = isNearDuplicate({
    cosineSimilarity: 0.785122,
    contentA: "notes-api REST endpoints use plural resource names: /notes, /notes/:id (POST, GET, GET/:id, PATCH/:id, DELETE/:id).",
    contentB: "REST API resources should use plural nouns in endpoint paths, such as /tasks and /notes.",
  });
  assert.equal(result, true);
});

test("isNearDuplicate: real 2C.4 A~B pair (cosine 0.762576, containment 0.286) is distinct", () => {
  const result = isNearDuplicate({
    cosineSimilarity: 0.762576,
    contentA:
      "phase2c-threshold80-pilot application errors must be converted into structured API error responses at the HTTP boundary, while service-layer code should return domain errors rather than HTTP responses.",
    contentB:
      "phase2c-threshold80-pilot unexpected internal failures must be logged with request correlation metadata before a generic server error is returned.",
  });
  assert.equal(result, false);
});

test("isNearDuplicate: real rest-api-c pair (cosine 0.772566, containment 0.333) is distinct", () => {
  const result = isNearDuplicate({
    cosineSimilarity: 0.772566,
    contentA: "REST endpoints must use plural nouns for resource paths, e.g. /notes and /tasks.",
    contentB: "REST endpoints must version their path with a leading /v1, /v2 segment before the resource name.",
  });
  assert.equal(result, false);
});

test("isNearDuplicate: cosine 0.79 with containment ~0.375 (just under 0.40) is distinct", () => {
  const result = isNearDuplicate({
    cosineSimilarity: 0.79,
    contentA: "alpha beta gamma delta epsilon zeta eta theta",
    contentB: "alpha beta gamma iota kappa lambda mu nu xi omicron pi rho sigma",
  });
  assert.equal(result, false);
});

test("isNearDuplicate: cosine 0.749 with perfect containment (1.0) is still distinct -- below the candidate floor entirely", () => {
  const identical = "identical content on both sides of this pair";
  const result = isNearDuplicate({ cosineSimilarity: 0.749, contentA: identical, contentB: identical });
  assert.equal(result, false);
});

test("isNearDuplicate: empty content never produces NaN or throws, even above the candidate floor", () => {
  const result = isNearDuplicate({ cosineSimilarity: 0.77, contentA: "", contentB: "" });
  assert.equal(result, false);
  assert.equal(Number.isNaN(result as unknown as number), false);
});
