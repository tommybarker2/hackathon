import type { DbOp, Endpoint } from "../../shared/types";
import type { ParsedSymbol } from "./parse";

const RULES: [RegExp, string][] = [
  [/(^|\/)(auth|oauth|session|login|password|jwt|users?)\b/i, "authentication and user accounts"],
  [/(^|\/)(payments?|billing|checkout|stripe|invoices?|subscriptions?)\b/i, "payments and billing"],
  [/(^|\/)(cart|basket|orders?|catalog|products?|inventory)\b/i, "cart, orders and catalog"],
  [/(^|\/)(ask|answer|retriev|chat|question|rank|search)/i, "question answering and retrieval"],
  [/(^|\/)(flow|impact|trace|blast)/i, "execution-flow tracing and impact analysis"],
  [/(^|\/)(llm|openai|prompt|completion)/i, "language-model integration"],
  [/(^|\/)(db|database|models?|schemas?|repositor(y|ies)|sql|migrations?|storage|store|persistence|cache)\b/i, "data access and storage"],
  [/(^|\/)(api|routes?|routers?|controllers?|handlers?|endpoints?|middlewares?)\b/i, "the HTTP API surface"],
  [/(^|\/)(graph|analy|parser|parse|ingest|archaeolog)/i, "repository analysis and graph construction"],
  [/(^|\/)(components?|ui|views?|pages?|screens?|styles?|theme)\b/i, "the user interface"],
  [/(^|\/)(tests?|__tests__|specs?)\b/i, "the test suite"],
  [/(^|\/)(config|settings|env|constants|vite|tsconfig)\b/i, "configuration and build setup"],
  [/(^|\/)(scripts?|cli|tools?|bin)\b/i, "tooling and scripts"],
  [/(^|\/)(utils?|helpers?|lib|shared|common)\b/i, "shared utilities"],
  [/(^|\/)(index|main|app|server|bootstrap|manage)\.(ts|tsx|js|jsx|mjs|py|go|rs|rb)$/i, "application startup and wiring"],
];

export function purposeFor(filePath: string): string {
  const normalized = filePath.toLowerCase();
  for (const [re, label] of RULES) {
    if (re.test(normalized)) return label;
  }
  return "supporting application logic";
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const stop = cleaned.search(/[.!?](\s|$)/);
  const sentence = stop > 0 ? cleaned.slice(0, stop + 1) : cleaned;
  return sentence.length > 160 ? sentence.slice(0, 157) + "…" : sentence;
}

export function summarizeFile(input: {
  path: string;
  doc: string;
  loc: number;
  symbols: ParsedSymbol[];
  endpoints: Endpoint[];
  dbOps: DbOp[];
  imports: number;
  external: number;
}): string {
  const purpose = purposeFor(input.path);
  const pieces: string[] = [];
  pieces.push(`Handles ${purpose}.`);

  const doc = firstSentence(input.doc);
  if (doc) pieces.push(doc);

  const names = input.symbols.slice(0, 3).map((s) => s.name);
  if (names.length) {
    const more = input.symbols.length - names.length;
    pieces.push(`Defines ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`);
  }

  if (input.endpoints.length) {
    const list = input.endpoints
      .slice(0, 3)
      .map((e) => `${e.method} ${e.path}`)
      .join(", ");
    pieces.push(
      `Serves ${input.endpoints.length} route${input.endpoints.length === 1 ? "" : "s"} (${list}${
        input.endpoints.length > 3 ? ", …" : ""
      }).`,
    );
  }

  if (input.dbOps.length) {
    pieces.push(
      `Touches the database in ${input.dbOps.length} place${input.dbOps.length === 1 ? "" : "s"}.`,
    );
  }

  if (input.imports === 0 && input.external === 0) {
    pieces.push("Has no imports — likely a leaf module.");
  }

  return pieces.join(" ");
}

export function purposeList(): string[] {
  return RULES.map(([, label]) => label);
}
