import type { Analysis } from "../shared/types";
import type { ParsedFile } from "./analyze/parse";

export interface RepoRecord {
  analysis: Analysis;
  contents: Map<string, string>;
  parsed: Map<string, ParsedFile>;
}

const repos = new Map<string, RepoRecord>();
const MAX_REPOS = 6;

export function putRepo(record: RepoRecord): RepoRecord {
  repos.set(record.analysis.id, record);
  while (repos.size > MAX_REPOS) {
    const oldest = repos.keys().next().value;
    if (!oldest) break;
    repos.delete(oldest);
  }
  return record;
}

export function getRepo(id: string | undefined): RepoRecord | undefined {
  if (!id) return undefined;
  return repos.get(id);
}

export function requireRepo(id: string | undefined): RepoRecord {
  const repo = getRepo(id);
  if (!repo) {
    throw new Error("Repository analysis not found. Analyze a repository first (the server keeps the last few analyses in memory).");
  }
  return repo;
}
