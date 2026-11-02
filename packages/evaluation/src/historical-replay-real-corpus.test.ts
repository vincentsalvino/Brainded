import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Candidate } from "@brain/contracts";
import { openDatabase, SqliteRetrievalStore, LocalEmbeddingProvider } from "@brain/storage";
import { mergeCandidates } from "@brain/retrieval";
import { rank, DEFAULT_RANKING_WEIGHTS } from "@brain/ranking";
import {
  replayTimeline,
  classifyContextChange,
  type TimelineEntry,
  type ContextMembershipSeed,
} from "./historical-replay.js";

/**
 * Phase 4.3B real run (docs/archive/phase-4/PHASE_4_3_REPORT.md "HISTORICAL REPLAY RESULTS"). Operates on a COPY
 * of the real data/brain.db -- copied via `copyFileSync`, never opened with a migrating
 * connection at the original path (PHASE_4_FINDINGS.md's live-database-safety discipline,
 * unchanged since Phase 4.1/4.2). Uses the REAL LocalEmbeddingProvider (a real local model) to
 * re-derive semantic scores from the copy's own preserved memory_vectors/FTS5 index -- this is
 * why the test lives in the test:integration tier, not the default one.
 */

function rankFn(candidates: Candidate[], learningEnabled: boolean): string[] {
  return rank({
    candidates,
    learning: learningEnabled ? { enabled: true, maxBoost: 0.15 } : undefined,
  }).map((r) => r.memoryId);
}

test("integration: Phase 4.3B time-causal replay over the real historical corpus", async () => {
  const REAL_DB = join(process.cwd(), "..", "..", "data", "brain.db");
  const dir = mkdtempSync(join(tmpdir(), "brain-phase43-replay-"));
  const copyPath = join(dir, "brain.db");
  copyFileSync(REAL_DB, copyPath);

  const db = openDatabase(copyPath); // migrating this COPY only, never the original
  const embeddings = new LocalEmbeddingProvider();
  const retrievalStore = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable);

  try {
    const retrievalRows = db.raw
      .prepare(`SELECT id, scope_kind, scope_id, query_text, candidate_ids FROM retrieval_events`)
      .all() as { id: string; scope_kind: string; scope_id: string | null; query_text: string; candidate_ids: string }[];
    const retrievalById = new Map(retrievalRows.map((r) => [r.id, r]));

    const contextRows = db.raw
      .prepare(`SELECT id, timestamp, retrieval_event_id, task_id FROM context_events ORDER BY rowid ASC`)
      .all() as { id: string; timestamp: string; retrieval_event_id: string; task_id: string | null }[];

    const membershipRows = db.raw
      .prepare(`SELECT context_event_id, memory_id, included, rank FROM context_event_memories`)
      .all() as { context_event_id: string; memory_id: string; included: number; rank: number | null }[];
    const membership: ContextMembershipSeed[] = membershipRows.map((r) => ({
      contextEventId: r.context_event_id, memoryId: r.memory_id, included: r.included === 1, rank: r.rank,
    }));
    const candidateIdsByContext = new Map<string, Set<string>>();
    for (const row of membershipRows) {
      const set = candidateIdsByContext.get(row.context_event_id) ?? new Set<string>();
      set.add(row.memory_id);
      candidateIdsByContext.set(row.context_event_id, set);
    }

    const feedbackRows = db.raw
      .prepare(`SELECT id, timestamp, memory_id, task_id, context_id, useful, reason, notes FROM feedback_events ORDER BY rowid ASC`)
      .all() as { id: string; timestamp: string; memory_id: string; task_id: string | null; context_id: string | null; useful: number | null; reason: string | null; notes: string | null }[];
    const outcomeRows = db.raw
      .prepare(`SELECT id, timestamp, task_id, session_id, context_id, outcome, notes FROM outcome_events ORDER BY rowid ASC`)
      .all() as { id: string; timestamp: string; task_id: string; session_id: string | null; context_id: string | null; outcome: string; notes: string | null }[];

    const entries: TimelineEntry[] = [
      ...contextRows.map((r, i): TimelineEntry => ({ kind: "context", timestamp: r.timestamp, rowid: i, contextEventId: r.id })),
      ...feedbackRows.map((r, i): TimelineEntry => ({
        kind: "feedback", timestamp: r.timestamp, rowid: i,
        event: { id: r.id, timestamp: r.timestamp, memoryId: r.memory_id, taskId: r.task_id, contextId: r.context_id, useful: r.useful === null ? null : r.useful === 1, reason: r.reason as never, notes: r.notes },
      })),
      ...outcomeRows.map((r, i): TimelineEntry => ({
        kind: "outcome", timestamp: r.timestamp, rowid: i,
        event: { id: r.id, timestamp: r.timestamp, taskId: r.task_id, sessionId: r.session_id, contextId: r.context_id, outcome: r.outcome as never, signal: null, notes: r.notes },
      })),
    ];

    async function reconstructCandidates(contextEventId: string): Promise<Candidate[] | null> {
      const contextRow = contextRows.find((c) => c.id === contextEventId);
      const retrieval = contextRow ? retrievalById.get(contextRow.retrieval_event_id) : undefined;
      const knownIds = candidateIdsByContext.get(contextEventId) ?? new Set<string>();
      if (!retrieval || knownIds.size === 0) return null;

      const query = {
        text: retrieval.query_text,
        scope: { kind: retrieval.scope_kind as "global" | "project" | "session", id: retrieval.scope_id },
        limit: Math.max(knownIds.size * 2, 50),
      };
      let lexical: Candidate[], semantic: Candidate[];
      try {
        [lexical, semantic] = await Promise.all([retrievalStore.lexicalSearch(query), retrievalStore.semanticSearch(query)]);
      } catch {
        return null; // degrade to non-replayable, never fabricate signals
      }
      const merged = mergeCandidates(lexical, semantic).filter((c) => knownIds.has(c.memoryId));
      // Every historically-known candidate must be present with real signals, or this context
      // is not exactly replayable -- never fabricate a missing one's score.
      if (merged.length !== knownIds.size) return null;
      return merged;
    }

    const results = await replayTimeline(entries, membership, reconstructCandidates, rankFn);

    // --- Metrics -------------------------------------------------------------
    // Classification compares enabledOrder's TOP-N (N = the historical delivered count) against
    // recordedOrder -- an apples-to-apples slice, not the full reconstructed candidate pool
    // (which includes historically-omitted candidates and is a different length whenever any
    // existed, per this file's own 2026-09-06 fix).
    const replayable = results.filter((r) => r.exactlyReplayable && r.enabledOrder && r.candidates);
    const notReplayable = results.filter((r) => !r.exactlyReplayable);

    const classified = replayable.map((r) => ({
      result: r,
      classification: classifyContextChange({
        recordedOrder: r.recordedOrder,
        enabledFullOrder: r.enabledOrder as string[],
        candidates: r.candidates as NonNullable<typeof r.candidates>,
        performanceAtTime: r.performanceAtTime,
        weights: DEFAULT_RANKING_WEIGHTS,
      }),
    }));

    const unchanged = classified.filter((c) => c.classification.kind === "unchanged");
    const rankOnly = classified.filter((c) => c.classification.kind === "rank-only");
    const contextImpacting = classified.filter((c) => c.classification.kind === "context-impacting");
    const harmful = classified.filter((c) => c.classification.safety === "harmful");

    const coldStartReorders = classified.filter((c) => {
      const allCold = [...c.result.performanceAtTime.values()].every((p) => p.usefulCount === 0 && p.notUsefulCount === 0);
      const noEvidenceAtAll = c.result.performanceAtTime.size === 0 || allCold;
      return noEvidenceAtAll && c.classification.kind !== "unchanged";
    });

    const report = {
      totalContexts: results.length,
      exactlyReplayable: replayable.length,
      notReplayable: notReplayable.length,
      notReplayableReasons: tally(notReplayable.map((r) => r.notReplayableReason ?? "unknown")),
      contextsUnchanged: unchanged.length,
      contextsChanged: rankOnly.length + contextImpacting.length,
      rankOnlyChanges: rankOnly.length,
      contextImpactingChanges: contextImpacting.length,
      harmfulReorderCount: harmful.length,
      coldStartReorderCount: coldStartReorders.length,
      changedContextSample: [...rankOnly, ...contextImpacting].slice(0, 15).map(({ result: r, classification: c }) => ({
        contextEventId: r.contextEventId,
        kind: c.kind,
        safety: c.safety,
        reason: c.reason,
        recordedOrder: r.recordedOrder,
        enabledOrder: r.enabledOrder,
        performance: [...r.performanceAtTime.entries()].map(([id, p]) => ({
          memoryId: id, usefulCount: p.usefulCount, notUsefulCount: p.notUsefulCount, evidenceMass: p.usefulCount + p.notUsefulCount,
        })),
      })),
      harmfulSample: harmful.map(({ result: r, classification: c }) => ({ contextEventId: r.contextEventId, kind: c.kind, reason: c.reason })),
    };

    writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
    console.log("PHASE_4_3B_REPLAY_REPORT_START");
    console.log(JSON.stringify(report, null, 2));
    console.log("PHASE_4_3B_REPLAY_REPORT_END");

    // Safety invariants -- these MUST hold regardless of what the corpus contains.
    assert.equal(report.coldStartReorderCount, 0, "cold-start reorder count must be exactly zero");
    assert.equal(report.totalContexts, contextRows.length);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
