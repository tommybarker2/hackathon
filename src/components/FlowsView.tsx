import { useEffect, useRef, useState } from "react";
import type { Analysis, FlowResponse } from "../../shared/types";
import { traceFlow } from "../api";
import { symbolTooltip } from "../format";
import { TopicPicker } from "./TopicPicker";

interface Props {
  analysis: Analysis;
  seed?: { symbolId?: string; query?: string; nonce: number };
  onOpenFile: (path: string, line?: number) => void;
  onHighlight: (files: string[], label: string) => void;
}

function flowStepTooltip(analysis: Analysis, step: FlowResponse["steps"][number]): string {
  const symbol = analysis.symbols.find((candidate) =>
    step.symbolId
      ? candidate.id === step.symbolId
      : candidate.name === step.name && candidate.file === step.file,
  );
  return symbol
    ? symbolTooltip(symbol)
    : `${step.name} — ${step.kind} in ${step.file}:${step.line}`;
}

export function FlowsView({ analysis, seed, onOpenFile, onHighlight }: Props) {
  // Prefer a route with real downstream calls: a GET /health flow is a boring first impression.
  const endpoints = analysis.files.flatMap((f) => f.endpoints);
  const firstEndpoint =
    endpoints.find(
      (endpoint) =>
        endpoint.handler && analysis.callEdges.some((edge) => edge.from === endpoint.handler),
    ) ?? endpoints[0];
  const initialQuery = firstEndpoint ? `${firstEndpoint.method} ${firstEndpoint.path}` : "application startup";
  const [query, setQuery] = useState(seed?.query ?? initialQuery);
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const booted = useRef(false);
  const lastSeed = useRef(0);

  async function run(nextQuery: string, symbolId?: string) {
    if (!nextQuery.trim() && !symbolId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await traceFlow(analysis.id, symbolId ? { symbolId } : { query: nextQuery });
      setFlow(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (seed?.symbolId) {
      lastSeed.current = seed.nonce;
      void run("selected symbol", seed.symbolId);
    } else if (seed?.query) {
      lastSeed.current = seed.nonce;
      void run(seed.query);
    } else {
      void run(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!seed || seed.nonce === lastSeed.current) return;
    lastSeed.current = seed.nonce;
    if (seed.symbolId) {
      setQuery(seed.query ?? "selected symbol");
      void run(seed.query ?? "selected symbol", seed.symbolId);
    } else if (seed.query) {
      setQuery(seed.query);
      void run(seed.query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  return (
    <div className="flow-view">
      <div className="ask-head">
        <div>
          <h2>Execution flows</h2>
          <p className="muted">
            Ask what happens during a behaviour. The tracer walks the parsed call graph and shows
            each hop.
          </p>
        </div>
        <span className="engine-badge inline">static inference</span>
      </div>

      <form
        className="flow-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(query);
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="What happens when a user logs in?"
        />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Tracing…" : "Trace flow"}
        </button>
      </form>

      <TopicPicker
        analysis={analysis}
        actionLabel="Trace"
        disabled={busy}
        onPick={(question, symbolId) => {
          setQuery(question);
          void run(question, symbolId);
        }}
      />

      {error && <div className="inline-error">{error}</div>}

      {flow && (
        <div className="flow-result card">
          <div className="flow-result-head">
            <div>
              <p className="eyebrow">Traced path</p>
              <h3>{flow.title}</h3>
              <p className="muted">{flow.explanation}</p>
            </div>
          </div>

          {flow.steps.length > 0 ? (
            <>
              <ol className="flow">
                {flow.steps.map((step, index) => (
                  <li
                    key={`${step.name}-${step.file}-${index}`}
                    className="flow-step"
                    style={{ paddingLeft: `${Math.min(step.depth, 5) * 16}px` }}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenFile(step.file, step.line)}
                      className="flow-button"
                      title={flowStepTooltip(analysis, step)}
                    >
                      <span className="flow-index">{index + 1}</span>
                      <span className="flow-body">
                        <span className="flow-name">
                          {step.name}
                          <span className={`kind kind-${step.kind}`}>{step.kind}</span>
                        </span>
                        <span className="flow-file">
                          {step.file}:{step.line} · {step.note}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="flow-actions">
                <button
                  type="button"
                  className="ghost small"
                  onClick={() =>
                    onHighlight(
                      [...new Set(flow.steps.map((step) => step.file))],
                      `Flow · ${flow.title}`,
                    )
                  }
                >
                  Highlight this path on the map
                </button>
                <span className="muted small-text">
                  Static call edges — not a runtime trace. Unresolved dynamic calls are omitted.
                </span>
              </div>
            </>
          ) : (
            <p className="empty">{flow.explanation}</p>
          )}
        </div>
      )}
    </div>
  );
}
