import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope } from "@brain/contracts";
import { FakeMemoryRepository, FakeEventStore } from "@brain/test-fixtures";
import { MemoryService } from "./service.js";

test("MemoryService delegates create/get/update/archive/query to the injected repository", async () => {
  const service = new MemoryService(new FakeMemoryRepository(new FakeEventStore()));

  const created = await service.create({ type: "fact", content: "hello", scope: globalScope() });
  assert.equal((await service.get(created.id, globalScope()))?.content, "hello");

  const updated = await service.update({ id: created.id, content: "updated" }, globalScope());
  assert.equal(updated.content, "updated");

  const archived = await service.archive(created.id, globalScope());
  assert.equal(archived.status, "archived");

  const results = await service.query({ scope: globalScope() });
  assert.equal(results.items.length, 1);
});
