import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export interface DiscoveredFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Recursive, ignore-filtered file discovery. Every candidate's real path is
 * resolved and checked for containment inside the resolved root before it is
 * returned -- a symlink (file or directory) escaping the repository root is never
 * discovered, never read (invariant "never read outside repository root"). Stat-only:
 * no file content is read here, so binary detection/hashing/chunking never happens
 * for a file that turns out to be ignored or path-unsafe.
 */
export async function discoverFiles(
  rootPath: string,
  isIgnored: (relativePath: string) => boolean,
): Promise<DiscoveredFile[]> {
  const realRoot = await realpath(rootPath);
  const entries = await readdir(rootPath, { recursive: true, withFileTypes: true });
  const results: DiscoveredFile[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) continue;

    const absolutePath = join(entry.parentPath, entry.name);
    const relativePath = toPosix(relative(rootPath, absolutePath));
    if (isIgnored(relativePath)) continue;

    let real: string;
    try {
      real = await realpath(absolutePath);
    } catch {
      continue; // broken symlink, or a race with deletion -- not indexable
    }

    const realRelative = relative(realRoot, real);
    if (isAbsolute(realRelative) || realRelative === ".." || realRelative.startsWith(`..${sep}`)) {
      continue; // resolves outside the repository root -- symlink escape, never read
    }

    const info = await stat(real);
    if (!info.isFile()) continue; // e.g. a symlink to a directory

    results.push({ relativePath, absolutePath, sizeBytes: info.size });
  }

  return results;
}
