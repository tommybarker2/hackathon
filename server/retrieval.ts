import type { Endpoint, RepoFile, RepoSymbol } from "../shared/types";
import type { RepoRecord } from "./store";

const STOP = new Set(
  "the a an and or but if then than that this these those of to in on at for with from by as is are was were be been being do does did doing have has had i me my we our you your it its they them their he she his her can could would should will shall may might must not no yes how what where when why which who whom whose about into over under again further once here there all any both each few more most other some such only own same so too very just now also code file files function functions method methods module modules project app application thing things part parts place places work works working happen happens happening what's whats use used uses using get gets got make makes made need needs want wants look looks looking find finds".split(
    " ",
  ),
);

const SYNONYMS: Record<string, string[]> = {
  auth: ["login", "signin", "session", "token", "jwt", "password", "credential", "oauth", "register", "signup"],
  login: ["auth", "signin", "session", "password", "credential"],
  logout: ["auth", "session", "token"],
  payment: ["checkout", "charge", "billing", "stripe", "invoice", "purchase", "order"],
  checkout: ["payment", "cart", "order", "purchase"],
  cart: ["basket", "order", "checkout", "item"],
  database: ["db", "sql", "query", "prisma", "postgres", "sqlite", "d1", "repository", "store", "persistence"],
  data: ["database", "db", "store", "repository", "state"],
  api: ["route", "router", "endpoint", "handler", "http", "request", "controller"],
  endpoint: ["route", "api", "handler", "http"],
  route: ["router", "api", "endpoint", "handler"],
  graph: ["dependency", "dependencies", "edge", "node", "import", "architecture"],
  architecture: ["graph", "dependency", "module", "structure", "layer"],
  parse: ["parser", "ast", "symbol", "extract", "scan"],
  parsing: ["parse", "parser", "ast", "extract", "scan"],
  pipeline: ["flow", "analyze", "analysis", "stage", "sequence"],
  analyze: ["analysis", "parser", "index", "scan", "ingest", "archaeology"],
  analysis: ["analyze", "parser", "index", "scan", "ingest"],
  search: ["retrieval", "rank", "query", "match", "index"],
  retrieve: ["retrieval", "rank", "search", "match"],
  answer: ["response", "completion", "question", "ask"],
  llm: ["openai", "model", "prompt", "completion"],
  history: ["commit", "git", "archaeology", "churn", "author"],
  test: ["spec", "assert", "expect", "coverage"],
  config: ["configuration", "settings", "env", "setup"],
  ui: ["component", "view", "page", "render", "frontend"],
  frontend: ["ui", "component", "view", "react", "client"],
  backend: ["server", "api", "handler", "service"],
  error: ["fail", "failure", "catch", "throw", "exception"],
  cache: ["memo", "store", "redis"],
  websocket: ["socket", "realtime", "ws"],
  upload: ["file", "import", "ingest", "multipart"],
  dependency: ["import", "require", "package", "graph"],
  break: ["impact", "caller", "depends", "affected"],
  impact: ["caller", "affected", "depend", "break", "change"],
};

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function expandTokens(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const token of tokens) {
    // Light stemming so "parsing"/"parsed"/"scans" reach "parse"/"scan"
    // without pulling in a stemmer dependency.
    const base = token.endsWith("ing")
      ? token.slice(0, -3)
      : token.endsWith("ed")
        ? token.slice(0, -2)
        : token.endsWith("s")
          ? token.slice(0, -1)
          : token;
    if (base.length > 3) out.add(base);
    if (base.length > 2) out.add(`${base}e`);
    for (const synonym of SYNONYMS[token] ?? []) out.add(synonym);
    for (const [key, values] of Object.entries(SYNONYMS)) {
      if (values.includes(token) && token.length > 3) out.add(key);
    }
  }
  return [...out];
}

export interface RankedFile {
  file: RepoFile;
  score: number;
}

export function rankFiles(rec: RepoRecord, tokens: string[]): RankedFile[] {
  const ranked: RankedFile[] = [];
  for (const file of rec.analysis.files) {
    const pathText = file.path.toLowerCase();
    const pathTokens = new Set(tokenize(file.path));
    let score = 0;
    const purpose = file.purpose.toLowerCase();
    for (const token of tokens) {
      if (pathTokens.has(token)) score += 6;
      else if (pathText.includes(token)) score += 2;
      if (purpose === token) score += 8;
      if (file.summary.toLowerCase().includes(token)) score += 1.4;
      if (file.endpoints.some((e) => e.path.toLowerCase().includes(token))) score += 2.5;
    }
    if (score > 0) {
      score += Math.min(file.endpoints.length, 4);
      ranked.push({ file, score });
    }
  }
  return ranked.sort((a, b) => b.score - a.score || b.file.loc - a.file.loc);
}

export interface RankedSymbol {
  symbol: RepoSymbol;
  file: RepoFile | undefined;
  score: number;
}

export function rankSymbols(rec: RepoRecord, tokens: string[]): RankedSymbol[] {
  const fileByPath = new Map(rec.analysis.files.map((f) => [f.path, f]));
  const ranked: RankedSymbol[] = [];

  for (const symbol of rec.analysis.symbols) {
    const nameTokens = new Set(tokenize(symbol.name));
    const lhs = symbol.name.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (lhs === token) score += 12;
      if (nameTokens.has(token)) score += 7;
      else if (lhs.includes(token) && token.length > 3) score += 2.5;
    }
    const body = rec.parsed.get(symbol.file)?.symbols.find((s) => s.id === symbol.id)?.body ?? "";
    const bodyLower = body.toLowerCase();
    for (const token of tokens.slice(0, 10)) {
      let occurrences = 0;
      let idx = bodyLower.indexOf(token);
      while (idx !== -1 && occurrences < 4) {
        occurrences++;
        idx = bodyLower.indexOf(token, idx + token.length);
      }
      score += occurrences * 1.2;
    }
    if (score > 0) ranked.push({ symbol, file: fileByPath.get(symbol.file), score });
  }

  return ranked.sort((a, b) => b.score - a.score);
}

export interface RankedEndpoint {
  endpoint: Endpoint;
  score: number;
}

export function rankEndpoints(rec: RepoRecord, tokens: string[]): RankedEndpoint[] {
  const ranked: RankedEndpoint[] = [];
  for (const file of rec.analysis.files) {
    for (const endpoint of file.endpoints) {
      const pathTokens = new Set(tokenize(endpoint.path));
      let score = 0;
      for (const token of tokens) {
        if (pathTokens.has(token)) score += 8;
        else if (endpoint.path.toLowerCase().includes(token)) score += 3;
      }
      if (score > 0) ranked.push({ endpoint, score });
    }
  }
  return ranked.sort((a, b) => b.score - a.score);
}

export function callersOf(rec: RepoRecord, symbolId: string): RepoSymbol[] {
  const ids = new Set(rec.analysis.callEdges.filter((e) => e.to === symbolId).map((e) => e.from));
  return rec.analysis.symbols.filter((s) => ids.has(s.id));
}

export function calleesOf(rec: RepoRecord, symbolId: string): RepoSymbol[] {
  const ids = new Set(rec.analysis.callEdges.filter((e) => e.from === symbolId).map((e) => e.to));
  return rec.analysis.symbols.filter((s) => ids.has(s.id));
}

export function endpointForSymbol(rec: RepoRecord, symbol: RepoSymbol): Endpoint | undefined {
  for (const file of rec.analysis.files) {
    for (const endpoint of file.endpoints) {
      if (endpoint.handler === symbol.id) return endpoint;
    }
  }
  return undefined;
}
