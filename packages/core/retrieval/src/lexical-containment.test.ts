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

// --- isNearDuplicate: Phase 2C.10 Strategy H2, defaults applied -----------
// No unconditional cosine bypass at any cosine value -- containment must
// always corroborate, even at cosine 0.99 (docs/PHASE_2C9_REPORT.md's
// false-positive-recovery finding). This is the most important regression:
// high cosine alone must never again be enough.

test("isNearDuplicate: cosine 0.99 with zero lexical overlap is distinct -- high cosine no longer bypasses corroboration", () => {
  const result = isNearDuplicate({ cosineSimilarity: 0.99, contentA: "apple banana cherry", contentB: "xylophone zebra yellow" });
  assert.equal(result, false);
});

test("isNearDuplicate: cosine exactly 0.80 with zero containment is distinct -- 0.80 is no longer a special unconditional threshold", () => {
  const result = isNearDuplicate({ cosineSimilarity: 0.8, contentA: "one two three", contentB: "four five six" });
  assert.equal(result, false);
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

test("isNearDuplicate: cosine 0.7499 with perfect containment (1.0) is still distinct -- below the candidate floor entirely", () => {
  const identical = "identical content on both sides of this pair";
  const result = isNearDuplicate({ cosineSimilarity: 0.7499, contentA: identical, contentB: identical });
  assert.equal(result, false);
});

// --- 2C.10: Strategy H2 real-evidence cases (docs/PHASE_2C9_REPORT.md) ----

test("isNearDuplicate: real 2C.8 cache-service false positive (cosine 0.8813, containment 0.3750) is now correctly distinct", () => {
  const result = isNearDuplicate({
    cosineSimilarity: 0.8813,
    contentA: "pilot-cache-service: if the cache backend throws on read or write, CacheAsideItemService must degrade to a direct repository fetch rather than failing the request.",
    contentB: "pilot-cache-service: the cache is always populated from the repository on a miss and is never treated as the source of truth. Callers must go through CacheAsideItemService, not read the cache store directly.",
  });
  assert.equal(result, false);
});

test("isNearDuplicate: real 2C.8 job-worker false positive (cosine 0.8380, containment 0.3333) is now correctly distinct", () => {
  const result = isNearDuplicate({
    cosineSimilarity: 0.838,
    contentA: "pilot-job-worker retries a failing job up to 3 attempts, immediately and in place, before reporting it permanently failed; there is no backoff delay between attempts in this codebase.",
    contentB: "pilot-job-worker sends a job that exhausts all 3 retry attempts to a dead-letter JobQueue (passed into the Worker constructor), wrapped as {job, error}; a job is never silently dropped after exhausting retries.",
  });
  assert.equal(result, false);
});

test("isNearDuplicate: historical global/global duplicate (cosine 0.999573, containment 1.0) remains a duplicate -- H2 does not break obvious exact duplication", () => {
  const result = isNearDuplicate({
    cosineSimilarity: 0.999573,
    contentA: "REST API resources should use plural nouns in endpoint paths, such as /notes and /tasks.",
    contentB: "REST API resources should use plural nouns in endpoint paths, such as /tasks and /notes.",
  });
  assert.equal(result, true);
});

test("isNearDuplicate: real 2C.8 file-api true positive (cosine 0.8428, containment 0.25) is a KNOWN, disclosed H2 recall loss -- now distinct", () => {
  const result = isNearDuplicate({
    cosineSimilarity: 0.8428,
    contentA: "pilot-file-api reads uploads as a stream and aborts as soon as the running byte total exceeds the size limit, rather than buffering the entire file first and checking its size afterward.",
    contentB: "pilot-file-api enforces its size/type limits twice: first a fast pre-body check against the Content-Type and Content-Length headers on POST /files, then the streaming abort as a backstop in case the declared length was wrong.",
  });
  assert.equal(result, false);
});

test("isNearDuplicate: real 2C.8 cache-service true positive (cosine 0.8016, containment 0.3846) is a KNOWN, disclosed H2 recall loss -- now distinct", () => {
  const result = isNearDuplicate({
    cosineSimilarity: 0.8016,
    contentA: "pilot-cache-service route handlers must only call CacheAsideItemService; they must never import or construct ItemsRepository or CacheStore directly.",
    contentB: "pilot-cache-service: the cache is always populated from the repository on a miss and is never treated as the source of truth. Callers must go through CacheAsideItemService, not read the cache store directly.",
  });
  assert.equal(result, false);
});

test("isNearDuplicate: empty content never produces NaN or throws, even above the candidate floor", () => {
  const result = isNearDuplicate({ cosineSimilarity: 0.77, contentA: "", contentB: "" });
  assert.equal(result, false);
  assert.equal(Number.isNaN(result as unknown as number), false);
});
