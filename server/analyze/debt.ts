import type { CallEdge, Issue, RepoSymbol } from "../../shared/types";
import type { ParsedFile } from "./parse";
import { isTestFile } from "./walk";

const ENTRY_NAMES = new Set([
  "main",
  "handler",
  "default",
  "getServerSideProps",
  "getStaticProps",
  "loader",
  "action",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

export function findIssues(args: {
  files: ParsedFile[];
  symbols: RepoSymbol[];
  callEdges: CallEdge[];
  entryPoints: string[];
  cycles: string[][];
}): Issue[] {
  const issues: Issue[] = [];
  const incoming = new Map<string, number>();
  for (const edge of args.callEdges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const entrySet = new Set(args.entryPoints);

  for (const file of args.files) {
    if (file.loc > 450) {
      issues.push({
        id: `god:${file.path}`,
        kind: "god-file",
        severity: file.loc > 800 ? "high" : "medium",
        title: `${file.loc} lines in one file`,
        detail: `${file.path} is doing a lot. Large files are harder to review, test and navigate, and they usually hide several responsibilities.`,
        file: file.path,
        line: 1,
        evidence: [`${file.symbols.length} symbols`, `${file.imports.length} local imports`],
      });
    }

    if (file.imports.length >= 14 && !isTestFile(file.path)) {
      issues.push({
        id: `coupling:${file.path}`,
        kind: "high-coupling",
        severity: "low",
        title: `High fan-out (${file.imports.length} local imports)`,
        detail: `${file.path} depends on ${file.imports.length} other modules. Changes here ripple widely, and it is a likely coordination hotspot.`,
        file: file.path,
        line: 1,
        evidence: file.imports.slice(0, 8),
      });
    }
  }

  for (const file of args.files) {
    for (const symbol of file.symbols) {
      if (symbol.loc >= 70) {
        issues.push({
          id: `long:${symbol.id}`,
          kind: "long-function",
          severity: symbol.loc >= 120 ? "high" : "medium",
          title: `${symbol.name} is ${symbol.loc} lines long`,
          detail: `Long functions are hard to test in isolation and usually mix several concerns. Consider extracting the distinct steps of ${symbol.name}.`,
          file: file.path,
          line: symbol.line,
          evidence: [`${symbol.loc} lines`, `${symbol.calls.length} distinct calls`],
        });
      }
    }
  }

  for (const cycle of args.cycles.slice(0, 4)) {
    issues.push({
      id: `cycle:${cycle.join(">")}`,
      kind: "circular-dependency",
      severity: "high",
      title: `Import cycle across ${cycle.length} files`,
      detail: `These files import each other in a cycle, which makes load order, bundling and testing fragile: ${cycle.join(" → ")} → ${cycle[0]}.`,
      file: cycle[0],
      line: 1,
      evidence: cycle,
    });
  }

  let unused = 0;
  for (const symbol of args.symbols) {
    if (unused >= 6) break;
    if (symbol.kind === "class" || symbol.kind === "handler") continue;
    if (symbol.exported || ENTRY_NAMES.has(symbol.name)) continue;
    if ((incoming.get(symbol.id) ?? 0) > 0) continue;
    if (!isLocalCandidate(symbol, args.files, entrySet)) continue;
    unused++;
    issues.push({
      id: `unused:${symbol.id}`,
      kind: "unused-symbol",
      severity: "low",
      title: `${symbol.name} is never called`,
      detail: `${symbol.name} is defined in ${symbol.file} but nothing in the analysed repository calls it. It may be dead code, or it may be called dynamically.`,
      file: symbol.file,
      line: symbol.line,
      evidence: [`declared at ${symbol.file}:${symbol.line}`],
    });
  }

  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  return issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

function isLocalCandidate(symbol: RepoSymbol, files: ParsedFile[], entrySet: Set<string>): boolean {
  if (entrySet.has(symbol.file)) return false;
  if (isTestFile(symbol.file)) return false;
  const file = files.find((f) => f.path === symbol.file);
  return Boolean(file);
}
