import fs from "node:fs/promises";
import path from "node:path";
import type { Lang } from "../../shared/types";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "site",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "target",
  ".idea",
  ".vscode",
  "coverage",
  ".cache",
  ".turbo",
  ".parcel-cache",
  ".pytest_cache",
  ".mypy_cache",
  "Pods",
  "obj",
  ".gradle",
  ".mvn",
  "artifacts",
]);

const IGNORED_FILE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$|\.min\.(js|css)$|\.map$|\.(png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|eot|mp4|mov|webm|zip|tar|gz|pdf|wasm|so|dll|dylib|exe|class|jar|pyc|lockb|db|sqlite)$/i;

export const MAX_FILE_BYTES = 400_000;

export interface SourceFile {
  path: string;
  content: string;
  lang: Lang;
  size: number;
}

export function detectLang(filePath: string): Lang {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "ts";
    case ".tsx":
      return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "js";
    case ".jsx":
      return "jsx";
    case ".py":
      return "py";
    case ".go":
      return "go";
    case ".java":
    case ".kt":
      return "java";
    case ".rb":
      return "rb";
    case ".rs":
      return "rs";
    case ".hs":
    case ".lhs":
    case ".hsc":
      return "hs";
    case ".css":
    case ".scss":
    case ".less":
      return "css";
    case ".html":
    case ".htm":
      return "html";
    case ".json":
      return "json";
    case ".md":
    case ".mdx":
      return "md";
    case ".sql":
      return "sql";
    case ".yml":
    case ".yaml":
      return "yaml";
    default:
      return "other";
  }
}

export function isCodeLang(lang: Lang): boolean {
  return ["ts", "tsx", "js", "jsx", "py", "go", "java", "rb", "rs", "hs"].includes(lang);
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export { isTestFile } from "../../shared/files";

/** Shared filters for filesystem walks and git-tree snapshots. */
export function isIgnoredRepoPath(filePath: string): boolean {
  const parts = filePath.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].startsWith(".") || IGNORED_DIRS.has(parts[i])) return true;
  }
  return IGNORED_FILE.test(filePath);
}

/**
 * Reads a repository from disk, with guard rails: ignored directories,
 * binary files, oversized files and a hard file cap.
 */
export async function walkLocal(
  root: string,
  limit = 900,
): Promise<{ files: SourceFile[]; truncated: boolean }> {
  const resolved = path.resolve(root);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Not a readable directory: ${resolved}`);
  }

  const files: SourceFile[] = [];
  let truncated = false;

  async function visit(dir: string): Promise<void> {
    if (files.length >= limit) {
      truncated = true;
      return;
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        if (IGNORED_DIRS.has(entry.name)) continue;
        await visit(abs);
        continue;
      }
      if (!entry.isFile() || IGNORED_FILE.test(abs)) continue;
      const rel = toPosix(path.relative(resolved, abs));
      const lang = detectLang(rel);
      if (lang === "other") continue;
      const info = await fs.stat(abs).catch(() => null);
      if (!info || info.size > MAX_FILE_BYTES) continue;
      const content = await fs.readFile(abs, "utf8").catch(() => null);
      if (content === null || content.includes("\u0000")) continue;
      files.push({ path: rel, content, lang, size: info.size });
    }
  }

  await visit(resolved);
  return { files, truncated };
}
