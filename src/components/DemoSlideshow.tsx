import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Analysis } from "../../shared/types";
import { fmt } from "../format";
import { CloudLogo } from "./CloudLogo";

type DemoTab = "overview" | "map" | "flows" | "ask" | "debt";

interface Props {
  open: boolean;
  analysis: Analysis | null;
  onClose: () => void;
  onExplore: (tab: DemoTab) => void;
}

interface Slide {
  title: string;
  body: string;
  points: string[];
  tab?: DemoTab;
  cta?: string;
  final?: boolean;
  art: ReactNode;
}

interface PurposeBubble {
  name: string;
  count: number;
}

interface FlowDemo {
  name: string;
  meta: string;
}

const BUBBLE_COLORS = [
  "var(--yellow-soft)",
  "var(--mint)",
  "var(--blue)",
  "var(--lilac)",
  "var(--salmon)",
];

const FALLBACK_PURPOSES: PurposeBubble[] = [
  { name: "UI", count: 0 },
  { name: "GRAPH", count: 0 },
  { name: "CORE", count: 0 },
  { name: "PARSER", count: 0 },
  { name: "LLM", count: 0 },
];

const FALLBACK_FLOW: FlowDemo[] = [
  { name: "Incoming request", meta: "HTTP" },
  { name: "route handler", meta: "server/index.ts" },
  { name: "service call", meta: "src/service.ts" },
  { name: "Response", meta: "source links" },
];

export function DemoSlideshow({ open, analysis, onClose, onExplore }: Props) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const stats = analysis?.stats;
  const sourcePath = analysis
    ? analysis.source.kind === "github"
      ? analysis.source.url ?? "https://github.com/owner/repo"
      : analysis.source.label
    : ".";

  const purposes = useMemo<PurposeBubble[]>(() => {
    const counts = new Map<string, number>();
    for (const file of analysis?.files ?? []) {
      if (file.presence !== "code") continue;
      const name = (file.purpose || "CORE").toUpperCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    return ranked.length ? ranked : FALLBACK_PURPOSES;
  }, [analysis]);

  const flow = useMemo<FlowDemo[]>(() => {
    if (!analysis) return FALLBACK_FLOW;
    const endpoints = analysis.files.flatMap((file) => file.endpoints);
    const endpoint = endpoints.find((item) => item.handler) ?? endpoints[0];
    const handler = endpoint?.handler
      ? analysis.symbols.find((symbol) => symbol.name === endpoint.handler)
      : undefined;
    const callees =
      handler && analysis
        ? analysis.callEdges
            .filter((edge) => edge.from === handler.id)
            .slice(0, 2)
            .map((edge) => analysis.symbols.find((symbol) => symbol.id === edge.to))
            .filter((symbol): symbol is NonNullable<typeof symbol> => Boolean(symbol))
        : [];

    const steps: FlowDemo[] = [
      {
        name: endpoint ? `${endpoint.method} ${endpoint.path}` : "Incoming request",
        meta: endpoint?.framework ?? "HTTP",
      },
      {
        name: handler?.name ?? endpoint?.handler ?? "route handler",
        meta: handler ? `${handler.file}:${handler.line}` : endpoint?.file ?? "server/index.ts",
      },
      ...callees.map((symbol) => ({
        name: symbol.name,
        meta: `${symbol.file}:${symbol.line}`,
      })),
    ];
    if (steps.length < 4) {
      steps.push({ name: "Response", meta: "source links" });
    }
    return steps.slice(0, 4);
  }, [analysis]);

  const citation = analysis?.symbols[0];
  const issue = analysis?.issues[0];
  const flowQuery = analysis
    ? flow[0]?.name ?? "application startup"
    : "POST /api/ask";

  const slides: Slide[] = [
    {
      title: "Welcome to The Repo Cloud!",
      body: "The goal is to make an unfamiliar codebase easier to understand. Map its structure, explain how it works, and show where a change could have an impact.",
      points: [
        "Local folders and public GitHub repositories",
        "Purpose bubbles and an import graph",
        "Answers linked to source lines",
      ],
      art: <OrbitArt stats={stats} issueCount={analysis?.issues.length} />,
    },
    {
      title: "Upload any repository",
      body: "Analyze this app, a folder on your machine, or a public GitHub URL. The parser reads imports, symbols, routes and git history, then builds the map.",
      points: [
        "Works with local paths and GitHub URLs",
        "Uses git history when available",
        "Load any commit snapshot",
      ],
      tab: "overview",
      cta: "Open the overview",
      art: <SourceArt analysis={analysis} sourcePath={sourcePath} />,
    },
    {
      title: "View the connections of the codebase",
      body: "Files are grouped by purpose instead of folder structure. Import lines show which areas depend on each other, and clicking a node opens its source.",
      points: [
        "Files grouped by purpose",
        "Import lines show dependencies",
        "Click any node to inspect its source",
      ],
      tab: "map",
      cta: "Explore the Cloud",
      art: <MapArt purposes={purposes} />,
    },
    {
      title: "Trace behaviors",
      body: "Start with a route, a symbol or a question. The tracer walks the call graph and shows each step with the file and line where it happens.",
      points: [
        "Route, handler and downstream calls",
        "Each step includes a source location",
        "Highlight the path on the map",
      ],
      tab: "flows",
      cta: "Trace a flow",
      art: <FlowArt query={flowQuery} steps={flow} />,
    },
    {
      title: "Follow up with a specialized AI",
      body: "Ask in plain language. Answers include links to the files and lines behind them, and follow-up questions keep the conversation context.",
      points: [
        "Answers cite files and lines",
        "Follow-ups keep prior context",
        "Works with an LLM or the built-in engine",
      ],
      tab: "ask",
      cta: "Ask a question",
      art: <AskArt citation={citation} />,
    },
    {
      title: "Find iffy code",
      body: "Static checks point out long functions, god files, cycles and unused symbols. Blast radius shows the callers, routes and tests that a change could affect.",
      points: [
        "Severity and evidence for each issue",
        "See affected callers, routes and tests",
        "Open evidence, trace the path or ask why",
      ],
      tab: "debt",
      cta: "Review warnings",
      art: <DebtArt issue={issue} />,
    },
    {
      title: "Your turn! :D",
      body: "You are looking at a live analysis. Open the Cloud map, ask a question, or go back to the overview.",
      points: [],
      final: true,
      art: <FinalArt stats={stats} />,
    },
  ];

  const active = slides[Math.min(index, slides.length - 1)];

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setDirection(1);
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 40);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        move(1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        move(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, onClose]);

  if (!open) return null;

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(slides.length - 1, next));
    setDirection(clamped < index ? -1 : 1);
    setIndex(clamped);
  }

  function move(delta: number) {
    goTo(index + delta);
  }

  return (
    <div
      className="modal-backdrop demo-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="demo-modal"
        role="dialog"
        aria-modal="true"
        aria-label="The Repo Cloud guided demo"
      >
        <div className="demo-top">
          <span className="demo-top-logo" aria-hidden>
            <CloudLogo size={23} />
          </span>
          <span className="demo-top-copy">
            <strong>Guided demo</strong>
            <span>A guided tour</span>
          </span>
          <span className="demo-count">
            {String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
          </span>
          <button
            ref={closeRef}
            type="button"
            className="icon-button demo-close"
            onClick={onClose}
            aria-label="Close demo"
          >
            ✕
          </button>
        </div>

        <div className="demo-body">
          <section
            key={index}
            className={`demo-slide ${direction === 1 ? "forward" : "back"}`}
            aria-labelledby="demo-title"
          >
            <div className="demo-copy" aria-live="polite">
              <h2 id="demo-title">{active.title}</h2>
              <p className="demo-body-text">{active.body}</p>

              {active.points.length > 0 && (
                <ul className="demo-points">
                  {active.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              )}

              {active.tab && analysis && (
                <button
                  type="button"
                  className="primary demo-try"
                  onClick={() => onExplore(active.tab as DemoTab)}
                >
                  {active.cta ?? "Open this view"} <span aria-hidden>→</span>
                </button>
              )}

              {active.final && analysis && (
                <div className="demo-final-actions">
                  <button type="button" className="primary" onClick={() => onExplore("map")}>
                    Explore the Cloud
                  </button>
                  <button type="button" className="ghost" onClick={() => onExplore("ask")}>
                    Ask a question
                  </button>
                  <button type="button" className="ghost" onClick={() => onExplore("overview")}>
                    Back to overview
                  </button>
                </div>
              )}
            </div>

            <div className="demo-art">{active.art}</div>
          </section>
        </div>

        <div className="demo-controls">
          <div className="demo-nav">
            <button
              type="button"
              className="ghost small"
              onClick={() => move(-1)}
              disabled={index === 0}
            >
              ← Back
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => move(1)}
              disabled={index === slides.length - 1}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrbitArt({
  stats,
  issueCount,
}: {
  stats?: Analysis["stats"];
  issueCount?: number;
}) {
  const chips = [
    { label: "files", value: stats ? fmt(stats.files) : "...", position: "one" },
    { label: "symbols", value: stats ? fmt(stats.symbols) : "...", position: "two" },
    { label: "routes", value: stats ? fmt(stats.endpoints) : "...", position: "three" },
    { label: "issues", value: issueCount === undefined ? "..." : fmt(issueCount), position: "four" },
  ];

  return (
    <div className="demo-orbit" aria-hidden>
      <span className="demo-orbit-ring ring-a" />
      <span className="demo-orbit-ring ring-b" />
      <div className="demo-orbit-core">
        <CloudLogo size={104} />
      </div>
      {chips.map((chip) => (
        <span key={chip.label} className={`demo-orbit-chip ${chip.position}`}>
          <strong>{chip.value}</strong>
          <span>{chip.label}</span>
        </span>
      ))}
    </div>
  );
}

function SourceArt({
  analysis,
  sourcePath,
}: {
  analysis: Analysis | null;
  sourcePath: string;
}) {
  const stats = analysis?.stats;
  return (
    <div className="demo-source" aria-hidden>
      <div className="demo-source-head">
        <span className="demo-source-dot" />
        <span>LIVE ANALYSIS</span>
        <span className="demo-source-pill">static</span>
      </div>

      <div className="demo-source-tabs">
        <span className="demo-source-tab active">This app</span>
        <span className="demo-source-tab">GitHub</span>
      </div>

      <div className="demo-source-field">
        <span className="demo-prompt">›</span>
        <span className="demo-path">{sourcePath}</span>
        <span className="demo-caret" />
      </div>

      <span className="demo-source-button">Analyze →</span>

      <div className="demo-source-status">
        <span className="demo-scan-dot" />
        reading files, imports, symbols, git history…
      </div>

      <div className="demo-mini-stats">
        <MiniStat value={stats ? fmt(stats.files) : "..."} label="files" />
        <MiniStat value={stats ? fmt(stats.symbols) : "..."} label="symbols" />
        <MiniStat value={stats ? fmt(stats.endpoints) : "..."} label="routes" />
      </div>
    </div>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="demo-mini-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}

function MapArt({ purposes }: { purposes: PurposeBubble[] }) {
  return (
    <div className="demo-map" aria-hidden>
      <svg className="demo-map-lines" viewBox="0 0 400 350" preserveAspectRatio="none">
        <path d="M112 72 C 170 80, 240 82, 304 98" />
        <path d="M104 280 C 155 238, 188 205, 224 187" />
        <path d="M323 292 C 300 250, 274 215, 246 192" />
        <path d="M306 100 C 296 136, 270 162, 246 184" />
        <path d="M104 280 C 160 278, 202 222, 228 194" />
      </svg>
      {purposes.slice(0, 5).map((purpose, index) => (
        <span
          key={purpose.name}
          className={`demo-bubble bubble-${index + 1}`}
          style={{ background: BUBBLE_COLORS[index % BUBBLE_COLORS.length] }}
        >
          <strong>{purpose.name}</strong>
          <small>{purpose.count ? `${purpose.count} files` : "purpose"}</small>
        </span>
      ))}
      <span className="demo-map-caption">click a bubble → source</span>
    </div>
  );
}

function FlowArt({ query, steps }: { query: string; steps: FlowDemo[] }) {
  return (
    <div className="demo-flow-art" aria-hidden>
      <div className="demo-flow-query">
        <span className="demo-search">⌕</span>
        <span>{query}</span>
        <span className="demo-caret" />
      </div>

      <div className="demo-flow-track">
        {steps.map((step, index) => (
          <div className="demo-flow-step" key={`${step.name}-${index}`}>
            <span className="demo-flow-num">{index + 1}</span>
            <span className="demo-flow-node">
              <strong>{step.name}</strong>
              <small>{step.meta}</small>
            </span>
          </div>
        ))}
      </div>

      <div className="demo-flow-foot">
        <span className="demo-tag">static trace</span>
        <span>open any hop → exact source</span>
      </div>
    </div>
  );
}

function AskArt({ citation }: { citation?: Analysis["symbols"][number] }) {
  const citeLabel = citation
    ? `${citation.file.split("/").slice(-2).join("/")}:${citation.line}`
    : "server/ask.ts:80";

  return (
    <div className="demo-chat-art" aria-hidden>
      <div className="demo-chat-head">
        <span className="avatar">CA</span>
        <strong>Ask AI</strong>
        <span className="demo-live">source links</span>
      </div>

      <div className="demo-q">How does the Cloud map group files?</div>
      <div className="demo-a">
        <p>
          Files are grouped by purpose, then connected by their imports. Each bubble is a
          responsibility, not a folder.
        </p>
        <div className="demo-cites">
          <span className="demo-cite">{citeLabel}</span>
          <span className="demo-cite">purpose tags</span>
        </div>
      </div>

      <div className="demo-memory">
        <span>↺</span> remembers the last 8 turns
      </div>

      <div className="demo-q small">What about its callers?</div>
    </div>
  );
}

function DebtArt({ issue }: { issue?: Analysis["issues"][number] }) {
  const severity = issue?.severity ?? "medium";
  const issueFile = issue?.file ?? "src/core/handler.ts";
  const issueKind = (issue?.kind ?? "long-function").replace(/-/g, " ");
  const evidence = issue?.evidence.slice(0, 3) ?? ["212 lines", "48 branches", "0 callers"];

  return (
    <div className="demo-debt-art" aria-hidden>
      <div className="demo-issue">
        <div className="demo-issue-head">
          <span className={`severity ${severity}`}>{severity}</span>
          <span className="demo-issue-kind">{issueKind}</span>
          <span className="demo-issue-file">{issueFile}</span>
        </div>
        <strong className="demo-issue-title">
          {issue?.title ?? "One function is carrying too much responsibility"}
        </strong>
        <p>
          {issue?.detail ??
            "The function mixes routing, validation and orchestration. Splitting it would make the behaviour easier to test and trace."}
        </p>
        <div className="demo-evidence">
          {evidence.map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      </div>

      <div className="demo-code">
        <div className="demo-code-head">
          <span>{issueFile}</span>
          <span>impact · trace · ask</span>
        </div>
        <div className="demo-code-line">
          <span className="ln">41</span>
          <span>export async function handleRequest(</span>
        </div>
        <div className="demo-code-line hit">
          <span className="ln">42</span>
          <span>&nbsp;&nbsp;request: Request, context: Context</span>
        </div>
        <div className="demo-code-line">
          <span className="ln">43</span>
          <span>) {"{"}</span>
        </div>
        <div className="demo-code-line">
          <span className="ln">44</span>
          <span>&nbsp;&nbsp;return route(request, context);</span>
        </div>
        <div className="demo-code-actions">
          <span>Open evidence</span>
          <span>Trace callers</span>
          <span>Ask why</span>
        </div>
      </div>
    </div>
  );
}

function FinalArt({ stats }: { stats?: Analysis["stats"] }) {
  const cards = [
    { symbol: "◎", title: "Overview", meta: stats ? `${fmt(stats.files)} files` : "orientation" },
    { symbol: "◌", title: "Cloud", meta: stats ? `${fmt(stats.symbols)} symbols` : "architecture" },
    { symbol: "↗", title: "Flows", meta: stats ? `${fmt(stats.endpoints)} routes` : "execution" },
    { symbol: "?", title: "Ask AI", meta: "source-linked answers" },
  ];

  return (
    <div className="demo-final-art" aria-hidden>
      <div className="demo-final-cloud">
        <CloudLogo size={86} />
      </div>
      <div className="demo-final-grid">
        {cards.map((card) => (
          <span className="demo-final-card" key={card.title}>
            <span className="demo-final-symbol">{card.symbol}</span>
            <strong>{card.title}</strong>
            <small>{card.meta}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
