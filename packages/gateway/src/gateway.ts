import {
  type Candidate,
  type ContextEventMemory,
  type MemoryRecord,
  type MemoryResult,
  type RankedResult,
  type ContextPack,
  type FeedbackEvent,
  type OutcomeEvent,
} from "@brain/contracts";
import type { MemoryService } from "@brain/memory";
import type { RetrievalService } from "@brain/retrieval";
import type { EventService } from "@brain/learning";
import { rank } from "@brain/ranking";
import { compileContext } from "@brain/context";
import { optimizeContext, estimateTokens } from "@brain/token";
import { BrainError, invalidRequest, notFound, internalError } from "./errors.js";
import type {
  ContextDelivery,
  GetContextRequest,
  RecallRequest,
  SearchRequest,
  ForgetRequest,
  RememberRequest,
  UpdateRequest,
  FeedbackRequest,
  RecordOutcomeRequest,
  StatusResult,
  ProjectRequest,
  ProjectInfo,
} from "./types.js";

const DEFAULT_CANDIDATE_LIMIT = 50;
const PROJECT_COUNT_LIMIT = 500;

/**
 * The Brain Gateway: exposes the 10 stable brain_* capabilities, orchestrates
 * Core services into them, and stays completely independent of any transport
 * (ARCHITECTURE.md 6, this task's Step 7). packages/mcp is one possible caller;
 * a future HTTP/CLI/SDK adapter would be another, unchanged.
 *
 * No module-level or instance-level MUTABLE state is ever touched by a method
 * here -- every method takes its scope/request as a plain parameter and reads
 * only the (immutable, constructor-injected) service references. This is
 * deliberate: AUDIT_AEOS_BRAIN.md 20 found a module-level `currentAgentScope`
 * variable that let concurrent requests bleed into each other. That class of
 * bug is structurally impossible here, not just avoided by convention.
 *
 * Constructed with already-built service instances (dependency injection) --
 * this class never imports or constructs a concrete storage implementation
 * itself. Wiring SqliteMemoryRepository etc. to these services happens exactly
 * once, in packages/mcp's composition-root bootstrap file.
 */
export class Gateway {
  constructor(
    private readonly memory: MemoryService,
    private readonly retrieval: RetrievalService,
    private readonly events: EventService,
    private readonly capabilities: { vectorSearchAvailable: boolean },
  ) {}

  /** brain_context: the full retrieval -> ranking -> context -> budget pipeline. */
  async getContext(request: GetContextRequest): Promise<ContextDelivery> {
    this.requireNonEmpty(request.task, "task");

    // P2-015: stage timings, measured around the four existing calls with a
    // monotonic clock. performance.now() is monotonic and unaffected by wall-clock
    // adjustments, which Date.now() is not -- a clock step must not be able to
    // produce a negative duration.
    let candidates: Candidate[];
    const retrievalStart = performance.now();
    try {
      candidates = await this.retrieval.getCandidates({ text: request.task, scope: request.scope, limit: DEFAULT_CANDIDATE_LIMIT });
    } catch (error) {
      throw this.wrapUnexpected(error, "retrieval failed");
    }
    const retrievalMs = performance.now() - retrievalStart;

    const rankingStart = performance.now();
    const rankedResults: RankedResult[] = rank({ candidates, task: request.task });
    const rankingMs = performance.now() - rankingStart;

    const compileStart = performance.now();
    const compiledContext = compileContext({ task: request.task, scope: request.scope, rankedResults });
    const compileMs = performance.now() - compileStart;

    const optimizeStart = performance.now();
    const contextPack = optimizeContext(compiledContext, request.budget);
    const optimizeMs = performance.now() - optimizeStart;

    // Telemetry: automatic, matching the one part of the learning loop both
    // Phase 0 predecessors got right (retrieval is always logged) -- but this
    // time also recording which candidates actually survived into context, the
    // distinction ARCHITECTURE.md 17's Phase 0 addition requires, AND (P2-005)
    // returning the resulting delivery id so the agent can refer back to this
    // exact delivery. Phase 1 minted that id and never returned it, which is why
    // 13 of 13 recorded deliveries turned out to be uncorrelatable.
    let contextId: string | null = null;
    try {
      const retrievalEvent = await this.events.recordRetrieval({
        scope: request.scope,
        queryText: request.task,
        candidateIds: candidates.map((c) => c.memoryId),
        taskId: request.taskId ?? null,
      });

      const includedIds = new Set(contextPack.items.map((i) => i.memoryId));
      const contextEvent = await this.events.recordContext({
        retrievalEventId: retrievalEvent.id,
        scope: request.scope,
        taskId: request.taskId ?? null,
        includedMemoryIds: [...includedIds],
        omittedMemoryIds: candidates.map((c) => c.memoryId).filter((id) => !includedIds.has(id)),
        tokenCount: contextPack.tokenCount,
        memories: this.membershipRows(candidates, contextPack),
        candidateCount: candidates.length,
        candidateTokenCount: this.candidateTokenCount(candidates),
        retrievalMs: Math.round(retrievalMs),
        rankingMs: Math.round(rankingMs),
        compileMs: Math.round(compileMs),
        optimizeMs: Math.round(optimizeMs),
      });
      contextId = contextEvent.id;
    } catch (error) {
      // Telemetry must never block the agent from getting its context -- but it
      // must not be silently invisible either (AUDIT_AEOS_BRAIN.md 13's "RPC may
      // not exist yet, non-fatal" antipattern is exactly what this is not: it's
      // logged loudly, just not allowed to fail the request). contextId stays
      // null, which tells the caller the delivery was not recorded rather than
      // handing it an id that references nothing.
      console.error("brain_context: telemetry recording failed (context still returned):", error);
    }

    return { ...contextPack, contextId };
  }

  /**
   * P2-006: one row per candidate this delivery represents.
   *
   * `tokenCount` is measured over the content ACTUALLY DELIVERED, using the same
   * estimator core/token used to enforce the budget -- so a compressed item
   * reports its compressed size, and the included rows sum to
   * ContextPack.tokenCount by construction rather than by coincidence.
   *
   * Omitted candidates get null for both rank and tokenCount: nothing was
   * delivered, so neither exists. Their pooled cost is reported separately as
   * candidateTokenCount.
   */
  private membershipRows(candidates: Candidate[], pack: ContextPack): ContextEventMemory[] {
    const delivered = new Map(pack.items.map((item) => [item.memoryId, item]));

    return candidates.map((candidate): ContextEventMemory => {
      const item = delivered.get(candidate.memoryId);
      if (!item) return { memoryId: candidate.memoryId, included: false, rank: null, tokenCount: null };
      return {
        memoryId: candidate.memoryId,
        included: true,
        rank: item.rank,
        tokenCount: this.safeEstimate(item.content),
      };
    });
  }

  /**
   * Total estimated cost of the candidate pool BEFORE compilation and budget
   * enforcement, over full source content.
   *
   * This is the denominator of deliveredTokens / candidateTokens. That ratio
   * measures selection compression from pool to delivered context -- it is NOT
   * "tokens saved", because the pool was never going to be sent in full.
   */
  private candidateTokenCount(candidates: Candidate[]): number | null {
    let total = 0;
    for (const candidate of candidates) {
      const cost = this.safeEstimate(candidate.record.content);
      if (cost === null) return null; // partial sums would be quietly wrong
      total += cost;
    }
    return total;
  }

  /** A measurement failure degrades to "not recorded", never to a failed request. */
  private safeEstimate(content: string): number | null {
    try {
      return estimateTokens(content);
    } catch (error) {
      console.warn("token estimation failed while recording measurement (recorded as null):", error);
      return null;
    }
  }

  /**
   * P2-005: a caller-supplied contextId must name a real delivery. Rejecting an
   * unknown id loudly is the point -- silently accepting one produces a durable
   * event that appears correlated and is not, which is strictly worse than the
   * Phase 1 state of having no correlation at all.
   */
  private async requireKnownContext(contextId: string | null | undefined): Promise<void> {
    if (contextId === null || contextId === undefined) return;
    const contextEvent = await this.events.getContextEvent(contextId);
    if (!contextEvent) {
      throw invalidRequest(`contextId ${contextId} does not reference a recorded context delivery`);
    }
  }

  /** brain_recall: direct id/filter lookup -- no ranking, no context compilation. */
  async recall(request: RecallRequest): Promise<MemoryResult | MemoryRecord> {
    if (request.id) {
      const record = await this.memory.get(request.id, request.scope);
      if (!record) throw notFound(`memory ${request.id} not found in this scope`);
      return record;
    }
    return this.memory.query({
      scope: request.scope,
      type: request.type,
      tags: request.tags,
      status: request.status,
      limit: request.limit,
    });
  }

  /** brain_search: ranked candidates, no budget enforcement, no context compilation. */
  async search(request: SearchRequest): Promise<RankedResult[]> {
    this.requireNonEmpty(request.text, "text");
    let candidates;
    try {
      candidates = await this.retrieval.getCandidates({
        text: request.text,
        scope: request.scope,
        limit: request.limit ?? DEFAULT_CANDIDATE_LIMIT,
        filters: request.filters,
      });
    } catch (error) {
      throw this.wrapUnexpected(error, "search failed");
    }
    return rank({ candidates, task: request.text });
  }

  /** brain_remember */
  async remember(request: RememberRequest): Promise<MemoryRecord> {
    try {
      return await this.memory.create(request);
    } catch (error) {
      throw this.wrapValidationOrUnexpected(error);
    }
  }

  /** brain_update */
  async update(request: UpdateRequest): Promise<MemoryRecord> {
    try {
      return await this.memory.update(request.input, request.scope);
    } catch (error) {
      throw this.wrapNotFoundOrUnexpected(error, request.input.id);
    }
  }

  /** brain_forget: archives (soft delete). Never a hard purge. */
  async forget(request: ForgetRequest): Promise<MemoryRecord> {
    try {
      return await this.memory.archive(request.id, request.scope);
    } catch (error) {
      throw this.wrapNotFoundOrUnexpected(error, request.id);
    }
  }

  /** brain_feedback */
  async feedback(request: FeedbackRequest): Promise<FeedbackEvent> {
    await this.requireKnownContext(request.contextId);
    return this.events.recordFeedback(request);
  }

  /** brain_record_outcome */
  async recordOutcome(request: RecordOutcomeRequest): Promise<OutcomeEvent> {
    await this.requireKnownContext(request.contextId);
    return this.events.recordOutcome(request);
  }

  /** brain_status: the one operation that needs no scope resolution at all. */
  async status(): Promise<StatusResult> {
    return { ok: true, vectorSearchAvailable: this.capabilities.vectorSearchAvailable };
  }

  /** brain_project: minimal -- confirms a project scope and reports its memory count. Not a project-management system. */
  async project(request: ProjectRequest): Promise<ProjectInfo> {
    this.requireNonEmpty(request.projectId, "projectId");
    const result = await this.memory.query({
      scope: { kind: "project", id: request.projectId },
      limit: PROJECT_COUNT_LIMIT,
    });
    return { projectId: request.projectId, memoryCount: result.items.length };
  }

  private requireNonEmpty(value: string, field: string): void {
    if (!value || value.trim().length === 0) {
      throw invalidRequest(`${field} must not be empty`);
    }
  }

  private wrapUnexpected(error: unknown, message: string): BrainError {
    if (error instanceof BrainError) return error;
    return internalError(message, error);
  }

  private wrapValidationOrUnexpected(error: unknown): BrainError {
    if (error instanceof BrainError) return error;
    // Zod validation errors (malformed create input) are the caller's fault.
    if (error instanceof Error && error.name === "ZodError") {
      return invalidRequest(error.message, error);
    }
    return internalError("remember failed", error);
  }

  private wrapNotFoundOrUnexpected(error: unknown, id: string): BrainError {
    if (error instanceof BrainError) return error;
    // MemoryRepository.update/archive throw a plain Error for "not found in this
    // scope" -- translated to NOT_FOUND here, deliberately not a distinct
    // scope-violation code (see errors.ts's doc comment on the oracle risk).
    if (error instanceof Error && /not found/i.test(error.message)) {
      return notFound(`memory ${id} not found in this scope`);
    }
    return internalError("operation failed", error);
  }
}
