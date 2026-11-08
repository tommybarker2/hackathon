import type { AskHistoryMessage, AskResponse, Citation, RepoFile, RepoSymbol } from "../shared/types";
import { buildFlow } from "./flow";
import { llmAnswer, llmConfigured } from "./llm";
import {
  callersOf,
  expandTokens,
  rankEndpoints,
  rankFiles,
  rankSymbols,
  tokenize,
  type RankedEndpoint,
  type RankedFile,
  type RankedSymbol,
} from "./retrieval";
import type { RepoRecord } from "./store";

type Intent = "how" | "where" | "calls" | "overview" | "general";

function escapeText(text: string): string {
  return text.replace(/[*_`[\]]/g, " ").trim();
}

function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[!?.,;:'"“”‘’]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(options: string[]): string {
  return options[Math.floor(Math.random() * options.length)] ?? options[0] ?? "";
}

function detectIntent(question: string): Intent {
  const q = normalizeQuestion(question);
  if (
    /(who calls|callers|call sites|depends on|depend on|used by|is used by|impact|blast radius|break if|break when|what breaks|affected by)/.test(
      q,
    )
  ) {
    return "calls";
  }
  if (
    /(how (does|do|did|is|are)|how it works|how they work|walk (me )?through|trace|flow|sequence|happens when|execution|lifecycle|pipeline|step by step|end to end)/.test(
      q,
    )
  ) {
    return "how";
  }
  if (
    /(overview|architecture|summar|big picture|what is this|about (this|the) (repo|project|codebase)|structure of|main components|where do i start|getting started|onboard)/.test(
      q,
    )
  ) {
    return "overview";
  }
  if (/(where|which file|locate|defined|definition|find the)/.test(q)) return "where";
  return "general";
}

function makeCiter(rec: RepoRecord) {
  const citations: Citation[] = [];
  const seen = new Set<string>();
  return {
    citations,
    cite(file: string, line: number, endLine?: number, label = ""): string {
      if (!rec.contents.has(file)) return "";
      const key = `${file}:${line}`;
      if (!seen.has(key)) {
        seen.add(key);
        citations.push({ file, line, endLine, label: label || `${file}:${line}` });
      }
      return `[${file}:${line}${endLine && endLine !== line ? `-${endLine}` : ""}]`;
    },
  };
}

interface Bubble {
  purpose: string;
  files: RepoFile[];
}

const BUBBLE_BLURBS: Record<string, string> = {
  ANALYSIS: "repository ingestion, parsing, graph construction and debt detection",
  PARSER: "source parsing, symbol extraction and syntax handling",
  GRAPH: "dependency and call-graph construction",
  FORMAT: "markdown, syntax highlighting and presentation formatting",
  RETRIEVAL: "search, ranking and question answering",
  FLOW: "execution-flow tracing and blast-radius analysis",
  LLM: "language-model integration and answer generation",
  DATA: "storage, persistence and data access",
  API: "HTTP routes, request handlers and the API surface",
  UI: "the React interface and user-facing views",
  CONFIG: "build, environment and project configuration",
  TESTS: "test coverage and verification",
  TOOLING: "scripts and developer tooling",
  SHARED: "shared types and utility code",
  CORE: "supporting application logic",
  AUTH: "authentication and user accounts",
  PAYMENTS: "payments and billing",
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findBubble(rec: RepoRecord, question: string): Bubble | null {
  const normalized = normalizeQuestion(question);
  if (!/\b(bubble|group|cluster|category)\b/.test(normalized)) return null;

  const purposes = [...new Set(rec.analysis.files.map((file) => file.purpose || "CORE"))];
  const purpose = purposes
    .filter((candidate) =>
      new RegExp(`\\b${escapeRegExp(candidate.toLowerCase())}\\b`).test(normalized),
    )
    .sort((a, b) => b.length - a.length)[0];
  if (!purpose) return null;

  const files = rec.analysis.files.filter((file) => (file.purpose || "CORE") === purpose);
  return files.length ? { purpose, files } : null;
}

function bubbleMembers(
  rec: RepoRecord,
  bubble: Bubble,
): { files: RepoFile[]; symbols: RepoSymbol[] } {
  const files = [...bubble.files].sort(
    (a, b) => b.loc - a.loc || b.symbols.length - a.symbols.length || a.path.localeCompare(b.path),
  );
  const ids = new Set(files.flatMap((file) => file.symbols));
  const incoming = new Map<string, number>();
  for (const edge of rec.analysis.callEdges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const symbols = rec.analysis.symbols
    .filter((symbol) => ids.has(symbol.id))
    .sort(
      (a, b) =>
        (incoming.get(b.id) ?? 0) - (incoming.get(a.id) ?? 0) ||
        Number(b.exported) - Number(a.exported) ||
        a.name.localeCompare(b.name) ||
        a.file.localeCompare(b.file),
    );
  return { files, symbols };
}

function formatPurposeCounts(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([purpose, count]) => `${purpose} (${count})`)
    .join(", ");
}

function bubbleAnswer(rec: RepoRecord, bubble: Bubble): AskResponse {
  const { citations, cite } = makeCiter(rec);
  const { files, symbols } = bubbleMembers(rec, bubble);
  const loc = files.reduce((sum, file) => sum + file.loc, 0);
  const blurb = BUBBLE_BLURBS[bubble.purpose] ?? "files that share this purpose tag";
  const lines: string[] = [];

  lines.push(
    `**${bubble.purpose}** is a purpose bubble for ${blurb}. ` +
      `It contains ${files.length} file${files.length === 1 ? "" : "s"} and ${loc.toLocaleString()} lines.`,
  );

  if (files.length) {
    lines.push("\n**Key files**");
    for (const file of files.slice(0, 4)) {
      lines.push(`- \`${file.path}\` — ${file.summary} ${cite(file.path, 1)}`);
    }
  }

  if (symbols.length) {
    lines.push("\n**Key symbols**");
    for (const symbol of symbols.slice(0, 5)) {
      lines.push(
        `- \`${symbol.name}\` — \`${symbol.file}:${symbol.line}\` ${cite(
          symbol.file,
          symbol.line,
          undefined,
          symbol.name,
        )}`,
      );
    }
  }

  const memberPaths = new Set(files.map((file) => file.path));
  const purposeByFile = new Map(
    rec.analysis.files.map((file) => [file.path, file.purpose || "CORE"]),
  );
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const edge of rec.analysis.fileEdges) {
    const fromInside = memberPaths.has(edge.from);
    const toInside = memberPaths.has(edge.to);
    if (fromInside === toInside) continue;
    const outside = toInside ? edge.from : edge.to;
    const target = purposeByFile.get(outside) ?? "CORE";
    const counts = toInside ? incoming : outgoing;
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  if (outgoing.size || incoming.size) {
    lines.push("\n**How it connects**");
    if (outgoing.size) lines.push(`- Imports from: ${formatPurposeCounts(outgoing)}`);
    if (incoming.size) lines.push(`- Used by: ${formatPurposeCounts(incoming)}`);
  }

  const endpoints = files.flatMap((file) => file.endpoints);
  if (endpoints.length) {
    lines.push("\n**Routes in this bubble**");
    for (const endpoint of endpoints.slice(0, 4)) {
      lines.push(
        `- \`${endpoint.method} ${endpoint.path}\` — \`${endpoint.file}:${endpoint.line}\` ${cite(
          endpoint.file,
          endpoint.line,
          undefined,
          `${endpoint.method} ${endpoint.path}`,
        )}`,
      );
    }
  }

  lines.push("\n**Members**");
  for (const file of files) {
    lines.push(`- \`${file.path}\` — ${file.loc} lines, ${file.symbols.length} symbols`);
  }

  return {
    answer: lines.join("\n"),
    citations: citations.slice(0, 12),
    mode: "local",
    topFiles: files.slice(0, 8).map((file) => file.path),
  };
}

function plain(text: string): AskResponse {
  return { answer: text, citations: [], mode: "local", topFiles: [] };
}

/**
 * Greetings and meta questions should never be run through retrieval — a
 * repository search for "hi" only ever produces noise.
 */
function smallTalkAnswer(rec: RepoRecord, question: string): AskResponse | null {
  const n = normalizeQuestion(question);
  const words = n.split(" ").filter(Boolean);
  if (!n) return null;

  const { stats } = rec.analysis;
  const label = rec.analysis.source.label;
  const entry = rec.analysis.entryPoints[0];

  if (
    words.length <= 4 &&
    /^(hi|hey|hello|yo|hiya|howdy|sup|greetings|good morning|good afternoon|good evening|hola)( there| everyone| all| again)?$/.test(
      n,
    )
  ) {
    const opener = pick([
      `Hey — I've mapped **${label}**: ${stats.files} files, ${stats.symbols} symbols and ${stats.endpoints} routes.`,
      `Hello. **${label}** is loaded — ${stats.files} files and ${stats.loc.toLocaleString()} lines of source.`,
      `Hi. I'm holding the map of **${label}** (${stats.symbols} parsed symbols, ${stats.endpoints} routes).`,
    ]);
    return plain(
      `${opener} Ask me where a behaviour lives, how a request moves through the code, or what would break if you changed a function.` +
        (entry ? ` If you want a thread to pull, \`${entry}\` is where the app starts.` : ""),
    );
  }

  if (
    words.length <= 6 &&
    /^(thanks|thank you|thanks a lot|thank you so much|thx|ty|cheers|appreciate it|appreciated|nice one|great|awesome|cool)( so much| a lot| very much| for that| that helps| that helped)?$/.test(
      n,
    )
  ) {
    return plain(
      pick([
        "Anytime. If another part of the codebase is still a mystery, name a file or a behaviour and I'll trace it.",
        `You're welcome. I still have the map of ${label} loaded, so keep the questions coming.`,
        "Glad that helped. Ask about another module and I'll pull the relevant files and call edges.",
      ]),
    );
  }

  if (words.length <= 4 && /^(bye|goodbye|see you|see ya|later|ciao|good night)( for now| then)?$/.test(n)) {
    return plain("See you. The analysis stays loaded for this session if you come back with more questions.");
  }

  if (
    /^(who are you|what are you|what can you do|what do you do|how do i use (this|you)|what is this( app| tool)?|help|help me)$/.test(
      n,
    )
  ) {
    return plain(
      `I'm the reading guide for **${label}** — I parse the source, resolve imports and infer call edges, then answer from what is actually on disk. ` +
        `Right now I'm looking at ${stats.files} files, ${stats.symbols} symbols and ${stats.endpoints} routes.\n\n` +
        "- **Where does X live?** — name a behaviour and I'll point at the file and line.\n" +
        "- **How does X work?** — name a route or function and I'll lay out the call path.\n" +
        "- **What breaks if I change X?** — I'll show callers, affected files and touched endpoints.\n\n" +
        (llmConfigured()
          ? "Answers are written by the configured language model and constrained to retrieved source."
          : "I'm running the deterministic engine: answers are assembled from retrieved code, with no model guessing, and every claim carries a `file:line`."),
    );
  }

  return null;
}

function overviewAnswer(rec: RepoRecord): AskResponse {
  const { stats, files, entryPoints, source } = rec.analysis;
  const { citations, cite } = makeCiter(rec);
  const lines: string[] = [];

  const languages = [...stats.languages]
    .sort((a, b) => b.loc - a.loc)
    .slice(0, 3)
    .map(
      (l) =>
        `${languageName(l.lang)} (${l.loc.toLocaleString()} lines across ${l.files} file${
          l.files === 1 ? "" : "s"
        })`,
    );

  lines.push(
    `**${source.label}** is ${stats.files} files and ${stats.loc.toLocaleString()} lines, holding ${stats.symbols} symbols and ${stats.endpoints} HTTP route${
      stats.endpoints === 1 ? "" : "s"
    }.`,
  );
  if (languages.length) lines.push(`Most of it is ${languages.join(", ")}.`);
  if (stats.gitAvailable && stats.commits) {
    const contributor = stats.contributors[0];
    lines.push(
      `Git history covers ${stats.commits} commit${stats.commits === 1 ? "" : "s"}${
        contributor ? `, most recently from ${contributor.name}` : ""
      }.`,
    );
  }

  const entries = entryPoints.slice(0, 3).flatMap((entry) => {
    const file = files.find((candidate) => candidate.path === entry);
    return file ? [file] : [];
  });
  if (entries.length) {
    lines.push("\n**Start here**");
    for (const file of entries) {
      lines.push(`- \`${file.path}\` — ${file.summary} ${cite(file.path, 1)}`);
    }
  }

  const largest = files
    .filter((file) => file.presence === "code")
    .sort((a, b) => b.loc - a.loc)
    .slice(0, 3);
  if (largest.length) {
    lines.push("\n**Largest modules**");
    for (const file of largest) {
      lines.push(`- \`${file.path}\` — ${file.loc} lines, ${file.symbols.length} symbols ${cite(file.path, 1)}`);
    }
  }

  return {
    answer: lines.join("\n"),
    citations: citations.slice(0, 12),
    mode: "local",
    topFiles: entries.map((file) => file.path),
  };
}

function languageName(lang: string): string {
  const names: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TSX",
    js: "JavaScript",
    jsx: "JSX",
    py: "Python",
    go: "Go",
    java: "Java",
    rb: "Ruby",
    rs: "Rust",
    css: "CSS",
    html: "HTML",
    json: "JSON",
    md: "Markdown",
    sql: "SQL",
    yaml: "YAML",
  };
  return names[lang] ?? lang.toUpperCase();
}

function buildContext(
  rec: RepoRecord,
  files: RepoFile[],
  symbols: string[],
  options: { maxFiles?: number; lead?: string[] } = {},
): string {
  const chunks: string[] = [];
  chunks.push(
    `Repository: ${rec.analysis.source.label} — ${rec.analysis.stats.files} files, ${rec.analysis.stats.loc} lines.`,
  );
  chunks.push(`Entry points: ${rec.analysis.entryPoints.join(", ") || "unknown"}`);
  if (options.lead?.length) chunks.push(...options.lead);

  for (const file of files.slice(0, options.maxFiles ?? 6)) {
    const content = rec.contents.get(file.path) ?? "";
    const lines = content.split("\n");
    const numbered = lines
      .slice(0, 160)
      .map((line, i) => `${i + 1}: ${line}`)
      .join("\n");
    chunks.push(
      `\n--- FILE ${file.path} (${file.lang}, ${file.loc} lines) ---\nPurpose: ${file.purpose}\nSummary: ${file.summary}\n${numbered}`,
    );
    if (chunks.join("\n").length > 26_000) break;
  }

  if (symbols.length) {
    chunks.push(`\nLikely relevant symbols: ${symbols.join(", ")}`);
  }
  return chunks.join("\n");
}

function buildBubbleContext(rec: RepoRecord, bubble: Bubble): string {
  const { files, symbols } = bubbleMembers(rec, bubble);
  const loc = files.reduce((sum, file) => sum + file.loc, 0);
  return buildContext(
    rec,
    files,
    symbols.slice(0, 10).map((symbol) => symbol.name),
    {
      maxFiles: 8,
      lead: [
        `Purpose bubble: ${bubble.purpose} — ${files.length} files, ${loc.toLocaleString()} lines.`,
        `All files below belong to the ${bubble.purpose} purpose bubble. Treat a question about this bubble as a question about the entire group, not a single symbol or file.`,
        `Bubble members: ${files.map((file) => file.path).join(", ")}`,
      ],
    },
  );
}

function extractCitations(text: string, rec: RepoRecord): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();
  // Models cite single lines, ranges (14-22) and several locations inside one
  // bracket ([a.ts:3, b.ts:9]); scan pairs instead of one bracket-shaped match.
  const re = /([A-Za-z0-9_./@()+-]+\.[A-Za-z0-9]+):(\d+)(?:\s*[-–]\s*(\d+))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const file = match[1].replace(/^\.\//, "");
    const line = Number(match[2]);
    if (!Number.isFinite(line) || !rec.contents.has(file)) continue;
    const key = `${file}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      file,
      line,
      endLine: match[3] ? Number(match[3]) : undefined,
      label: `${file}:${line}`,
    });
  }
  return citations.slice(0, 12);
}

export async function answerQuestion(
  rec: RepoRecord,
  question: string,
  history: AskHistoryMessage[] = [],
): Promise<AskResponse> {
  const small = smallTalkAnswer(rec, question);
  if (small) return small;

  const bubble = findBubble(rec, question);
  if (bubble) {
    const members = bubbleMembers(rec, bubble);
    if (llmConfigured()) {
      const text = await llmAnswer(
        question,
        buildBubbleContext(rec, bubble),
        rec.analysis.source.label,
        history,
      );
      if (text && !/\bclosest (match|file)\b/i.test(text)) {
        const extracted = extractCitations(text, rec);
        return {
          answer: text,
          citations: extracted.length
            ? extracted
            : members.files.slice(0, 5).map((file) => ({
                file: file.path,
                line: 1,
                label: `${file.path}:1`,
              })),
          mode: "llm",
          topFiles: members.files.slice(0, 8).map((file) => file.path),
        };
      }
    }
    return bubbleAnswer(rec, bubble);
  }

  if (detectIntent(question) === "overview") {
    const overview = overviewAnswer(rec);
    if (overview.answer) return overview;
  }

  const recentPrompts = history
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.text);
  const tokens = expandTokens(tokenize([...recentPrompts, question].join(" ")));
  const files = rankFiles(rec, tokens);
  const symbols = rankSymbols(rec, tokens);
  const endpoints = rankEndpoints(rec, tokens);

  if (llmConfigured()) {
    const context = buildContext(
      rec,
      files.slice(0, 6).map((f) => f.file),
      symbols.slice(0, 8).map((s) => s.symbol.name),
    );
    const text = await llmAnswer(question, context, rec.analysis.source.label, history);
    if (text) {
      return {
        answer: text,
        citations: extractCitations(text, rec),
        mode: "llm",
        topFiles: files.slice(0, 5).map((f) => f.file.path),
      };
    }
  }

  return localAnswer(rec, question, tokens, files, symbols, endpoints);
}

function localAnswer(
  rec: RepoRecord,
  question: string,
  tokens: string[],
  files: RankedFile[],
  symbols: RankedSymbol[],
  endpoints: RankedEndpoint[],
): AskResponse {
  const { citations, cite } = makeCiter(rec);
  const intent = detectIntent(question);

  const topFile = files[0]?.file;
  const topSymbol = symbols[0]?.symbol;
  const topEndpoint = endpoints[0]?.endpoint;

  if (!topFile && !topSymbol && !topEndpoint) {
    const fallback = rec.analysis.entryPoints.slice(0, 3);
    return {
      answer:
        `I couldn't find anything in **${rec.analysis.source.label}** that matches "${escapeText(question)}".\n\n` +
        `Try naming a module, a route or a function — for example: “What happens when ${
          rec.analysis.files[0]?.endpoints[0]?.path ?? "/api"
        } is called?”\n\n` +
        `Closest starting points:\n` +
        (fallback.length
          ? fallback.map((f) => `- \`${f}\` ${cite(f, 1)}`).join("\n")
          : "- Open the Cloud tab to browse the graph."),
      citations,
      mode: "local",
      topFiles: fallback,
    };
  }

  const lines: string[] = [];
  const strong = (files[0]?.score ?? 0) >= 6 || (symbols[0]?.score ?? 0) >= 8;

  // A named function should win over a route that merely shares a word with it
  // ("where is analyzeRepository defined" is not a question about POST /api/analyze).
  const namesRoute =
    /\b(get|post|put|patch|delete|route|endpoint|request handler|composer)\b/.test(
      normalizeQuestion(question),
    ) || /\/[\w-]+\//.test(question);
  const routeLikeSymbol = Boolean(topSymbol && /^(GET|POST|PUT|PATCH|DELETE|ANY) \//.test(topSymbol.name));
  const namedSymbol =
    Boolean(topSymbol) &&
    !routeLikeSymbol &&
    normalizeQuestion(question).includes(topSymbol?.name.toLowerCase() ?? "\u0000");
  const preferSymbol =
    Boolean(topSymbol) &&
    (namedSymbol ||
      (!namesRoute &&
        (intent === "where" || intent === "calls" || (symbols[0]?.score ?? 0) >= 8)));

  if (topEndpoint && !preferSymbol) {
    const handler = topEndpoint.handler
      ? rec.analysis.symbols.find((s) => s.id === topEndpoint.handler)
      : undefined;
    const inline = handler?.name === `${topEndpoint.method} ${topEndpoint.path}`;
    let lead = `\`${topEndpoint.method} ${topEndpoint.path}\` is the entry point here, declared in \`${topEndpoint.file}:${topEndpoint.line}\`.`;
    if (handler && !inline) {
      lead += ` Requests are handled by \`${handler.name}\` at \`${handler.file}:${handler.line}\`.`;
    } else if (topFile) {
      lead += ` ${topFile.summary}`;
    }
    lines.push(lead);
  } else if (topSymbol && preferSymbol) {
    const callers = callersOf(rec, topSymbol.id);
    const callees = rec.analysis.callEdges.filter((e) => e.from === topSymbol.id).length;
    let lead =
      intent === "where" || intent === "calls"
        ? `\`${topSymbol.name}\` is defined at \`${topSymbol.file}:${topSymbol.line}\`.`
        : `\`${topSymbol.name}\` in \`${topSymbol.file}:${topSymbol.line}\` is the closest match.`;
    if (intent !== "calls") {
      lead += callers.length
        ? ` It is called from ${callers.length} place${callers.length === 1 ? "" : "s"}, including ${callers
            .slice(0, 3)
            .map((caller) => `\`${caller.name}\``)
            .join(", ")}.`
        : " Nothing else in the repository calls it statically.";
      if (callees) lead += ` It makes ${callees} downstream call${callees === 1 ? "" : "s"}.`;
    }
    lines.push(lead);
  } else if (topEndpoint) {
    lines.push(
      `\`${topEndpoint.method} ${topEndpoint.path}\` is the entry point here, declared in \`${topEndpoint.file}:${topEndpoint.line}\`.`,
    );
  } else if (topFile) {
    lines.push(
      intent === "how"
        ? `\`${topFile.path}\` is where this logic lives.`
        : `\`${topFile.path}\` is the closest file for that.`,
    );
  }

  if (!strong) {
    lines.push(
      "\n_No exact identifier matched, so this is the nearest area rather than a definitive answer. Name a file, route or function for a sharper result._",
    );
  }

  const fileHeading =
    intent === "how"
      ? "Key files"
      : intent === "calls"
        ? "Files involved"
        : intent === "where"
          ? "Where it lives"
          : "Relevant files";
  if (files.length) {
    lines.push(`\n**${fileHeading}**`);
    for (const { file } of files.slice(0, 3)) {
      lines.push(`- \`${file.path}\` — ${file.summary} ${cite(file.path, 1)}`);
    }
  }

  if (topFile && topFile.endpoints.length && intent !== "calls") {
    lines.push("\n**Routes in this file**");
    for (const endpoint of topFile.endpoints.slice(0, 3)) {
      lines.push(
        `- \`${endpoint.method} ${endpoint.path}\` — \`${endpoint.file}:${endpoint.line}\` ${cite(
          endpoint.file,
          endpoint.line,
          undefined,
          `${endpoint.method} ${endpoint.path}`,
        )}`,
      );
    }
  }

  if (intent === "calls" && topSymbol) {
    const callers = callersOf(rec, topSymbol.id);
    lines.push("\n**Who depends on it**");
    if (!callers.length) {
      lines.push(`- Nothing in the analysed code calls \`${topSymbol.name}\` statically.`);
    } else {
      for (const caller of callers.slice(0, 6)) {
        lines.push(
          `- \`${caller.name}\` — \`${caller.file}:${caller.line}\` ${cite(
            caller.file,
            caller.line,
            undefined,
            caller.name,
          )}`,
        );
      }
    }
  }

  const wantsFlow = intent === "how" || (intent === "general" && Boolean(topSymbol) && strong);
  if (wantsFlow) {
    const flow = buildFlow(rec, { query: question });
    if (flow.steps.length > 1) {
      lines.push("\n**How it moves through the code**");
      flow.steps.slice(0, 6).forEach((step, index) => {
        lines.push(
          `${index + 1}. **${step.name}** — \`${step.file}:${step.line}\` ${cite(
            step.file,
            step.line,
            undefined,
            step.name,
          )}`,
        );
      });
      lines.push(`\n_${flow.explanation}_`);
    }
  }

  return {
    answer: lines.join("\n"),
    citations: citations.slice(0, 12),
    mode: "local",
    topFiles: files.slice(0, 5).map((f) => f.file.path),
  };
}
