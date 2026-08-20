/**
 * Deliberately small (3 codes, not the 8 raw categories a first read of the task
 * brief lists) -- most of those categories are already solved as graceful
 * degradation at a lower layer, not gateway-level failures:
 *
 * - "semantic retrieval degradation": RetrievalService already catches this and
 *   returns lexical-only results (P1-008) -- the call succeeds, nothing to
 *   report as an error.
 * - "tokenization failure": optimizeContext already catches this per-item and
 *   omits just that item, continuing (P1-011) -- the call still succeeds.
 * - "unavailable capability": every one of the 10 brain_* operations is fully
 *   implemented; there is no partially-missing capability to report as
 *   unavailable in Phase 1.
 * - "scope violation" is deliberately NOT its own code, and deliberately does
 *   NOT get a different code than "not found": distinguishing "doesn't exist"
 *   from "exists, but not in your scope" would be a cross-scope existence
 *   oracle -- exactly the kind of accidental information leak
 *   ARCHITECTURE.md 21 (isolation) exists to prevent. Both cases return
 *   NOT_FOUND, on purpose.
 *
 * "storage failure" / "internal error" both map to INTERNAL -- a genuine,
 * unexpected infrastructure failure, as opposed to a bad request.
 */
export const BRAIN_ERROR_CODES = ["invalid_request", "not_found", "internal"] as const;
export type BrainErrorCode = (typeof BRAIN_ERROR_CODES)[number];

export class BrainError extends Error {
  readonly code: BrainErrorCode;

  constructor(code: BrainErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "BrainError";
    this.code = code;
  }
}

export function invalidRequest(message: string, cause?: unknown): BrainError {
  return new BrainError("invalid_request", message, cause);
}

export function notFound(message: string): BrainError {
  return new BrainError("not_found", message);
}

export function internalError(message: string, cause?: unknown): BrainError {
  return new BrainError("internal", message, cause);
}
