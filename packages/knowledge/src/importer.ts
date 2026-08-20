import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { globalScope } from "@brain/contracts";
import type { MemoryService } from "@brain/memory";
import { AeosSeedPatternSchema, memoryTypeForCategory, confidenceForStatus, composeContent } from "./aeos-seed-schema.js";

export interface ImportFailure {
  file: string;
  error: string;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  failed: ImportFailure[];
}

async function findYamlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => join(e.parentPath, e.name));
}

/**
 * Imports AEOS's YAML seed corpus as Brain knowledge, going through MemoryService
 * exclusively (D2 unification -- never bypasses it, never touches storage or SQL
 * directly, per PHASE_1_SPEC.md's packages/knowledge dependency rules).
 *
 * Idempotency: each pattern's AEOS `id` becomes a stable `seed-id:<id>` tag,
 * queried before every write. Same content on re-import -> no-op (skipped). Changed
 * content -> upsert (update in place, same memory id, full history preserved via
 * the audit trail). Never seen before -> create. Never duplicates.
 *
 * Transaction granularity: per-file, not per-batch. One malformed file is reported
 * in `failed` and does not block the other 97 -- deliberate, so a single bad file
 * can't take down an otherwise-good import run.
 */
export class KnowledgeImporter {
  constructor(private readonly memory: MemoryService) {}

  async importSeed(seedDir: string): Promise<ImportResult> {
    const files = await findYamlFiles(seedDir);
    const result: ImportResult = { imported: 0, updated: 0, skipped: 0, failed: [] };

    for (const filePath of files) {
      try {
        await this.importOne(filePath, result);
      } catch (error) {
        result.failed.push({
          file: relative(seedDir, filePath),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private async importOne(filePath: string, result: ImportResult): Promise<void> {
    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = parseYaml(raw);
    // .strict() -- rejects the file loudly if it uses field names the schema
    // doesn't recognize, rather than silently dropping them (AUDIT_AEOS.md 8).
    const pattern = AeosSeedPatternSchema.parse(parsed);

    const seedIdTag = `seed-id:${pattern.id}`;
    const content = composeContent(pattern);
    const tags = [...pattern.tags, seedIdTag];
    const scope = globalScope();

    const existing = await this.memory.query({ scope, tags: [seedIdTag], limit: 1 });
    const current = existing.items[0];

    if (!current) {
      await this.memory.create({
        type: memoryTypeForCategory(pattern.category),
        content,
        domain: pattern.domain,
        scope,
        source: { origin: "import", sourceRef: `aeos-seed:${pattern.id}` },
        confidence: confidenceForStatus(pattern.status),
        tags,
      });
      result.imported++;
    } else if (current.content === content) {
      result.skipped++;
    } else {
      await this.memory.update({ id: current.id, content, confidence: confidenceForStatus(pattern.status), tags }, scope);
      result.updated++;
    }
  }
}
