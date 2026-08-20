import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globalScope } from "@brain/contracts";
import { FakeMemoryRepository, FakeEventStore } from "@brain/test-fixtures";
import { MemoryService } from "@brain/memory";
import { KnowledgeImporter } from "./importer.js";

// All fixtures use FakeMemoryRepository/FakeEventStore -- no SQLite, no embedding
// provider at all (MemoryService/FakeMemoryRepository never call one), so this
// whole suite is network-free by construction, not by convention (Step 7.10).

const VALID_PATTERN_A = `
id: test-pattern-a
category: pattern
domain: backend
name: Test Pattern A
description: A description of test pattern A.
tags: [testing, fixture]
usage_rules:
  - Rule one.
  - Rule two.
status: recommended
`;

const VALID_PATTERN_B = `
id: test-pattern-b
category: anti-pattern
domain: architecture
name: Test Anti-Pattern B
description: A description of test anti-pattern B.
status: experimental
`;

// Mirrors the real bug: unrecognized field names (rules/avoid/priority instead of
// usage_rules/avoid_when) instead of a schema PatternSchema recognizes.
const MALFORMED_PATTERN = `
id: test-malformed
category: principle
domain: design
name: Malformed Pattern
description: This uses the wrong field names.
priority: critical
rules:
  - Some rule.
avoid:
  - Something to avoid.
`;

async function withTempSeedDir(files: Record<string, string>, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "brain-seed-test-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content, "utf-8");
    }
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function setup() {
  const repo = new FakeMemoryRepository(new FakeEventStore());
  const memory = new MemoryService(repo);
  const importer = new KnowledgeImporter(memory);
  return { memory, importer };
}

test("imports multiple valid records", async () => {
  const { memory, importer } = setup();
  await withTempSeedDir({ "a.yaml": VALID_PATTERN_A, "b.yaml": VALID_PATTERN_B }, async (dir) => {
    const result = await importer.importSeed(dir);
    assert.equal(result.imported, 2);
    assert.equal(result.failed.length, 0);

    const all = await memory.query({ scope: globalScope() });
    assert.equal(all.items.length, 2);
  });
});

test("invalid record handling: a malformed file fails loudly, without blocking the valid ones (per-file transaction granularity)", async () => {
  const { memory, importer } = setup();
  await withTempSeedDir(
    { "a.yaml": VALID_PATTERN_A, "malformed.yaml": MALFORMED_PATTERN, "b.yaml": VALID_PATTERN_B },
    async (dir) => {
      const result = await importer.importSeed(dir);
      assert.equal(result.imported, 2, "the two valid files still import");
      assert.equal(result.failed.length, 1);
      assert.match(result.failed[0]?.file ?? "", /malformed\.yaml/);
      assert.ok(result.failed[0]?.error.length, "a clear, non-empty error message is reported, not a silent drop");

      const all = await memory.query({ scope: globalScope() });
      assert.equal(all.items.length, 2, "the malformed file's content was not silently imported with fields dropped");
    },
  );
});

test("deterministic/idempotent: re-importing an unchanged corpus is a no-op, not a duplicate", async () => {
  const { memory, importer } = setup();
  await withTempSeedDir({ "a.yaml": VALID_PATTERN_A }, async (dir) => {
    const first = await importer.importSeed(dir);
    assert.equal(first.imported, 1);

    const second = await importer.importSeed(dir);
    assert.equal(second.imported, 0);
    assert.equal(second.skipped, 1);
    assert.equal(second.updated, 0);

    const all = await memory.query({ scope: globalScope() });
    assert.equal(all.items.length, 1, "no duplicate was created");
  });
});

test("duplicate/update behavior: re-importing after the source file changed updates the existing record in place", async () => {
  const { memory, importer } = setup();
  await withTempSeedDir({ "a.yaml": VALID_PATTERN_A }, async (dir) => {
    const first = await importer.importSeed(dir);
    const before = await memory.query({ scope: globalScope() });
    const originalId = before.items[0]?.id;

    await writeFile(join(dir, "a.yaml"), VALID_PATTERN_A.replace("A description of test pattern A.", "An updated description."), "utf-8");
    const second = await importer.importSeed(dir);

    assert.equal(second.updated, 1);
    assert.equal(second.imported, 0);
    const after = await memory.query({ scope: globalScope() });
    assert.equal(after.items.length, 1, "still exactly one record, not a duplicate");
    assert.equal(after.items[0]?.id, originalId, "same memory id -- updated in place, not replaced");
    assert.match(after.items[0]?.content ?? "", /An updated description/);
    void first;
  });
});

test("provenance: an imported record's source clearly identifies it as imported, from a specific pattern", async () => {
  const { memory, importer } = setup();
  await withTempSeedDir({ "a.yaml": VALID_PATTERN_A }, async (dir) => {
    await importer.importSeed(dir);
    const all = await memory.query({ scope: globalScope() });
    const record = all.items[0];
    assert.equal(record?.source.origin, "import");
    assert.equal(record?.source.sourceRef, "aeos-seed:test-pattern-a", "not vague 'seed' -- traceable to the exact source pattern");
  });
});

test("scope: imported knowledge is global (reusable, not project-specific)", async () => {
  const { memory, importer } = setup();
  await withTempSeedDir({ "a.yaml": VALID_PATTERN_A }, async (dir) => {
    await importer.importSeed(dir);
    const all = await memory.query({ scope: globalScope() });
    assert.equal(all.items[0]?.scope.kind, "global");
  });
});

test("category mapping: anti-pattern maps to rule, general pattern maps to pattern", async () => {
  const { memory, importer } = setup();
  await withTempSeedDir({ "a.yaml": VALID_PATTERN_A, "b.yaml": VALID_PATTERN_B }, async (dir) => {
    await importer.importSeed(dir);
    const all = await memory.query({ scope: globalScope() });
    const a = all.items.find((i) => i.source.sourceRef === "aeos-seed:test-pattern-a");
    const b = all.items.find((i) => i.source.sourceRef === "aeos-seed:test-pattern-b");
    assert.equal(a?.type, "pattern");
    assert.equal(b?.type, "rule");
  });
});

test("retrieval visibility: an imported record is findable via a normal MemoryService query, same as any other memory", async () => {
  const { memory, importer } = setup();
  await withTempSeedDir({ "a.yaml": VALID_PATTERN_A }, async (dir) => {
    await importer.importSeed(dir);
    const results = await memory.query({ scope: globalScope(), type: "pattern" });
    assert.equal(results.items.length, 1);
  });
});
