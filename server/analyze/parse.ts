import type { DbOp, Endpoint, Lang, SymbolKind } from "../../shared/types";

export interface ParsedSymbol {
  id: string;
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  endLine: number;
  exported: boolean;
  parent?: string;
  params: string;
  body: string;
  doc?: string;
  calls: string[];
  loc: number;
}

export interface ParsedFile {
  path: string;
  lang: Lang;
  loc: number;
  content: string;
  rawImports: string[];
  imports: string[];
  external: string[];
  exportNames: string[];
  symbols: ParsedSymbol[];
  endpoints: Endpoint[];
  dbOps: DbOp[];
  doc: string;
}

const JS_RESERVED = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "typeof",
  "instanceof",
  "new",
  "await",
  "async",
  "yield",
  "do",
  "else",
  "try",
  "finally",
  "throw",
  "delete",
  "void",
  "in",
  "of",
  "const",
  "let",
  "var",
  "class",
  "super",
  "this",
  "import",
  "export",
  "default",
  "case",
  "break",
  "continue",
  "with",
  "debugger",
  "require",
  "console",
  "setTimeout",
  "setInterval",
  "parseInt",
  "parseFloat",
  "String",
  "Number",
  "Boolean",
  "Array",
  "Object",
  "JSON",
  "Promise",
  "Map",
  "Set",
  "Symbol",
  "Error",
  "Date",
  "Math",
  "Response",
  "Request",
  "Fetch",
  "fetch",
  "constructor",
]);

const GRAPH_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "all",
  "route",
  "use",
]);

/** Blanks comments (and optionally string literals) while preserving line numbers. */
export function maskSource(src: string, opts: { strings?: boolean; hash?: boolean } = {}): string {
  const maskStrings = opts.strings ?? false;
  const hashComments = opts.hash ?? false;
  const out = src.split("");
  let state: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";

  const blank = (i: number) => {
    if (i < out.length && out[i] !== "\n") out[i] = " ";
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    switch (state) {
      case "code":
        if (c === "/" && n === "/") {
          blank(i);
          blank(i + 1);
          i++;
          state = "line";
        } else if (c === "/" && n === "*") {
          blank(i);
          blank(i + 1);
          i++;
          state = "block";
        } else if (hashComments && c === "#") {
          blank(i);
          state = "line";
        } else if (c === '"') {
          if (maskStrings) blank(i);
          state = "dq";
        } else if (c === "'") {
          if (maskStrings) blank(i);
          state = "sq";
        } else if (c === "`") {
          if (maskStrings) blank(i);
          state = "tpl";
        }
        break;
      case "line":
        blank(i);
        if (c === "\n") {
          out[i] = "\n";
          state = "code";
        }
        break;
      case "block":
        blank(i);
        if (c === "*" && n === "/") {
          blank(i + 1);
          i++;
          state = "code";
        }
        break;
      case "dq":
        if (maskStrings) blank(i);
        if (c === "\\") {
          if (maskStrings) blank(i + 1);
          i++;
        } else if (c === '"') {
          if (maskStrings) blank(i);
          state = "code";
        } else if (c === "\n") {
          state = "code";
        }
        break;
      case "sq":
        if (maskStrings) blank(i);
        if (c === "\\") {
          if (maskStrings) blank(i + 1);
          i++;
        } else if (c === "'") {
          if (maskStrings) blank(i);
          state = "code";
        } else if (c === "\n") {
          state = "code";
        }
        break;
      case "tpl":
        if (maskStrings) blank(i);
        if (c === "\\") {
          if (maskStrings) blank(i + 1);
          i++;
        } else if (c === "`") {
          if (maskStrings) blank(i);
          state = "code";
        }
        break;
    }
  }
  return out.join("");
}

function indentOf(line: string): number {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].replace(/\t/g, "  ").length : 0;
}

function braceEnd(masked: string[], start: number): number {
  let depth = 0;
  let sawBrace = false;
  for (let i = start; i < masked.length; i++) {
    for (const ch of masked[i]) {
      if (ch === "{") {
        depth++;
        sawBrace = true;
      } else if (ch === "}") {
        depth--;
      }
    }
    if (sawBrace && depth <= 0) return i;
    if (!sawBrace && i - start >= 1) return start;
  }
  return Math.min(start + 40, masked.length - 1);
}

function indentEnd(lines: string[], start: number, baseIndent: number): number {
  let last = start;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (indentOf(line) <= baseIndent) break;
    last = i;
  }
  return last;
}

function extractCalls(body: string, selfName: string, lang: Lang): string[] {
  const masked = maskSource(body, { hash: lang === "py" || lang === "rb" });
  const calls = new Set<string>();
  const callRe = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(masked))) {
    const name = match[1];
    if (name === selfName) continue;
    if (JS_RESERVED.has(name)) continue;
    if (name.length < 2) continue;
    calls.add(name);
  }
  const jsxRe = /<\s*([A-Z][\w$]*)/g;
  while ((match = jsxRe.exec(masked))) {
    if (match[1] !== selfName) calls.add(match[1]);
  }
  return [...calls];
}

function extractJsImports(masked: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      if (m[1]) specs.add(m[1]);
    }
  }
  return [...specs];
}

function extractPyImports(masked: string): string[] {
  const specs = new Set<string>();
  const lines = masked.split("\n");
  for (const line of lines) {
    const from = line.match(/^\s*from\s+([.\w]+)\s+import\b/);
    if (from) {
      specs.add(from[1]);
      continue;
    }
    const plain = line.match(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/);
    if (plain) {
      for (const part of plain[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name) specs.add(name);
      }
    }
  }
  return [...specs];
}

function extractHsImports(masked: string): string[] {
  const specs = new Set<string>();
  const re =
    /^\s*import\s+(?:\{-#\s*SOURCE\s*#-\}\s*)?(?:safe\s+)?(?:qualified\s+)?(?:"[^"]+"\s+)?([A-Z][\w.]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    if (m[1]) specs.add(m[1]);
  }
  return [...specs];
}

function docComment(content: string, lang: Lang): string {
  const head = content.slice(0, 4000);
  if (lang === "hs") {
    const block = head.match(/^\s*\{-\s*\|?([\s\S]{0,400}?)-\}/);
    if (block) {
      return block[1]
        .split("\n")
        .map((l) => l.replace(/^\s*\|?\s?/, "").trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 320);
    }
    const collected: string[] = [];
    for (const line of head.split("\n")) {
      const m = line.match(/^\s*--\s*\|?\s*(.*)$/);
      if (m) collected.push(m[1].trim());
      else if (collected.length) break;
    }
    return collected.join(" ").slice(0, 320);
  }
  if (lang === "py") {
    const m = head.match(/^\s*(?:"""|''')([\s\S]{0,400}?)(?:"""|''')/);
    return m ? m[1].trim().slice(0, 320) : "";
  }
  const m = head.match(/^\s*\/\*\*?([\s\S]{0,500}?)\*\//);
  if (m) {
    return m[1]
      .split("\n")
      .map((l) => l.replace(/^\s*\*?\s?/, "").trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 320);
  }
  const line = head.match(/^\s*\/\/\s*(.{4,240})/);
  return line ? line[1].trim() : "";
}

function nextRoutePath(filePath: string): string | null {
  const appRoute = filePath.match(/(?:^|\/)app\/(.+)\/route\.(?:ts|tsx|js|jsx)$/);
  if (appRoute) {
    const pathPart = appRoute[1]
      .split("/")
      .filter((seg) => !seg.startsWith("("))
      .map((seg) => (seg.startsWith("[") ? seg.replace(/^\[+|\]+$/g, ":") : seg))
      .join("/");
    return "/" + pathPart;
  }
  const pagesRoute = filePath.match(/(?:^|\/)pages\/(api\/.+|.+?)\.(?:ts|tsx|js|jsx)$/);
  if (pagesRoute) {
    return "/" + pagesRoute[1].replace(/\/index$/, "").replace(/\[([^\]]+)\]/g, ":$1");
  }
  return null;
}

/** Masks Haskell line and nested block comments without changing line numbers. */
function maskHsComments(src: string): string {
  let out = "";
  let i = 0;
  let block = 0;
  let line = false;
  let string = false;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (line) {
      out += c === "\n" ? "\n" : " ";
      if (c === "\n") line = false;
      i++;
      continue;
    }
    if (block > 0) {
      if (c === "{" && n === "-") {
        block++;
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "-" && n === "}") {
        block--;
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (string) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === '"') string = false;
      i++;
      continue;
    }
    if (c === '"') {
      string = true;
      out += c;
      i++;
      continue;
    }
    if (c === "-" && n === "-") {
      line = true;
      out += "  ";
      i += 2;
      continue;
    }
    if (c === "{" && n === "-") {
      block = 1;
      out += "  ";
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Haskell declarations are newline-delimited; keep indented continuations. */
function hsEnd(lines: string[], start: number, name?: string): number {
  let last = start;
  const head = name ? new RegExp(`^${escapeRe(name)}\\b`) : null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indented = /^[ \t]/.test(line);
    if (!indented && head && head.test(line)) {
      last = i;
      continue;
    }
    if (!indented && !/^[|),\]}]|^(where|deriving|in)\b/.test(line)) break;
    last = i;
  }
  return last + 1;
}

function symbolDoc(lines: string[], start: number, lang: Lang): string {
  if (lang === "py") {
    const body = lines.slice(start + 1, start + 12).join("\n");
    const triple = body.match(/^\s*(?:"""|''')([\s\S]*?)(?:"""|''')/);
    if (triple) return triple[1].replace(/\s+/g, " ").trim().slice(0, 240);
  }

  const collected: string[] = [];
  for (let i = start - 1; i >= Math.max(0, start - 14); i--) {
    const trimmed = lines[i]?.trim() ?? "";
    if (!trimmed) {
      if (collected.length) break;
      continue;
    }
    const lineComment = trimmed.match(/^(?:\/\/|#|--)\s?(.*)$/);
    if (lineComment) {
      collected.unshift(lineComment[1]);
      continue;
    }
    if (trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("*/")) {
      const cleaned = trimmed
        .replace(/^\/\*+/, "")
        .replace(/\*\/$/, "")
        .replace(/^\*+\s?/, "")
        .trim();
      if (cleaned) collected.unshift(cleaned);
      if (trimmed.startsWith("/*")) break;
      continue;
    }
    break;
  }

  return collected
    .filter((line) => !/^@\w+/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function parseFile(filePath: string, content: string, lang: Lang): ParsedFile {
  const lines = content.split("\n");
  const maskedContent =
    lang === "hs"
      ? maskHsComments(content)
      : maskSource(content, { hash: lang === "py" || lang === "rb" });
  const maskedLines = maskedContent.split("\n");
  const braceSafeLines = (
    lang === "hs"
      ? maskHsComments(content)
      : maskSource(content, { hash: lang === "py" || lang === "rb", strings: true })
  ).split("\n");

  const symbols: ParsedSymbol[] = [];
  const exportNames = new Set<string>();
  const seenIds = new Map<string, number>();

  const addSymbol = (input: Omit<ParsedSymbol, "id" | "calls" | "body" | "loc"> & { body?: string }) => {
    const idBase = `${filePath}::${input.name}`;
    const count = seenIds.get(idBase) ?? 0;
    seenIds.set(idBase, count + 1);
    const id = count === 0 ? idBase : `${idBase}#${count + 1}`;
    const start = Math.max(0, input.line - 1);
    const end = Math.max(start, input.endLine - 1);
    const body =
      input.body ?? lines.slice(start, Math.min(lines.length, end + 1)).join("\n").slice(0, 4000);
    const doc = symbolDoc(lines, start, lang);
    symbols.push({
      ...input,
      id,
      body,
      doc,
      calls: extractCalls(body, input.name, lang),
      loc: Math.max(1, input.endLine - input.line + 1),
    });
  };

  if (["ts", "tsx", "js", "jsx"].includes(lang)) {
    const fnRe =
      /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/;
    const arrowRe =
      /^\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>/;
    const classRe =
      /^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;

    for (let i = 0; i < maskedLines.length; i++) {
      const line = maskedLines[i];
      if (!line || line.trim().length === 0) continue;

      const fn = line.match(fnRe);
      if (fn) {
        const params = line.slice(line.indexOf("(", line.indexOf(fn[2]) + fn[2].length));
        const endLine = braceEnd(braceSafeLines, i) + 1;
        addSymbol({
          name: fn[2],
          kind: "function",
          file: filePath,
          line: i + 1,
          endLine,
          exported: Boolean(fn[1]) || exportNames.has(fn[2]),
          params: (params.match(/\(([^)]*)\)/) ?? [])[1]?.trim() ?? "",
        });
        if (fn[1]) exportNames.add(fn[2]);
        continue;
      }

      const arrow = line.match(arrowRe);
      if (arrow) {
        const name = arrow[2];
        const endLine = braceEnd(braceSafeLines, i) + 1;
        const kind: SymbolKind = /^[A-Z]/.test(name) ? "component" : "function";
        const params = (line.match(/\(([^)]*)\)\s*(?::[^=]+)?=>/) ?? [])[1]?.trim() ?? "";
        addSymbol({
          name,
          kind,
          file: filePath,
          line: i + 1,
          endLine,
          exported: Boolean(arrow[1]),
          params,
        });
        if (arrow[1]) exportNames.add(name);
        continue;
      }

      const cls = line.match(classRe);
      if (cls) {
        const name = cls[2];
        const endLine = braceEnd(braceSafeLines, i) + 1;
        addSymbol({
          name,
          kind: "class",
          file: filePath,
          line: i + 1,
          endLine,
          exported: Boolean(cls[1]),
          params: "",
        });
        if (cls[1]) exportNames.add(name);

        const methodRe =
          /^\s{2,}(?:(?:public|private|protected|static|async|get|set|readonly|override)\s+)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*[^{;]+)?\{/;
        for (let j = i + 1; j < Math.min(endLine - 1, maskedLines.length); j++) {
          const m = maskedLines[j].match(methodRe);
          if (!m) continue;
          if (["if", "for", "while", "switch", "catch"].includes(m[1])) continue;
          addSymbol({
            name: m[1],
            kind: "method",
            file: filePath,
            line: j + 1,
            endLine: braceEnd(braceSafeLines, j) + 1,
            exported: true,
            parent: name,
            params: m[2].trim(),
          });
        }
        continue;
      }
    }

    for (const line of maskedLines) {
      const named = line.match(/^\s*export\s*\{([^}]*)\}/);
      if (named) {
        for (const part of named[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/).pop();
          if (name) exportNames.add(name.trim());
        }
      }
      const def = line.match(/^\s*export\s+default\s+([A-Za-z_$][\w$]*)/);
      if (def) exportNames.add(def[1]);
      const cjs = line.match(/module\.exports\s*=\s*\{([^}]*)\}/);
      if (cjs) {
        for (const part of cjs[1].split(",")) {
          const name = part.trim().split(":")[0];
          if (name) exportNames.add(name.trim());
        }
      }
    }
  } else if (lang === "hs") {
    const header = content
      .slice(0, 8000)
      .match(/^\s*module\s+[A-Z][\w.]*\s*(?:\(([\s\S]*?)\))?\s*where/m);
    const listed = new Set<string>();
    if (header?.[1]) {
      for (const m of header[1].matchAll(/([a-z_][\w']*|[A-Z][\w']*)/g)) listed.add(m[1]);
    }
    const restricted = Boolean(header?.[1]);
    const exported = (name: string) => !restricted || listed.has(name);
    const reserved = new Set([
      "module",
      "import",
      "data",
      "newtype",
      "type",
      "class",
      "instance",
      "deriving",
      "where",
      "let",
      "in",
      "do",
      "case",
      "of",
      "if",
      "then",
      "else",
      "foreign",
      "default",
      "infix",
      "infixl",
      "infixr",
    ]);

    for (let i = 0; i < maskedLines.length; i++) {
      const line = maskedLines[i];
      if (!line || !line.trim() || /^\s/.test(line)) continue;

      const decl = line.match(
        /^(data|newtype|type|class)\s+(?:family\s+)?(?:\([^)]*\)\s*=>\s*)?([A-Z][\w']*)/,
      );
      if (decl) {
        addSymbol({
          name: decl[2],
          kind: "class",
          file: filePath,
          line: i + 1,
          endLine: hsEnd(lines, i, decl[2]),
          exported: exported(decl[2]),
          params: "",
        });
        continue;
      }

      const sig = line.match(/^([a-z_][\w']*)\s*::\s*(.*)$/);
      if (sig) {
        const name = sig[1];
        let definition = i;
        for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
          const next = lines[j];
          if (!next.trim()) continue;
          if (new RegExp(`^${escapeRe(name)}\\b`).test(next)) {
            definition = j;
            break;
          }
          if (!/^\s/.test(next)) break;
        }
        addSymbol({
          name,
          kind: "function",
          file: filePath,
          line: i + 1,
          endLine: hsEnd(lines, definition, name),
          exported: exported(name),
          params: sig[2].split("->")[0].replace(/\s+/g, " ").trim().slice(0, 120),
        });
        continue;
      }

      const def = line.match(/^([a-z_][\w']*)\b[^=]*=/);
      if (def && !reserved.has(def[1]) && !symbols.some((s) => s.name === def[1])) {
        addSymbol({
          name: def[1],
          kind: "function",
          file: filePath,
          line: i + 1,
          endLine: hsEnd(lines, i, def[1]),
          exported: exported(def[1]),
          params: "",
        });
      }
    }
  } else if (lang === "py") {
    for (let i = 0; i < maskedLines.length; i++) {
      const line = maskedLines[i];
      const cls = line.match(/^(\s*)class\s+(\w+)/);
      if (cls) {
        const baseIndent = indentOf(cls[1]);
        const endLine = indentEnd(lines, i, baseIndent) + 1;
        addSymbol({
          name: cls[2],
          kind: "class",
          file: filePath,
          line: i + 1,
          endLine,
          exported: !cls[2].startsWith("_"),
          params: "",
        });
        for (let j = i + 1; j < endLine; j++) {
          const m = maskedLines[j]?.match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
          if (!m) continue;
          addSymbol({
            name: m[2],
            kind: "method",
            file: filePath,
            line: j + 1,
            endLine: indentEnd(lines, j, indentOf(m[1])) + 1,
            exported: !m[2].startsWith("_"),
            parent: cls[2],
            params: m[3].trim(),
          });
        }
        continue;
      }
      const fn = line.match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
      if (fn) {
        addSymbol({
          name: fn[2],
          kind: "function",
          file: filePath,
          line: i + 1,
          endLine: indentEnd(lines, i, indentOf(fn[1])) + 1,
          exported: !fn[2].startsWith("_"),
          params: fn[3].trim(),
        });
      }
    }
  } else {
    for (let i = 0; i < maskedLines.length; i++) {
      const line = maskedLines[i];
      const patterns: { re: RegExp; kind: SymbolKind }[] = [
        { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, kind: "function" },
        { re: /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/, kind: "function" },
        { re: /^\s*def\s+([\w?!]+)/, kind: "function" },
        { re: /^\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\]]+\s+(\w+)\s*\(/, kind: "function" },
      ];
      for (const { re, kind } of patterns) {
        const m = line.match(re);
        if (!m) continue;
        addSymbol({
          name: m[1],
          kind,
          file: filePath,
          line: i + 1,
          endLine: braceEnd(braceSafeLines, i) + 1,
          exported: true,
          params: "",
        });
        break;
      }
    }
  }

  // ---------- imports ----------
  const rawImports = lang === "hs" ? extractHsImports(maskedContent) :
    lang === "py"
      ? extractPyImports(maskedContent)
      : ["ts", "tsx", "js", "jsx"].includes(lang)
        ? extractJsImports(maskedContent)
        : [];

  // ---------- endpoints ----------
  const endpoints: Endpoint[] = [];
  const endpointKeys = new Set<string>();

  const pushEndpoint = (endpoint: Endpoint) => {
    // Catch-all mounts are wiring, not API surface.
    if (endpoint.method === "ANY" && (endpoint.path === "/*" || endpoint.path === "/")) return;
    const key = `${endpoint.method} ${endpoint.path}@${endpoint.file}:${endpoint.line}`;
    if (endpointKeys.has(key)) return;
    endpointKeys.add(key);
    endpoints.push(endpoint);
  };

  const routeRe =
    /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|options|head|all|route|use)\s*\(\s*["'`]([^"'`]+)["'`]/g;

  for (let i = 0; i < maskedLines.length; i++) {
    const line = maskedLines[i];
    if (!line.includes("(")) continue;
    routeRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = routeRe.exec(line))) {
      const method = m[2].toLowerCase();
      const routePath = m[3];
      if (!routePath.startsWith("/")) continue;
      if (method === "use" && routePath.split("/").filter(Boolean).length < 1) continue;
      pushEndpoint({
        method: method === "route" || method === "use" ? "ANY" : method.toUpperCase(),
        path: routePath,
        file: filePath,
        line: i + 1,
        framework: graphFramework(line),
      });
    }

    const pyRoute =
      /^\s*@\s*([A-Za-z_][\w]*)\.(get|post|put|patch|delete|route|websocket)\s*\(\s*["']([^"']+)["']/.exec(
        line,
      );
    if (pyRoute) {
      const methods =
        pyRoute[2] === "route"
          ? [...line.matchAll(/["'](GET|POST|PUT|PATCH|DELETE)["']/gi)].map((x) => x[1].toUpperCase())
          : [pyRoute[2].toUpperCase()];
      for (const method of methods.length ? methods : ["ANY"]) {
        pushEndpoint({
          method,
          path: pyRoute[3],
          file: filePath,
          line: i + 1,
          framework: "fastapi/flask",
        });
      }
    }

    const goRoute = /(?:HandleFunc|\.(GET|POST|PUT|PATCH|DELETE))\s*\(\s*"([^"]+)"/.exec(line);
    if (goRoute) {
      pushEndpoint({
        method: (goRoute[1] ?? "ANY").toUpperCase(),
        path: goRoute[2],
        file: filePath,
        line: i + 1,
        framework: "go-http",
      });
    }
  }

  const nextPath = nextRoutePath(filePath);
  if (nextPath) {
    for (const line of maskedLines) {
      const m = line.match(/^\s*export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
      if (!m) continue;
      pushEndpoint({
        method: m[1],
        path: nextPath,
        file: filePath,
        line: 1,
        framework: "next.js",
      });
    }
  }

  // Synthesise a symbol for inline route handlers so flows can traverse them.
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  for (const endpoint of endpoints) {
    if (endpoint.framework === "next.js") continue;
    const nearby = symbols.some(
      (s) => Math.abs(s.line - endpoint.line) <= 2 || (s.line <= endpoint.line && s.endLine >= endpoint.line),
    );
    if (nearby) continue;
    const absLineStart = lineOffsets[endpoint.line - 1];
    if (absLineStart === undefined) continue;
    // The call's own opening paren (e.g. `app.post(`), not the handler's parameter list.
    const parenRel = maskedContent.slice(absLineStart).indexOf("(");
    if (parenRel < 0) continue;
    const openIdx = absLineStart + parenRel;
    let depth = 0;
    let closeIdx = -1;
    for (let k = openIdx; k < maskedContent.length; k++) {
      const ch = maskedContent[k];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          closeIdx = k;
          break;
        }
      }
    }
    if (closeIdx < 0) continue;
    const endLine = maskedContent.slice(0, closeIdx).split("\n").length;
    const name = `${endpoint.method} ${endpoint.path}`;
    const id = `${filePath}::route:${name}`;
    if (symbols.some((s) => s.id === id)) continue;
    const body = lines.slice(endpoint.line - 1, endLine).join("\n").slice(0, 4000);
    const handler: ParsedSymbol = {
      id,
      name,
      kind: "handler",
      file: filePath,
      line: endpoint.line,
      endLine,
      exported: true,
      params: "",
      body,
      calls: extractCalls(body, name, lang),
      loc: Math.max(1, endLine - endpoint.line + 1),
    };
    symbols.push(handler);
    endpoint.handler = id;
  }

  // ---------- database operations ----------
  const dbOps: DbOp[] = [];
  const dbKeys = new Set<string>();
  const sqlRe = /\b(SELECT\s+[^;]{0,100}?\sFROM\s+[\w."`]+|INSERT\s+INTO\s+[\w."`]+|UPDATE\s+[\w."`]+\s+SET\b|DELETE\s+FROM\s+[\w."`]+)/i;
  const dbCallRe =
    /\b(db|prisma|knex|pool|client|conn|connection|sql|database|repository|repo|store|model|collection|mongoose|sequelize|d1)\s*\.\s*(\w+)\s*\(/gi;
  const writeVerbs = /^(create|save|update|delete|insert|remove|upsert|write|drop|exec|query|put|set|batch)$/i;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.length > 400) continue;
    const sql = raw.match(sqlRe);
    if (sql) {
      const kind: DbOp["kind"] = /^(INSERT|UPDATE|DELETE)/i.test(sql[1]) ? "write" : "read";
      const key = `${i}:${kind}`;
      if (!dbKeys.has(key)) {
        dbKeys.add(key);
        dbOps.push({ kind, file: filePath, line: i + 1, snippet: raw.trim().slice(0, 200) });
      }
      continue;
    }
    dbCallRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = dbCallRe.exec(raw))) {
      const kind: DbOp["kind"] = writeVerbs.test(m[2]) ? "write" : "read";
      const key = `${i}:${kind}:${m[2]}`;
      if (dbKeys.has(key)) continue;
      dbKeys.add(key);
      dbOps.push({ kind, file: filePath, line: i + 1, snippet: raw.trim().slice(0, 200) });
    }
  }

  const loc = lines.filter((l) => l.trim().length > 0).length;

  return {
    path: filePath,
    lang,
    loc,
    content,
    rawImports,
    imports: [],
    external: [],
    exportNames: [...exportNames],
    symbols,
    endpoints,
    dbOps,
    doc: docComment(content, lang),
  };
}

function graphFramework(line: string): string {
  if (/\brouter\./.test(line)) return "express/router";
  if (/\bapp\./.test(line)) return "web framework";
  return "http";
}
