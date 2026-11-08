import { useEffect, useRef, useState } from "react";
import type { Analysis, ImpactResponse } from "../shared/types";
import { analyzeImpact, analyzeRepo, getConfig } from "./api";
import { AskView } from "./components/AskView";
import { CodePanel } from "./components/CodePanel";
import { DebtView } from "./components/DebtView";
import { FlowsView } from "./components/FlowsView";
import { MapView } from "./components/MapView";
import { Meeple } from "./components/Meeple";
import { OverviewView } from "./components/OverviewView";
import { fmt } from "./format";

type Tab = "overview" | "map" | "ask" | "flows" | "debt";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "map", label: "Architecture" },
  { id: "ask", label: "Ask AI" },
  { id: "flows", label: "Flows" },
  { id: "debt", label: "Debt" },
];

export default function App() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [seen, setSeen] = useState<Set<Tab>>(new Set<Tab>(["overview"]));
  const [inspect, setInspect] = useState<{ file: string; line?: number } | null>(null);
  const [highlight, setHighlight] = useState<{ files: string[]; label: string } | null>(null);
  const [impact, setImpact] = useState<ImpactResponse | null>(null);
  const [engine, setEngine] = useState({ llm: false, model: "gpt-4o-mini" });
  const [source, setSource] = useState<"local" | "github">("local");
  const [localPath, setLocalPath] = useState(".");
  const [githubUrl, setGithubUrl] = useState("");
  const [pendingAsk, setPendingAsk] = useState<{ question: string; nonce: number }>();
  const [flowSeed, setFlowSeed] = useState<{ symbolId?: string; query?: string; nonce: number }>();
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void run({ source: "local", path: "." });
    getConfig()
      .then((config) => setEngine({ llm: config.llm, model: config.model }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSeen((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);

  async function run(input?: { source: "local" | "github"; path?: string; url?: string }) {
    const payload =
      input ??
      (source === "local"
        ? { source: "local" as const, path: localPath.trim() || "." }
        : { source: "github" as const, url: githubUrl.trim() });

    if (payload.source === "github" && !payload.url) {
      setError("Paste a GitHub repository URL first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await analyzeRepo(payload);
      setAnalysis(result.analysis);
      setInspect(null);
      setImpact(null);
      setHighlight(null);
      setPendingAsk(undefined);
      setFlowSeed(undefined);
      setSeen(new Set<Tab>(["overview"]));
      setTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function openFile(file: string, line?: number) {
    setInspect({ file, line });
  }

  function openSymbol(symbolId: string) {
    const symbol = analysis?.symbols.find((s) => s.id === symbolId);
    if (symbol) setInspect({ file: symbol.file, line: symbol.line });
  }

  function ask(question: string) {
    setPendingAsk({ question, nonce: Date.now() });
    setTab("ask");
  }

  function traceSymbol(symbolId: string) {
    setFlowSeed({ symbolId, nonce: Date.now() });
    setTab("flows");
  }

  async function runImpact(symbolId: string) {
    if (!analysis) return;
    try {
      const result = await analyzeImpact(analysis.id, symbolId);
      setImpact(result);
      setHighlight({
        files: result.affectedFiles,
        label: `Blast radius · ${result.symbol?.name ?? "symbol"}`,
      });
      setTab("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const showInspector = Boolean(analysis && inspect);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Meeple size={26} />
          </span>
          <span className="brand-text">
            <strong>Code Archaeologist</strong>
            <span>Understand any codebase.</span>
          </span>
        </div>

        <div className="repo-controls">
          <div className="segmented">
            <button
              type="button"
              className={source === "local" ? "active" : ""}
              onClick={() => setSource("local")}
            >
              This app
            </button>
            <button
              type="button"
              className={source === "github" ? "active" : ""}
              onClick={() => setSource("github")}
            >
              GitHub
            </button>
          </div>
          {source === "local" ? (
            <input
              className="path-input"
              value={localPath}
              onChange={(event) => setLocalPath(event.target.value)}
              spellCheck={false}
              title="Path to a local repository"
              aria-label="Local repository path"
            />
          ) : (
            <input
              className="path-input wide"
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.target.value)}
              placeholder="https://github.com/owner/repo"
              spellCheck={false}
              aria-label="GitHub repository URL"
              onKeyDown={(event) => {
                if (event.key === "Enter") void run();
              }}
            />
          )}
          <button type="button" className="primary" onClick={() => void run()} disabled={busy}>
            {busy ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </header>

      {analysis && (
        <>
          <div className="subbar">
            <span className="repo-pill">
              {analysis.source.kind === "github" ? "GitHub" : "Local"} · {analysis.source.label}
            </span>
            {analysis.source.url && (
              <a className="ghost-link" href={analysis.source.url} target="_blank" rel="noreferrer">
                Open on GitHub ↗
              </a>
            )}
            <div className="badges">
              <span className="badge">{analysis.stats.files} files</span>
              <span className="badge">{fmt(analysis.stats.loc)} LOC</span>
              <span className="badge">{analysis.stats.symbols} symbols</span>
              <span className="badge">{analysis.stats.endpoints} routes</span>
              <span className="badge">{analysis.stats.dbOps} DB ops</span>
            </div>
            <span className="engine-badge">
              {engine.llm ? `LLM · ${engine.model}` : "Deterministic engine"}
            </span>
          </div>

          <nav className="tabs">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`tab ${tab === item.id ? "active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                {item.id === "debt" && analysis.issues.length > 0 && (
                  <span className="tab-count">{analysis.issues.length}</span>
                )}
              </button>
            ))}
          </nav>
        </>
      )}

      <div className="workspace">
        <main className="content">
          {!analysis && (
            <div className="loading-screen">
              <div className="loading-figure">
                <Meeple size={124} hat />
              </div>
              <div className="loading-bubble">
                {busy ? (
                  <>
                    <h2>Excavating the repository…</h2>
                    <p>
                      Reading files, parsing symbols, resolving imports, inferring call edges and
                      reading the git history.
                    </p>
                    <div className="loading-bar">
                      <span />
                    </div>
                  </>
                ) : (
                  <>
                    <h2>Analysis failed</h2>
                    <p>{error ?? "The repository could not be analysed."}</p>
                    <button type="button" className="primary" onClick={() => void run()}>
                      Try again
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {analysis && (
            <>
              {seen.has("overview") && (
                <div className="tab-panel" style={{ display: tab === "overview" ? "block" : "none" }}>
                  <OverviewView
                    analysis={analysis}
                    onOpenFile={openFile}
                    onAsk={ask}
                    onTrace={() => setTab("flows")}
                  />
                </div>
              )}

              {seen.has("map") && (
                <div className="tab-panel" style={{ display: tab === "map" ? "block" : "none" }}>
                  <MapView
                    analysis={analysis}
                    selectedFile={inspect?.file}
                    highlight={highlight}
                    impact={impact}
                    onSelectFile={(path) => openFile(path)}
                    onOpenFile={openFile}
                    onClearImpact={() => {
                      setImpact(null);
                      setHighlight(null);
                    }}
                    onClearHighlight={() => setHighlight(null)}
                    onAsk={ask}
                  />
                </div>
              )}

              {seen.has("ask") && (
                <div className="tab-panel" style={{ display: tab === "ask" ? "block" : "none" }}>
                  <AskView
                    key={analysis.id}
                    analysis={analysis}
                    pending={pendingAsk}
                    onOpenFile={openFile}
                  />
                </div>
              )}

              {seen.has("flows") && (
                <div className="tab-panel" style={{ display: tab === "flows" ? "block" : "none" }}>
                  <FlowsView
                    key={analysis.id}
                    analysis={analysis}
                    seed={flowSeed}
                    onOpenFile={openFile}
                    onHighlight={(files, label) => {
                      setHighlight({ files, label });
                      setTab("map");
                    }}
                  />
                </div>
              )}

              {seen.has("debt") && (
                <div className="tab-panel" style={{ display: tab === "debt" ? "block" : "none" }}>
                  <DebtView analysis={analysis} onOpenFile={openFile} />
                </div>
              )}
            </>
          )}
        </main>

        {analysis && showInspector && inspect && (
          <CodePanel
            analysis={analysis}
            file={inspect.file}
            line={inspect.line}
            onClose={() => setInspect(null)}
            onOpenFile={openFile}
            onImpact={(symbolId) => void runImpact(symbolId)}
            onTrace={traceSymbol}
            onAsk={ask}
          />
        )}
      </div>

      {error && analysis && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-button" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
