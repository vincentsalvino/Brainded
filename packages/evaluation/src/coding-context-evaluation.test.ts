import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope } from "@brain/contracts";
import { FakeMemoryRepository, FakeRetrievalStore, FakeEventStore, FakeCodeSearchStore, FakeCodebaseRepository, FakeCodeDependencyStore, FakeEmbeddingProvider, buildMemoryRecord } from "@brain/test-fixtures";
import { MemoryService } from "@brain/memory";
import { RetrievalService, CodeRetrievalService } from "@brain/retrieval";
import { EventService } from "@brain/learning";
import { DependencyGraphService } from "@brain/codebase";
import { Gateway } from "@brain/gateway";
import { mean } from "./metrics.js";
import { CODING_CONTEXT_MEMORIES, CODING_CONTEXT_FILES, CODING_CONTEXT_TASKS } from "./coding-context.data.js";

test("[evaluation] Phase 3.4 coding-context: memory/code/dependency recall + token utilization on the frozen fixture", async () => {
  const eventStore = new FakeEventStore();
  const memoryRepo = new FakeMemoryRepository(eventStore);
  const memoryIdByLabel = new Map<string, string>();
  for (const m of CODING_CONTEXT_MEMORIES) {
    const record = await memoryRepo.create({ type: "constraint", content: m.content, scope: globalScope() });
    memoryIdByLabel.set(m.id, record.id);
  }
  const retrievalStore = new FakeRetrievalStore(await memoryRepo.query({ scope: globalScope(), limit: 100 }).then((r) => r.items));

  const codebaseRepo = new FakeCodebaseRepository();
  const { id: repositoryId } = await codebaseRepo.createRepository(globalScope(), "/repo");
  const fileIdByPath = new Map<string, string>();
  for (const [path, content] of Object.entries(CODING_CONTEXT_FILES)) {
    const fileId = `file-${path}`;
    fileIdByPath.set(path, fileId);
    await codebaseRepo.replaceFile(
      { id: fileId, repositoryId, scope: globalScope(), relativePath: path, language: "typescript", sizeBytes: content.length, contentHash: `hash-${path}`, indexedAt: new Date().toISOString() },
      [],
    );
  }
  const codeStore = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  for (const [path, content] of Object.entries(CODING_CONTEXT_FILES)) {
    codeStore.index({ id: `chunk-${path}`, fileId: fileIdByPath.get(path) as string, repositoryId, scope: globalScope(), relativePath: path, chunkIndex: 0, startLine: 1, endLine: content.split("\n").length, content, contentHash: `hash-${path}` });
  }
  const depStore = new FakeCodeDependencyStore();
  // A imports B relationships derived directly from CODING_CONTEXT_FILES' own import lines.
  await depStore.replaceOutgoingEdges(repositoryId, fileIdByPath.get("src/routes/users.ts") as string, "h", [
    { id: "e1", repositoryId, scope: globalScope(), sourceFileId: fileIdByPath.get("src/routes/users.ts") as string, targetFileId: fileIdByPath.get("src/services/user-service.ts") as string, specifier: "../services/user-service", kind: "static_import", resolution: "internal", sourceLine: 1, createdAt: new Date().toISOString() },
  ]);
  await depStore.replaceOutgoingEdges(repositoryId, fileIdByPath.get("src/services/user-service.ts") as string, "h", [
    { id: "e2", repositoryId, scope: globalScope(), sourceFileId: fileIdByPath.get("src/services/user-service.ts") as string, targetFileId: fileIdByPath.get("src/repositories/user-repository.ts") as string, specifier: "../repositories/user-repository", kind: "static_import", resolution: "internal", sourceLine: 1, createdAt: new Date().toISOString() },
  ]);

  const gateway = new Gateway(
    new MemoryService(memoryRepo),
    new RetrievalService(retrievalStore),
    new EventService(eventStore),
    { vectorSearchAvailable: true },
    undefined,
    new CodeRetrievalService(codeStore),
    new DependencyGraphService(codebaseRepo, depStore),
  );

  const memoryRecalls: number[] = [];
  const codeRecalls: number[] = [];
  let tasksWithUsefulDependency = 0;
  let tasksWhereDependencyDelivered = 0;
  const utilizationRatios: number[] = [];

  for (const t of CODING_CONTEXT_TASKS) {
    const pack = await gateway.getContext({ task: t.task, scope: globalScope(), budget: { maxTokens: 1500 } });

    const deliveredMemoryIds = new Set(pack.items.map((i) => i.memoryId));
    const requiredMemoryIds = t.requiredMemoryIds.map((label) => memoryIdByLabel.get(label));
    if (requiredMemoryIds.length > 0) {
      memoryRecalls.push(requiredMemoryIds.filter((id) => id && deliveredMemoryIds.has(id)).length / requiredMemoryIds.length);
    }

    const deliveredPaths = new Set((pack.codeItems ?? []).map((c) => c.relativePath));
    if (t.requiredFilePaths.length > 0) {
      codeRecalls.push(t.requiredFilePaths.filter((p) => deliveredPaths.has(p)).length / t.requiredFilePaths.length);
    }

    if (t.usefulDependencyRelations.length > 0) {
      tasksWithUsefulDependency++;
      const delivered = (pack.dependencyItems ?? []).some((d) =>
        t.usefulDependencyRelations.some((r) => d.seedRelativePath === r.seedPath && d.relation === r.relation),
      );
      if (delivered) tasksWhereDependencyDelivered++;
    }

    utilizationRatios.push(pack.tokenCount / 1500);
    assert.ok(pack.tokenCount <= 1500, `task ${t.id} exceeded budget: ${pack.tokenCount}`);
  }

  console.log("\n[Phase 3.4 coding-context evaluation]");
  console.log(`  memory recall (mean over ${memoryRecalls.length} tasks with required memories): ${mean(memoryRecalls).toFixed(3)}`);
  console.log(`  code recall (mean over ${codeRecalls.length} tasks with required files):        ${mean(codeRecalls).toFixed(3)}`);
  console.log(`  dependency delivered when useful:  ${tasksWhereDependencyDelivered}/${tasksWithUsefulDependency}`);
  console.log(`  mean token utilization:            ${mean(utilizationRatios).toFixed(3)}`);

  assert.ok(memoryRecalls.length > 0 && codeRecalls.length > 0, "fixture machinery sanity: both memory and code recall were actually measured");
});
