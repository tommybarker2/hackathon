export type Lang =
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "py"
  | "go"
  | "java"
  | "rb"
  | "rs"
  | "css"
  | "html"
  | "json"
  | "md"
  | "sql"
  | "yaml"
  | "other";

export type SymbolKind = "function" | "class" | "method" | "component" | "handler";

export interface RepoSymbol {
  id: string;
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  endLine: number;
  exported: boolean;
  parent?: string;
  params: string;
  loc: number;
}

export interface Endpoint {
  method: string;
  path: string;
  file: string;
  line: number;
  framework: string;
  handler?: string;
}

export interface DbOp {
  kind: "read" | "write" | "query";
  file: string;
  line: number;
  snippet: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "import";
}

export interface CallEdge {
  from: string;
  to: string;
  line: number;
}

export interface Issue {
  id: string;
  kind: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  file: string;
  line: number;
  evidence: string[];
}

export interface RepoFile {
  path: string;
  lang: Lang;
  loc: number;
  imports: string[];
  external: string[];
  symbols: string[];
  endpoints: Endpoint[];
  dbOps: DbOp[];
  exported: string[];
  commits: number;
  churn: number;
  lastCommit?: string;
  lastDate?: string;
  lastAuthor?: string;
  presence: "code" | "config" | "doc" | "style";
  summary: string;
}

export interface CommitInfo {
  hash: string;
  author: string;
  date: string;
  subject: string;
  files: number;
}

export interface LanguageStat {
  lang: string;
  loc: number;
  files: number;
}

export interface AnalysisStats {
  files: number;
  loc: number;
  symbols: number;
  endpoints: number;
  dbOps: number;
  imports: number;
  languages: LanguageStat[];
  commits: number;
  contributors: { name: string; commits: number }[];
  gitAvailable: boolean;
  truncated: boolean;
}

export interface Analysis {
  id: string;
  source: {
    kind: "local" | "github";
    label: string;
    path?: string;
    url?: string;
    branch?: string;
  };
  analyzedAt: string;
  stats: AnalysisStats;
  files: RepoFile[];
  symbols: RepoSymbol[];
  fileEdges: GraphEdge[];
  callEdges: CallEdge[];
  issues: Issue[];
  commits: CommitInfo[];
  entryPoints: string[];
  notes: string[];
}

export interface Citation {
  file: string;
  line: number;
  endLine?: number;
  label: string;
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
  mode: "local" | "llm";
  topFiles: string[];
}

export interface FlowStep {
  symbolId?: string;
  name: string;
  file: string;
  line: number;
  kind: string;
  depth: number;
  note: string;
}

export interface FlowResponse {
  title: string;
  question: string;
  steps: FlowStep[];
  mode: "static";
  confidence: number;
  explanation: string;
}

export interface ImpactResponse {
  symbol: RepoSymbol | null;
  affectedSymbols: RepoSymbol[];
  affectedFiles: string[];
  endpoints: Endpoint[];
  tests: string[];
  summary: string;
}

export interface FileResponse {
  path: string;
  lang: Lang;
  content: string;
}
