import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CommitInfo } from "../../shared/types";

const run = promisify(execFile);

export interface FileHistory {
  commits: number;
  churn: number;
  lastCommit?: string;
  lastDate?: string;
  lastAuthor?: string;
}

export interface GitInfo {
  available: boolean;
  commits: CommitInfo[];
  contributors: { name: string; commits: number }[];
  files: Map<string, FileHistory>;
}

const empty = (): GitInfo => ({
  available: false,
  commits: [],
  contributors: [],
  files: new Map(),
});

/**
 * Reads commit history. This is what makes the "archaeology" honest:
 * every historical claim in the UI comes from real `git log` output.
 */
export async function readGit(root: string, ref?: string): Promise<GitInfo> {
  const gitDir = path.join(root, ".git");
  const exists = await fs
    .stat(gitDir)
    .then((s) => s.isDirectory() || s.isFile())
    .catch(() => false);
  if (!exists) return empty();

  try {
    const { stdout } = await run(
      "git",
      [
        "-C",
        root,
        "log",
        "--numstat",
        "--date=short",
        "--pretty=format:@@@%H|%h|%an|%ad|%s",
        "-n",
        "400",
        ...(ref ? [ref] : []),
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );

    const commits: CommitInfo[] = [];
    const contributors = new Map<string, number>();
    const files = new Map<string, FileHistory>();
    let current: CommitInfo | null = null;

    for (const line of stdout.split("\n")) {
      if (line.startsWith("@@@")) {
        const [sha, hash, author, date, ...rest] = line.slice(3).split("|");
        current = {
          hash: hash ?? "",
          sha,
          author: author ?? "unknown",
          date: date ?? "",
          subject: rest.join("|").trim(),
          files: 0,
        };
        commits.push(current);
        contributors.set(current.author, (contributors.get(current.author) ?? 0) + 1);
        continue;
      }
      if (!line.trim() || !current) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const added = Number(parts[0]) || 0;
      const deleted = Number(parts[1]) || 0;
      const filePath = parts.slice(2).join("\t");
      if (!filePath) continue;
      current.files++;
      const entry = files.get(filePath) ?? { commits: 0, churn: 0 };
      entry.commits++;
      entry.churn += added + deleted;
      if (!entry.lastDate) {
        entry.lastDate = current.date;
        entry.lastCommit = current.subject;
        entry.lastAuthor = current.author;
      }
      files.set(filePath, entry);
    }

    return {
      available: true,
      commits,
      contributors: [...contributors.entries()]
        .map(([name, count]) => ({ name, commits: count }))
        .sort((a, b) => b.commits - a.commits)
        .slice(0, 8),
      files,
    };
  } catch {
    return empty();
  }
}
