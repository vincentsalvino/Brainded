import { extname } from "node:path";

// git's own heuristic: a NUL byte anywhere in a leading sample means binary. 8000
// bytes matches git's own core.bigFileThreshold-independent sniff size.
const SNIFF_BYTES = 8000;

export function isBinaryContent(buffer: Buffer): boolean {
  const sample = buffer.length > SNIFF_BYTES ? buffer.subarray(0, SNIFF_BYTES) : buffer;
  return sample.includes(0);
}

// Deterministic extension map -- no LLM classification (invariant 7). Unmapped
// extensions are `null`, not an error: an unrecognized but textual file is still
// useful to index (PATH RULES section, "unknown textual extensions should not
// necessarily be rejected").
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".sh": "shell",
  ".bash": "shell",
  ".ps1": "powershell",
  ".sql": "sql",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
};

export function detectLanguage(relativePath: string): string | null {
  const ext = extname(relativePath).toLowerCase();
  if (!ext) return null;
  return LANGUAGE_BY_EXTENSION[ext] ?? null;
}
