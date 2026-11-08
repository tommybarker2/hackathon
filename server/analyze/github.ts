import type { CommitInfo } from "../../shared/types";
import { detectLang, SourceFile } from "./walk";

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

export interface GithubLoad {
  files: SourceFile[];
  label: string;
  branch: string;
  url: string;
  commits: CommitInfo[];
  contributors: { name: string; commits: number }[];
  description?: string;
  stars?: number;
  truncated: boolean;
}

const IGNORED =
  /(^|\/)(node_modules|\.git|dist|build|out|\.next|vendor|__pycache__|\.venv|target|coverage)\//;

const BINARY =
  /\.(png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|mp4|mov|zip|gz|pdf|wasm|so|dll|dylib|jar|class|pyc|lockb|lock|db|sqlite)$/i;

function headers(): Record<string, string> {
  const base: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "code-archaeologist",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

async function gh<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 404) {
      throw new Error("Repository not found (or private). Try a public repository URL.");
    }
    if (res.status === 403) {
      throw new Error(
        "GitHub API rate limit reached. Add a GITHUB_TOKEN environment variable, or analyze a local copy.",
      );
    }
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

export function parseGithubUrl(input: string): { owner: string; repo: string } {
  const trimmed = input.trim().replace(/\.git$/, "");
  const match = trimmed.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/i);
  if (match) return { owner: match[1], repo: match[2] };
  const short = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return { owner: short[1], repo: short[2] };
  throw new Error("Expected a GitHub URL like https://github.com/owner/repo");
}

const MAX_REMOTE_FILES = 350;
const MAX_REMOTE_BYTES = 250_000;

export async function loadGithub(input: string): Promise<GithubLoad> {
  const { owner, repo } = parseGithubUrl(input);
  const info = await gh<{
    full_name: string;
    default_branch: string;
    description?: string;
    stargazers_count?: number;
  }>(`https://api.github.com/repos/${owner}/${repo}`);

  const branch = info.default_branch || "main";
  const [tree, commitList] = await Promise.all([
    gh<{ tree: TreeEntry[]; truncated: boolean }>(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    ),
    gh<
      {
        sha: string;
        commit: { message: string; author: { name: string; date: string } };
      }[]
    >(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=30&sha=${encodeURIComponent(branch)}`)
      .catch(() => []),
  ]);

  const candidates = (tree.tree ?? [])
    .filter(
      (entry) =>
        entry.type === "blob" &&
        !IGNORED.test(entry.path) &&
        !BINARY.test(entry.path) &&
        detectLang(entry.path) !== "other" &&
        (entry.size ?? 0) <= MAX_REMOTE_BYTES,
    )
    .slice(0, MAX_REMOTE_FILES);

  const files: SourceFile[] = [];
  const concurrency = 6;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const entry = candidates[cursor++];
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(
        branch,
      )}/${entry.path.split("/").map(encodeURIComponent).join("/")}`;
      const res = await fetch(rawUrl, { headers: { "User-Agent": "code-archaeologist" } });
      if (!res.ok) continue;
      const content = await res.text();
      if (content.includes("\u0000")) continue;
      files.push({
        path: entry.path,
        content,
        lang: detectLang(entry.path),
        size: content.length,
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  files.sort((a, b) => a.path.localeCompare(b.path));

  const commits: CommitInfo[] = (commitList ?? []).map((c) => ({
    hash: c.sha.slice(0, 7),
    author: c.commit.author?.name ?? "unknown",
    date: (c.commit.author?.date ?? "").slice(0, 10),
    subject: (c.commit.message ?? "").split("\n")[0],
    files: 0,
  }));

  const contributors = new Map<string, number>();
  for (const c of commits) contributors.set(c.author, (contributors.get(c.author) ?? 0) + 1);

  return {
    files,
    label: info.full_name,
    branch,
    url: `https://github.com/${info.full_name}`,
    commits,
    contributors: [...contributors.entries()]
      .map(([name, count]) => ({ name, commits: count }))
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 8),
    description: info.description,
    stars: info.stargazers_count,
    truncated: Boolean(tree.truncated) || candidates.length >= MAX_REMOTE_FILES,
  };
}
