import path from "node:path";
import type { CallEdge } from "../../shared/types";
import type { ParsedFile, ParsedSymbol } from "./parse";

const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".pyi", ".json", ".css", ".go", ".rs", ".java", ".rb", ".hs", ".lhs", ".hsc"];

function packageName(spec: string): string {
  const clean = spec.replace(/^node:/, "");
  const parts = clean.split("/");
  if (clean.startsWith("@") && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

function resolveSpecifier(
  spec: string,
  fromPath: string,
  paths: Set<string>,
  lang: string,
): string | null {
  let clean = spec.split("?")[0];
  if (!clean) return null;

  if (lang === "hs") {
    const suffix = clean.replace(/\./g, "/");
    for (const candidate of paths) {
      const withoutExt = candidate.replace(/\.(hs|lhs|hsc)$/i, "");
      if (withoutExt === suffix || withoutExt.endsWith("/" + suffix)) return candidate;
    }
    return null;
  }

  let base: string;
  if (clean.startsWith(".")) {
    if (lang === "py" && /^\.+[A-Za-z_]/.test(clean)) {
      const dots = (clean.match(/^\.+/) ?? ["."])[0].length;
      const rest = clean.slice(dots).replace(/\./g, "/");
      let dir = path.posix.dirname(fromPath);
      for (let i = 1; i < dots; i++) dir = path.posix.dirname(dir);
      base = path.posix.normalize(path.posix.join(dir, rest || "."));
    } else {
      base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), clean));
    }
  } else if (lang === "py") {
    // Absolute module imports: match the tail of a file path.
    const suffix = clean.replace(/\./g, "/");
    for (const candidate of paths) {
      const withoutExt = candidate.replace(/\.pyi?$/, "").replace(/\/__init__$/, "");
      if (withoutExt === suffix || withoutExt.endsWith("/" + suffix)) return candidate;
    }
    return null;
  } else {
    return null;
  }

  const candidates: string[] = [base];
  for (const ext of EXTS) candidates.push(base + ext);
  for (const ext of EXTS) candidates.push(path.posix.join(base, "index" + ext));
  candidates.push(path.posix.join(base, "__init__.py"));

  const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
  if (stripped !== base) {
    for (const ext of [".ts", ".tsx", ".d.ts", ""]) candidates.push(stripped + ext);
  }

  for (const candidate of candidates) {
    if (paths.has(candidate)) return candidate;
  }
  return null;
}

export function resolveImports(files: ParsedFile[]): void {
  const paths = new Set(files.map((f) => f.path));
  for (const file of files) {
    const local = new Set<string>();
    const external = new Set<string>();
    for (const spec of file.rawImports) {
      const resolved = resolveSpecifier(spec, file.path, paths, file.lang);
      if (resolved && resolved !== file.path) {
        local.add(resolved);
      } else if (!spec.startsWith(".") && file.lang !== "py") {
        external.add(packageName(spec));
      } else if (file.lang === "py" && !spec.startsWith(".")) {
        external.add(packageName(spec.split(".")[0]));
      }
    }
    file.imports = [...local];
    file.external = [...external];
  }
}

function findCallLine(symbol: ParsedSymbol, call: string): number {
  const lines = symbol.body.split("\n");
  const re = new RegExp(`(^|[^\\w$.])${call.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return symbol.line + i;
  }
  return symbol.line;
}

/**
 * Links each symbol's identifier calls to the most plausible definition.
 * Deterministic by design: same-file wins, then imported files, then exports.
 */
export function buildCallEdges(files: ParsedFile[]): CallEdge[] {
  const byName = new Map<string, ParsedSymbol[]>();
  for (const file of files) {
    for (const symbol of file.symbols) {
      const bucket = byName.get(symbol.name) ?? [];
      bucket.push(symbol);
      byName.set(symbol.name, bucket);
    }
  }

  const importsByFile = new Map(files.map((f) => [f.path, new Set(f.imports)]));
  const edges: CallEdge[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const imports = importsByFile.get(file.path) ?? new Set<string>();
    for (const symbol of file.symbols) {
      for (const call of symbol.calls) {
        const candidates = (byName.get(call) ?? []).filter((c) => c.id !== symbol.id);
        if (!candidates.length) continue;
        const target =
          candidates.find((c) => c.file === symbol.file) ??
          candidates.find((c) => imports.has(c.file)) ??
          candidates.find((c) => c.exported) ??
          candidates[0];
        if (!target) continue;
        const key = `${symbol.id}->${target.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: symbol.id, to: target.id, line: findCallLine(symbol, call) });
      }
    }
  }
  return edges;
}

export function findCycles(files: ParsedFile[]): string[][] {
  const adjacency = new Map(files.map((f) => [f.path, f.imports]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  function strongConnect(node: string): void {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) ?? []) {
      if (!adjacency.has(next)) continue;
      if (!index.has(next)) {
        strongConnect(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }

    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member !== undefined) {
          onStack.delete(member);
          component.push(member);
        }
      } while (member !== undefined && member !== node);
      if (component.length > 1) cycles.push(component);
    }
  }

  for (const file of files) {
    if (!index.has(file.path)) strongConnect(file.path);
  }
  return cycles;
}
