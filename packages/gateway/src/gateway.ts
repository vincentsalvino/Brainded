import {
  type Candidate,
  type ContextEventMemory,
  type MemoryRecord,
  type MemoryResult,
  type RankedResult,
  type ContextPack,
  type ContextItem,
  type FeedbackEvent,
  type OutcomeEvent,
  type SimilarityPair,
  DEFAULT_DEPENDENCY_EXPANSION_POLICY,
  type CodeContextItem,
  type DependencyContextItem,
  type ContextEventSource,
  type CodeSearchResult,
} from "@brain/contracts";
import type { MemoryService } from "@brain/memory";
import { DEFAULT_NEAR_DUPLICATE_POLICY, type NearDuplicatePolicy, type RetrievalService, type CodeRetrievalService } from "@brain/retrieval";
import type { EventService, LearningSignalService } from "@brain/learning";
import type { DependencyGraphService, DependencyRef, ImpactRef } from "@brain/codebase";
import { rank, computeScore, DEFAULT_RANKING_WEIGHTS } from "@brain/ranking";
import { compileContext, formatCodeContent, formatDependencyContent, selectSources } from "@brain/context";
import { optimizeContext, optimizeSources, estimateTokens } from "@brain/token";
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
const DEFAULT_CODE_CANDIDATE_LIMIT = 20;
const PROJECT_COUNT_LIMIT = 500;

/**
 * 2C.7/2C.10. Redundancy config is `{ enabled }` plus the full
 * `NearDuplicatePolicy` (candidateFloor/containmentThreshold) re-exported
 * from @brain/retrieval -- a single flat shape, not a `threshold` field that
 * would otherwise have to mean two different things (the floor passed to
 * storage vs. the containment bar for a duplicate call). See
 * @brain/retrieval's lexical-containment.ts for the policy's own history --
 * 2C.10 removed the unconditional cosine-only bypass this comment used to
 * describe a third field for.
 */
export type RedundancyConfig = { enabled: boolean } & NearDuplicatePolicy;

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
    // 2C-005. Disabled by default: with this flag off, getContext() output is
    // byte-identical to Phase 2B (the no-redundancy regression at the
    // production default, not just as a below-threshold edge case). Ship
    // disabled until Task 8's evaluation justifies enabling it.
    private readonly redundancy: RedundancyConfig = {
      enabled: false,
      ...DEFAULT_NEAR_DUPLICATE_POLICY,
    },
    // 3.4. Both optional and undefined by default: with neither wired, getContext()
    // takes the `codeItems.length === 0 && dependencyItemsBySeed.size === 0` branch
    // below and calls the original optimizeContext unchanged -- byte-identical
    // behavior for every caller that has no coding capability injected.
    private readonly codeRetrieval?: CodeRetrievalService,
    private readonly dependencyGraph?: DependencyGraphService,
    // Phase 4.2 (F10, F2). Optional and undefined by default -- same shape as
    // codeRetrieval/dependencyGraph above -- so every existing construction site
    // (tests, and any future caller that doesn't wire it) stays byte-identical to
    // pre-4.2 behavior. When wired, `learning.decorate()` and `learning.config`
    // gate the two independent fail-safe layers documented on rank()/decorate()
    // themselves: this class does not re-implement the enabled check, it just
    // threads the one LearningSignalService instance's own config through.
    private readonly learning?: LearningSignalService,
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
      if (this.learning) candidates = await this.learning.decorate(candidates);
    } catch (error) {
      throw this.wrapUnexpected(error, "retrieval failed");
    }
    const retrievalMs = performance.now() - retrievalStart;

    const rankingStart = performance.now();
    const rankedResults: RankedResult[] = rank({ candidates, task: request.task, learning: this.learningRankingConfig() });
    const rankingMs = performance.now() - rankingStart;

    // 2C-004/005: redundancy pairs, computed only when enabled. A failure
    // here degrades to "no pairs" -- the same discipline as vector-search
    // unavailability elsewhere in this pipeline -- never a failed request.
    let redundancyPairs: SimilarityPair[] = [];
    if (this.redundancy.enabled) {
      try {
        redundancyPairs = await this.retrieval.getRedundancyPairs(rankedResults, this.redundancy);
      } catch (error) {
        console.warn("brain_context: redundancy detection failed, continuing without it:", error);
      }
    }

    const compileStart = performance.now();
    const compiledContext = compileContext({ task: request.task, scope: request.scope, rankedResults, redundancyPairs });
    const compileMs = performance.now() - compileStart;

    // 3.4: code/dependency retrieval run alongside memory compilation, both
    // degrading to empty (never throwing) on failure -- see getCodeItems/
    // getDependencyItemsBySeed's own doc comments for the per-source failure
    // handling this depends on.
    const codeItems = await this.getCodeItems(request.task, request.scope);
    const dependencyItemsBySeed = await this.getDependencyItemsBySeed(codeItems);

    const optimizeStart = performance.now();
    let contextPack: ContextPack;
    let deliveredCodeItems: CodeContextItem[] | undefined;
    let deliveredDependencyItems: DependencyContextItem[] | undefined;

    // No coding capability wired (or nothing came back from it) -> the original,
    // pre-3.4 memory-only path, byte-identical to Phase 2B/2C. Only when there is
    // at least one code or dependency candidate does the heterogeneous
    // selectSources/optimizeSources path below ever run.
    if (codeItems.length === 0 && dependencyItemsBySeed.size === 0) {
      contextPack = optimizeContext(compiledContext, request.budget);
    } else {
      const wrappers = selectSources(compiledContext.items, codeItems, dependencyItemsBySeed);
      const filled = optimizeSources(wrappers, request.budget);
      const memoryItems: ContextItem[] = [];
      const codeOut: CodeContextItem[] = [];
      const depOut: DependencyContextItem[] = [];
      for (const w of filled.items) {
        // w.rank is selectSources' one true combined 1..N position across
        // memory+code+dependency together -- w.item.rank is each item's stale,
        // independently-numbered-from-1 rank from its OWN source stage
        // (compileContext / getCodeItems / buildDependencyItem's rank:0
        // placeholder) and must never leak through uncorrected, or two items
        // from different source types collide on the same delivered rank.
        if (w.sourceType === "memory") memoryItems.push({ ...w.item, content: w.content, rank: w.rank, wasCompressed: w.wasCompressed });
        else if (w.sourceType === "code") codeOut.push({ ...w.item, content: w.content, rank: w.rank, wasCompressed: w.wasCompressed });
        else depOut.push({ ...w.item, content: w.content, rank: w.rank, wasCompressed: w.wasCompressed });
      }
      contextPack = { items: memoryItems, tokenCount: filled.tokenCount, truncated: filled.truncated, omittedCount: filled.omittedCount };
      deliveredCodeItems = codeOut.length > 0 ? codeOut : undefined;
      deliveredDependencyItems = depOut.length > 0 ? depOut : undefined;
    }
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

      // 3.4: additive code/dependency source telemetry -- a distinct table from
      // context_event_memories (see ContextEventSource's doc comment), fetched
      // separately by the caller rather than nested onto every ContextEvent read.
      const sourceRows = this.buildContextEventSources(codeItems, dependencyItemsBySeed, deliveredCodeItems, deliveredDependencyItems);
      if (sourceRows.length > 0) {
        try {
          await this.events.recordContextSources(contextEvent.id, sourceRows);
        } catch (error) {
          console.error("brain_context: source telemetry recording failed (context still returned):", error);
        }
      }
    } catch (error) {
      // Telemetry must never block the agent from getting its context -- but it
      // must not be silently invisible either (AUDIT_AEOS_BRAIN.md 13's "RPC may
      // not exist yet, non-fatal" antipattern is exactly what this is not: it's
      // logged loudly, just not allowed to fail the request). contextId stays
      // null, which tells the caller the delivery was not recorded rather than
      // handing it an id that references nothing.
      console.error("brain_context: telemetry recording failed (context still returned):", error);
    }

    // exactOptionalPropertyTypes: codeItems/dependencyItems must be OMITTED, not
    // set to literal `undefined`, when there is nothing to deliver -- conditional
    // spread, matching packages/storage's established pattern for optional
    // fields (see docs/superpowers/plans/2026-08-20-phase-2c-efficiency-redundancy.md).
    return {
      ...contextPack,
      contextId,
      ...(deliveredCodeItems !== undefined ? { codeItems: deliveredCodeItems } : {}),
      ...(deliveredDependencyItems !== undefined ? { dependencyItems: deliveredDependencyItems } : {}),
    };
  }

  /** Bounded, scope-native code retrieval + scoring. Never throws -- a failure degrades to no code items. */
  private async getCodeItems(task: string, scope: GetContextRequest["scope"]): Promise<CodeContextItem[]> {
    if (!this.codeRetrieval) return [];
    let results: CodeSearchResult[];
    try {
      results = await this.codeRetrieval.getCandidates({ text: task, scope, limit: DEFAULT_CODE_CANDIDATE_LIMIT });
    } catch (error) {
      console.warn("brain_context: code retrieval failed, continuing without code context:", error);
      return [];
    }
    const scored = results
      .map((r) => ({ result: r, score: computeScore(r.signals, DEFAULT_RANKING_WEIGHTS) }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.result.chunkId < b.result.chunkId ? -1 : 1));
    return scored.map(({ result, score }, index): CodeContextItem => ({
      sourceType: "code",
      chunkId: result.chunkId,
      repositoryId: result.repositoryId,
      fileId: result.fileId,
      relativePath: result.relativePath,
      language: result.language,
      startLine: result.startLine,
      endLine: result.endLine,
      content: formatCodeContent(result),
      score,
      rank: index + 1,
      wasCompressed: false,
    }));
  }

  /** Bounded dependency enrichment for the given (already tier-1-ordered) seed code items. Never throws. */
  private async getDependencyItemsBySeed(codeItems: CodeContextItem[]): Promise<Map<string, DependencyContextItem[]>> {
    const byFileId = new Map<string, DependencyContextItem[]>();
    if (!this.dependencyGraph) return byFileId;
    const policy = DEFAULT_DEPENDENCY_EXPANSION_POLICY;

    // Dedup to distinct file ids BEFORE slicing to maxDependencySeedFiles: two
    // code chunks (entries) from the same file must count as ONE seed, not two
    // -- otherwise a later, genuinely distinct file never gets attempted, and
    // dependenciesOf/dependentsOf/impactOf get redundantly called twice for the
    // same file (masked only by byFileId being keyed on fileId, so the second
    // call's result silently overwrites the first). See PHASE_3_SPEC.md Phase
    // 3.4, Dependency Enrichment -- "top maxDependencySeedFiles code items" means
    // distinct files, not entries.
    const distinctSeeds: CodeContextItem[] = [];
    const seenFileIds = new Set<string>();
    for (const item of codeItems) {
      if (seenFileIds.has(item.fileId)) continue;
      seenFileIds.add(item.fileId);
      distinctSeeds.push(item);
      if (distinctSeeds.length >= policy.maxDependencySeedFiles) break;
    }

    for (const seed of distinctSeeds) {
      const items: DependencyContextItem[] = [];
      try {
        const deps = (await this.dependencyGraph.dependenciesOf(seed.repositoryId, seed.fileId)).slice(0, policy.maxDirectDependenciesPerFile);
        if (deps.length > 0) items.push(this.buildDependencyItem(seed, "dependency", deps.map((d) => ({ ...d, depth: null }))));

        const dependents = (await this.dependencyGraph.dependentsOf(seed.repositoryId, seed.fileId)).slice(0, policy.maxDirectDependentsPerFile);
        if (dependents.length > 0) items.push(this.buildDependencyItem(seed, "dependent", dependents.map((d) => ({ ...d, depth: null }))));

        // Task-5 carry-forward: formatDependencyContent's "impact" branch labels the
        // WHOLE group by facts[0].depth, which is only honest when every fact shares
        // one depth. impactOf's BFS is called with maxDepth: policy.maxImpactDepth
        // (1 by default), and its loop advances depth exactly once before the
        // maxDepth check can stop it -- so with the default policy, every ImpactRef
        // this call can possibly return has depth === 1. See self-review in
        // task-8-report.md for the full trace of why this holds by construction,
        // not by luck.
        const impact = (await this.dependencyGraph.impactOf(seed.repositoryId, seed.fileId, { maxDepth: policy.maxImpactDepth })).slice(0, policy.maxImpactItems);
        if (impact.length > 0) items.push(this.buildDependencyItem(seed, "impact", impact));
      } catch (error) {
        console.warn(`brain_context: dependency enrichment failed for ${seed.relativePath}, continuing without it:`, error);
        continue;
      }
      if (items.length > 0) byFileId.set(seed.fileId, items);
    }
    return byFileId;
  }

  private buildDependencyItem(
    seed: CodeContextItem,
    relation: "dependency" | "dependent" | "impact",
    facts: (DependencyRef & { depth: number | null })[] | ImpactRef[],
  ): DependencyContextItem {
    const normalized = facts.map((f) => ({ fileId: f.fileId, relativePath: f.relativePath, depth: "depth" in f ? f.depth : null }));
    return {
      sourceType: "dependency",
      repositoryId: seed.repositoryId,
      seedFileId: seed.fileId,
      seedRelativePath: seed.relativePath,
      relation,
      facts: normalized,
      content: formatDependencyContent(seed.relativePath, relation, normalized),
      rank: 0,
      wasCompressed: false,
    };
  }

  /** One row per code/dependency candidate considered, included or not -- mirrors membershipRows' memory-side convention. */
  private buildContextEventSources(
    candidateCodeItems: CodeContextItem[],
    candidateDependencyItemsBySeed: Map<string, DependencyContextItem[]>,
    deliveredCodeItems: CodeContextItem[] | undefined,
    deliveredDependencyItems: DependencyContextItem[] | undefined,
  ): ContextEventSource[] {
    const deliveredCodeIds = new Set((deliveredCodeItems ?? []).map((i) => i.chunkId));
    const deliveredCodeByChunkId = new Map((deliveredCodeItems ?? []).map((i) => [i.chunkId, i]));
    const rows: ContextEventSource[] = [];

    for (const candidate of candidateCodeItems) {
      const delivered = deliveredCodeByChunkId.get(candidate.chunkId);
      rows.push({
        sourceType: "code",
        sourceId: candidate.chunkId,
        repositoryId: candidate.repositoryId,
        fileId: candidate.fileId,
        relativePath: candidate.relativePath,
        relation: null,
        depth: null,
        included: deliveredCodeIds.has(candidate.chunkId),
        rank: delivered?.rank ?? null,
        tokenCount: delivered ? this.safeEstimate(delivered.content) : null,
      });
    }

    const deliveredDepBySeedRelation = new Map((deliveredDependencyItems ?? []).map((i) => [`${i.seedFileId}:${i.relation}`, i]));
    for (const [seedFileId, items] of candidateDependencyItemsBySeed) {
      for (const candidateGroup of items) {
        const delivered = deliveredDepBySeedRelation.get(`${seedFileId}:${candidateGroup.relation}`);
        for (const fact of candidateGroup.facts) {
          rows.push({
            sourceType: "dependency",
            sourceId: `${seedFileId}:${fact.fileId}:${candidateGroup.relation}`,
            repositoryId: candidateGroup.repositoryId,
            fileId: fact.fileId,
            relativePath: fact.relativePath,
            relation: candidateGroup.relation,
            depth: fact.depth,
            included: delivered !== undefined,
            rank: delivered?.rank ?? null,
            tokenCount: delivered ? this.safeEstimate(delivered.content) : null,
          });
        }
      }
    }
    return rows;
  }

  /**
   * P2-006: one row per candidate this delivery represents.
   *
   * `tokenCount` is measured over the content ACTUALLY DELIVERED, using the same
   * estimator core/token used to enforce the budget -- so a compressed item
   * reports its compressed size. For a memory-only delivery (no coding
   * capability wired, or nothing relevant found), the included rows' tokenCount
   * sum equals ContextPack.tokenCount exactly, by construction. Since 3.4, that
   * is no longer universally true: a mixed memory+code+dependency delivery folds
   * code/dependency tokens into the SAME ContextPack.tokenCount (Token-Budget
   * Integration -- one combined budget, one combined tokenCount), so for a mixed
   * delivery the sum here is only the MEMORY PORTION of that total, a subset of
   * it, never the whole. Code/dependency items' token costs are recorded
   * separately, one row per candidate, in context_event_sources (see
   * buildContextEventSources), not here.
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
      if (this.learning) candidates = await this.learning.decorate(candidates);
    } catch (error) {
      throw this.wrapUnexpected(error, "search failed");
    }
    return rank({ candidates, task: request.text, learning: this.learningRankingConfig() });
  }

  /**
   * Builds rank()'s own activation gate straight off the one LearningSignalService instance's
   * config -- not a second copy of LearningConfig threaded separately through this class. Absent
   * (no LearningSignalService wired) returns undefined, which rank() already treats as disabled.
   */
  private learningRankingConfig(): { enabled: boolean; maxBoost: number } | undefined {
    if (!this.learning) return undefined;
    return { enabled: this.learning.config.enabled, maxBoost: this.learning.config.maxBoost };
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
