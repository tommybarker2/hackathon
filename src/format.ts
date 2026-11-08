import type { RepoSymbol } from "../shared/types";

export const LANG_COLORS: Record<string, string> = {
  ts: "#9ec5f2",
  tsx: "#8fd6c0",
  js: "#ffd95e",
  jsx: "#f5b98a",
  py: "#a9cdf5",
  go: "#8fe0cd",
  java: "#f0a79a",
  rb: "#f0a5b3",
  rs: "#e2b79a",
  hs: "#cbb6ec",
  css: "#c9b8ef",
  html: "#f5ad98",
  json: "#c4c4c4",
  md: "#b9c0c7",
  sql: "#b3dfa5",
  yaml: "#dcc0ec",
  other: "#c4c4c4",
};

export const LANG_LABELS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  jsx: "JSX",
  py: "Python",
  go: "Go",
  java: "Java",
  rb: "Ruby",
  rs: "Rust",
  hs: "Haskell",
  css: "CSS",
  html: "HTML",
  json: "JSON",
  md: "Markdown",
  sql: "SQL",
  yaml: "YAML",
  other: "Other",
};

export function langLabel(lang: string): string {
  return LANG_LABELS[lang] ?? lang.toUpperCase();
}

export function fmt(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function shortPath(filePath: string, max = 34): string {
  if (filePath.length <= max) return filePath;
  const parts = filePath.split("/");
  let out = parts[parts.length - 1] ?? filePath;
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}/${out}`;
    if (next.length > max) break;
    out = next;
  }
  return `…/${out}`;
}

export function symbolTooltip(
  symbol: RepoSymbol,
  counts: { callers?: number; callees?: number } = {},
): string {
  const signature = `${symbol.name}${symbol.params ? `(${symbol.params})` : ""}`;
  const kind = symbol.kind === "component" ? "component" : symbol.kind;
  const location = `${kind}${symbol.parent ? ` in ${symbol.parent}` : ""} at ${symbol.file}:${symbol.line}`;
  const usage = [
    `${symbol.loc} line${symbol.loc === 1 ? "" : "s"}`,
    symbol.exported ? "exported" : "internal",
    ...(counts.callers !== undefined
      ? [`${counts.callers} caller${counts.callers === 1 ? "" : "s"}`]
      : []),
    ...(counts.callees !== undefined
      ? [`${counts.callees} callee${counts.callees === 1 ? "" : "s"}`]
      : []),
  ].join(" · ");
  const description = symbol.doc?.trim();
  return description
    ? `${signature} — ${description}\n${location} · ${usage}`
    : `${signature} — ${location} · ${usage}`;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
