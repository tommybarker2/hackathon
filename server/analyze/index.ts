import path from "node:path";
import type {
  Analysis,
  RepoFile,
  RepoSymbol,
  LanguageStat,
} from "../../shared/types";
import { buildCallEdges, findCycles, resolveImports } from "./graph";
import { findIssues } from "./debt";
import { readGit } from "./git";
import { loadGithub } from "./github";
import { parseFile, type ParsedFile } from "./parse";
import { summarizeFile, purposeFor } from "./summarize";
import { isCodeLang, isTestFile, toPosix, walkLocal, type SourceFile } from "./walk";

export interface AnalyzeOptions {
  source: "local" | "github";
  path?: string;
  url?: string;
}

export interface AnalyzeResult {
  analysis: Analysis;
  contents: Map<string, string>;
  parsed: Map<string, ParsedFile>;
}

const ENTRY_BASENAMES = /^(index|main|app|server|bootstrap|manage|cli|__main__|mod)\.(ts|tsx|js|jsx|mjs|py|go|rs|rb)$/i;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function presenceFor(lang: string): RepoFile["presence"] {
  if (isCodeLang(lang as never)) return "code";
  if (lang === "sql") return "code";
  if (lang === "md") return "doc";
  if (lang === "css" || lang === "html") return "style";
  return "config";
}

export async function analyzeRepository(options: AnalyzeOptions): Promise<AnalyzeResult> {
  let files: SourceFile[] = [];
  let label: string;
  let gitAvailable = false;
  let commits: Analysis["commits"] = [];
  let contributors: Analysis["stats"]["contributors"] = [];
  let truncated = false;
  let branch: string | undefined;
  let url: string | undefined;
  let rootPath: string | undefined;
  let fileHistory = new Map<string, { commits: number; churn: number; lastCommit?: string; lastDate?: string; lastAuthor?: string }>();
  const notes: string[] = [];

  if (options.source === "github") {
    if (!options.url) throw new Error("A GitHub repository URL is required.");
    const remote = await loadGithub(options.url);
    files = remote.files;
    label = remote.label;
    branch = remote.branch;
    url = remote.url;
    gitAvailable = remote.commits.length > 0;
    commits = remote.commits;
    contributors = remote.contributors;
    truncated = remote.truncated;
    notes.push("Remote analysis reads the default branch through the GitHub API (capped at 350 source files).");
    notes.push("Per-file commit counts and churn are only available when analyzing a local clone.");
  } else {
    rootPath = path.resolve(options.path || process.cwd());
    const walked = await walkLocal(rootPath);
    files = walked.files;
    truncated = walked.truncated;
    label = path.basename(rootPath) || toPosix(rootPath);
    const git = await readGit(rootPath);
    gitAvailable = git.available;
    commits = git.commits.slice(0, 20);
    contributors = git.contributors;
    fileHistory = git.files;
    notes.push(`Analyzed from disk at ${rootPath}.`);
    if (!git.available) {
      notes.push("No git history found — historical archaeology is unavailable for this source.");
    }
  }

  if (!files.length) {
    throw new Error("No analyzable source files were found.");
  }

  const parsedFiles = files.map((f) => parseFile(f.path, f.content, f.lang));
  resolveImports(parsedFiles);
  const parsedByPath = new Map(parsedFiles.map((f) => [f.path, f]));

  const symbols: RepoSymbol[] = [];
  for (const file of parsedFiles) {
    for (const symbol of file.symbols) {
      symbols.push({
        id: symbol.id,
        name: symbol.name,
        kind: symbol.kind,
        file: symbol.file,
        line: symbol.line,
        endLine: symbol.endLine,
        exported: symbol.exported,
        parent: symbol.parent,
        params: symbol.params,
        loc: symbol.loc,
      });
    }
  }

  const callEdges = buildCallEdges(parsedFiles);
  const cycles = findCycles(parsedFiles);

  const fileEdges = parsedFiles.flatMap((file) =>
    file.imports.map((to) => ({ from: file.path, to, kind: "import" as const })),
  );

  // Entry points: files that expose routes or are never imported but look like starters.
  const inDegree = new Map<string, number>();
  for (const edge of fileEdges) inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  const scored = parsedFiles
    .filter((f) => !isTestFile(f.path) && presenceFor(f.lang) === "code")
    .map((f) => {
      let score = 0;
      if (f.endpoints.length) score += 4 + Math.min(f.endpoints.length, 4);
      if (ENTRY_BASENAMES.test(path.posix.basename(f.path))) score += 5;
      if ((inDegree.get(f.path) ?? 0) === 0) score += 2;
      if (/^src\/(index|main|app)\./i.test(f.path)) score += 2;
      // Examples and fixtures register routers too; they are not the app's entry point.
      if (/(^|\/)(examples?|samples?|docs?|benchmarks?|fixtures?)\//i.test(f.path)) score -= 6;
      return { path: f.path, score };
    })
    .sort((a, b) => b.score - a.score);
  const entryPoints = scored.filter((s) => s.score > 0).slice(0, 6).map((s) => s.path);

  const issues = findIssues({ files: parsedFiles, symbols, callEdges, entryPoints, cycles });

  const languageMap = new Map<string, { loc: number; files: number }>();
  for (const file of parsedFiles) {
    const entry = languageMap.get(file.lang) ?? { loc: 0, files: 0 };
    entry.loc += file.loc;
    entry.files += 1;
    languageMap.set(file.lang, entry);
  }
  const languages: LanguageStat[] = [...languageMap.entries()]
    .map(([lang, stat]) => ({ lang, ...stat }))
    .sort((a, b) => b.loc - a.loc);

  const repoFiles: RepoFile[] = parsedFiles.map((file) => {
    const history = fileHistory.get(file.path);
    return {
      path: file.path,
      lang: file.lang,
      loc: file.loc,
      imports: file.imports,
      external: file.external,
      symbols: file.symbols.map((s) => s.id),
      endpoints: file.endpoints,
      dbOps: file.dbOps,
      exported: file.exportNames,
      commits: history?.commits ?? 0,
      churn: history?.churn ?? 0,
      lastCommit: history?.lastCommit,
      lastDate: history?.lastDate,
      lastAuthor: history?.lastAuthor,
      presence: presenceFor(file.lang),
      summary: summarizeFile({
        path: file.path,
        doc: file.doc,
        loc: file.loc,
        symbols: file.symbols,
        endpoints: file.endpoints,
        dbOps: file.dbOps,
        imports: file.imports.length,
        external: file.external.length,
      }),
    };
  });

  const contents = new Map(files.map((f) => [f.path, f.content]));
  const loc = parsedFiles.reduce((sum, f) => sum + f.loc, 0);
  const endpoints = parsedFiles.reduce((sum, f) => sum + f.endpoints.length, 0);
  const dbOps = parsedFiles.reduce((sum, f) => sum + f.dbOps.length, 0);

  notes.push("Symbols, routes and call edges are inferred statically (regex + brace matching), not compiled or traced at runtime.");
  notes.push("Execution flows show statically inferred call paths, not verified runtime traces.");
  if (truncated) notes.push("The repository was larger than the analysis cap, so some files were skipped.");

  const analysis: Analysis = {
    id: `${options.source}-${slug(label)}-${Date.now().toString(36)}`,
    source: {
      kind: options.source,
      label,
      path: rootPath,
      url,
      branch,
    },
    analyzedAt: new Date().toISOString(),
    stats: {
      files: parsedFiles.length,
      loc,
      symbols: symbols.length,
      endpoints,
      dbOps,
      imports: fileEdges.length,
      languages,
      commits: commits.length,
      contributors,
      gitAvailable,
      truncated,
    },
    files: repoFiles,
    symbols,
    fileEdges,
    callEdges,
    issues,
    commits,
    entryPoints,
    notes,
  };

  return { analysis, contents, parsed: parsedByPath };
}

export function describeArea(filePath: string): string {
  return purposeFor(filePath);
}
