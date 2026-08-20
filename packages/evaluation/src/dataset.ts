import { readFileSync } from "node:fs";
import { EvalExampleSchema, type EvalExample } from "./types.js";

/**
 * JSONL, one example per line. Parsed with `.strict()` -- a dataset with an
 * unrecognized field, an unknown label key, or a dangling redundancy edge fails
 * loudly rather than being silently accepted with part of it dropped. That silent
 * -drop failure is exactly what AUDIT_AEOS.md 8 documented in the predecessor's
 * seed importer, and an evaluation dataset is the last place to repeat it: a
 * quietly-truncated dataset produces confident, wrong metrics.
 */
export function parseDataset(contents: string, sourceName = "<inline>"): EvalExample[] {
  const examples: EvalExample[] = [];
  const lines = contents.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line.length === 0 || line.startsWith("//")) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(`${sourceName}:${i + 1}: not valid JSON -- ${(error as Error).message}`);
    }

    const parsed = EvalExampleSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${sourceName}:${i + 1}: invalid example -- ${parsed.error.message}`);
    }
    examples.push(parsed.data);
  }

  const ids = new Set(examples.map((e) => e.id));
  if (ids.size !== examples.length) {
    throw new Error(`${sourceName}: duplicate example id`);
  }
  return examples;
}

export function loadDataset(path: string): EvalExample[] {
  return parseDataset(readFileSync(path, "utf-8"), path);
}
