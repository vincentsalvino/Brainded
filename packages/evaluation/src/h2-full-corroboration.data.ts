/**
 * 2C.10. The 10 metrics-eligible `organic-2C8` pairs from
 * docs/PHASE_2C8_REPORT.md, combined with `hybrid-classifier-regression.data.ts`'s
 * frozen 99 to reproduce docs/PHASE_2C9_REPORT.md's 109-pair Strategy H2
 * confusion matrix (TP 35 / FP 0 / TN 66 / FN 8) against the real production
 * classifier. `expectedLabel` is the human ground truth from 2C.8's content
 * review, NOT Strategy A's (sometimes wrong) prediction.
 *
 * Content is the real, live production text for each memory id, read
 * read-only from `data/brain.db` and cross-checked: every pair's
 * `containmentCoefficient(contentA, contentB)` reproduces 2C.9's reported
 * containment value exactly (verified against the compiled classifier before
 * this file was written). The two 2C.8-organic true positives here
 * (`be174a56~ce0fa075`, `e104c851~f4ebe0ae`) are H2's known, disclosed recall
 * loss -- kept at their real `NEAR_DUPLICATE` ground truth, not relabeled to
 * make H2 look better.
 *
 * Excludes: the historical `a76fdf66~cb18ede2` pair (content-identical to
 * `rest-api-a2`, already counted in the frozen 99 -- 2C.9's own dedup
 * finding) and the one AMBIGUOUS pair (`7bf3c5d9~be174a56`, cosine 0.8496),
 * both per the 2C.10 instruction not to duplicate or score them.
 */

export interface OrganicPair {
  id: string;
  provenance: "organic-2C8";
  expectedLabel: "NEAR_DUPLICATE" | "DISTINCT";
  similarity: number;
  contentA: string;
  contentB: string;
}

export const ORGANIC_2C8_PAIRS: OrganicPair[] = [
  // 2 true positives -- H2's known, disclosed recall loss (containment 0.25 / 0.3846, both < 0.40).
  {
    id: "be174a56~ce0fa075",
    provenance: "organic-2C8",
    expectedLabel: "NEAR_DUPLICATE",
    similarity: 0.8428,
    contentA: "pilot-file-api reads uploads as a stream and aborts as soon as the running byte total exceeds the size limit, rather than buffering the entire file first and checking its size afterward.",
    contentB: "pilot-file-api enforces its size/type limits twice: first a fast pre-body check against the Content-Type and Content-Length headers on POST /files, then the streaming abort as a backstop in case the declared length was wrong.",
  },
  {
    id: "e104c851~f4ebe0ae",
    provenance: "organic-2C8",
    expectedLabel: "NEAR_DUPLICATE",
    similarity: 0.8016,
    contentA: "pilot-cache-service route handlers must only call CacheAsideItemService; they must never import or construct ItemsRepository or CacheStore directly.",
    contentB: "pilot-cache-service: the cache is always populated from the repository on a miss and is never treated as the source of truth. Callers must go through CacheAsideItemService, not read the cache store directly.",
  },
  // 2 false positives under Strategy A -- H2's headline fix (containment 0.375 / 0.3333, both < 0.40).
  {
    id: "909d5511~f4ebe0ae",
    provenance: "organic-2C8",
    expectedLabel: "DISTINCT",
    similarity: 0.8813,
    contentA: "pilot-cache-service: if the cache backend throws on read or write, CacheAsideItemService must degrade to a direct repository fetch rather than failing the request.",
    contentB: "pilot-cache-service: the cache is always populated from the repository on a miss and is never treated as the source of truth. Callers must go through CacheAsideItemService, not read the cache store directly.",
  },
  {
    id: "05fede4b~5b880968",
    provenance: "organic-2C8",
    expectedLabel: "DISTINCT",
    similarity: 0.838,
    contentA: "pilot-job-worker retries a failing job up to 3 attempts, immediately and in place, before reporting it permanently failed; there is no backoff delay between attempts in this codebase.",
    contentB: "pilot-job-worker sends a job that exhausts all 3 retry attempts to a dead-letter JobQueue (passed into the Worker constructor), wrapped as {job, error}; a job is never silently dropped after exhausting retries.",
  },
  // 6 true negatives, all below both candidateFloor's containment bar and (bar 909d5511~e104c851) below 0.80 too.
  {
    id: "2f7e5e5e~44d5253f",
    provenance: "organic-2C8",
    expectedLabel: "DISTINCT",
    similarity: 0.7903,
    contentA: "pilot-webhook-service records every individual outbound delivery attempt (not just the final outcome) to a deliveryLog with status, timestamp, and error if any, so delivery history remains inspectable even after eventual success or final failure.",
    contentB: "pilot-webhook-service retries a failed outbound delivery up to 5 attempts with exponential backoff starting at 100ms (100, 200, 400, 800ms), unlike a simple immediate retry -- a slow subscriber needs breathing room between attempts.",
  },
  {
    id: "909d5511~e104c851",
    provenance: "organic-2C8",
    expectedLabel: "DISTINCT",
    similarity: 0.7775,
    contentA: "pilot-cache-service: if the cache backend throws on read or write, CacheAsideItemService must degrade to a direct repository fetch rather than failing the request.",
    contentB: "pilot-cache-service route handlers must only call CacheAsideItemService; they must never import or construct ItemsRepository or CacheStore directly.",
  },
  {
    id: "4a455e8d~a05fb864",
    provenance: "organic-2C8",
    expectedLabel: "DISTINCT",
    similarity: 0.7679,
    contentA: "pilot-auth-service session tokens are HMAC-SHA256 signed with a server secret and expire after 15 minutes; the token payload carries only the user id and expiry, never the password hash or other credential material.",
    contentB: "pilot-auth-service passwords must be hashed with scrypt and a random salt before storage; plaintext passwords must never be persisted, logged, or returned in an API response.",
  },
  {
    id: "5b880968~babb1073",
    provenance: "organic-2C8",
    expectedLabel: "DISTINCT",
    similarity: 0.7646,
    contentA: "pilot-job-worker sends a job that exhausts all 3 retry attempts to a dead-letter JobQueue (passed into the Worker constructor), wrapped as {job, error}; a job is never silently dropped after exhausting retries.",
    contentB: "pilot-job-worker tracks idempotency via an in-memory set of processed idempotencyKeys on the Worker instance; a key is only recorded after the job succeeds, so a failed attempt does not block a legitimate retry.",
  },
  {
    id: "0062a433~a05fb864",
    provenance: "organic-2C8",
    expectedLabel: "DISTINCT",
    similarity: 0.7642,
    contentA: "pilot-auth-service route handlers must catch domain errors and translate them into a structured JSON error response with a stable code; an unmapped error must fall back to a generic 500 and must never leak the raw error message or stack trace to the client.",
    contentB: "pilot-auth-service passwords must be hashed with scrypt and a random salt before storage; plaintext passwords must never be persisted, logged, or returned in an API response.",
  },
  {
    id: "7bf3c5d9~ce0fa075",
    provenance: "organic-2C8",
    expectedLabel: "DISTINCT",
    similarity: 0.7588,
    contentA: "pilot-file-api rejects uploads over 5MB and only accepts image/png, image/jpeg, or application/pdf content types; validation happens before any bytes are persisted.",
    contentB: "pilot-file-api enforces its size/type limits twice: first a fast pre-body check against the Content-Type and Content-Length headers on POST /files, then the streaming abort as a backstop in case the declared length was wrong.",
  },
];
