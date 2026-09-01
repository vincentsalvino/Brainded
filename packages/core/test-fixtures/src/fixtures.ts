import { randomUUID } from "node:crypto";
import {
  MEMORY_TYPES,
  type MemoryRecord,
  type MemoryType,
  type CodeSearchResult,
  globalScope,
  projectScope,
  sessionScope,
  type ScopeRef,
} from "@brain/contracts";

/** A valid MemoryRecord with sensible defaults, overridable per field. */
export function buildMemoryRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    type: "fact",
    content: "example memory content",
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

/** One record per memory type, all at global scope. Covers all 12 types. */
export function oneOfEachMemoryType(): MemoryRecord[] {
  return MEMORY_TYPES.map((type: MemoryType) =>
    buildMemoryRecord({ type, content: `example ${type} content` }),
  );
}

/**
 * Near-identical content placed in different scopes, specifically shaped as an
 * adversarial fixture for scope-isolation tests (P1-006): a naive implementation
 * that filters in application code rather than at the query layer is exactly the
 * kind of bug this is meant to catch (AUDIT_AEOS_BRAIN.md 11).
 */
export function crossScopeFixture(): { global: MemoryRecord; projectA: MemoryRecord; projectB: MemoryRecord; sessionX: MemoryRecord } {
  const content = "the deployment key rotates every 90 days";
  return {
    global: buildMemoryRecord({ content, scope: globalScope() }),
    projectA: buildMemoryRecord({ content, scope: projectScope("project-a") }),
    projectB: buildMemoryRecord({ content, scope: projectScope("project-b") }),
    sessionX: buildMemoryRecord({ content, scope: sessionScope("session-x") }),
  };
}

export const SAMPLE_SCOPES: ScopeRef[] = [globalScope(), projectScope("project-a"), sessionScope("session-x")];

let codeChunkCounter = 0;

/** A valid CodeSearchResult with sensible defaults, overridable per field. */
export function buildCodeSearchResult(overrides: Partial<CodeSearchResult> = {}): CodeSearchResult {
  const n = codeChunkCounter++;
  return {
    chunkId: `chunk-${n}`,
    fileId: `file-${n}`,
    repositoryId: "repo-1",
    scope: globalScope(),
    relativePath: `src/example-${n}.ts`,
    language: "typescript",
    startLine: 1,
    endLine: 5,
    content: "export function example() {}",
    signals: { lexicalScore: 0.5 },
    ...overrides,
  };
}
