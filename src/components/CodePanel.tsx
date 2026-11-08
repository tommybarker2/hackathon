import { useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "../../shared/types";
import { fetchFile } from "../api";
import { langLabel } from "../format";

interface Props {
  analysis: Analysis;
  file: string;
  line?: number;
  onClose: () => void;
  onOpenFile: (path: string, line?: number) => void;
  onImpact: (symbolId: string) => void;
  onTrace: (symbolId: string) => void;
  onAsk: (question: string) => void;
}

export function CodePanel({
  analysis,
  file,
  line,
  onClose,
  onOpenFile,
  onImpact,
  onTrace,
  onAsk,
}: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hitRef = useRef<HTMLDivElement | null>(null);

  const meta = analysis.files.find((f) => f.path === file);
  const symbols = useMemo(
    () => analysis.symbols.filter((s) => s.file === file).sort((a, b) => a.line - b.line),
    [analysis.symbols, file],
  );
  const callCounts = useMemo(() => {
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const edge of analysis.callEdges) {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
      outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
    }
    return { incoming, outgoing };
  }, [analysis.callEdges]);

  const activeSymbol = useMemo(() => {
    if (line === undefined) return undefined;
    const containing = symbols.filter((s) => s.line <= line && s.endLine >= line);
    return containing.sort((a, b) => a.loc - b.loc)[0];
  }, [symbols, line]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    fetchFile(analysis.id, file)
      .then((res) => {
        if (!cancelled) setContent(res.content);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysis.id, file]);

  useEffect(() => {
    if (content && hitRef.current) {
      hitRef.current.scrollIntoView({ block: "center" });
    }
  }, [content, line]);

  const lines = content ? content.split("\n") : [];
  const maxLines = 2600;
  const shown = lines.slice(0, maxLines);

  return (
    <aside className="code-panel">
      <div className="code-head">
        <div>
          <div className="eyebrow">Code inspector</div>
          <h3 title={file}>{file}</h3>
          {meta && <p className="code-summary">{meta.summary}</p>}
        </div>
        <button type="button" className="icon-button" onClick={onClose} title="Close inspector">
          ✕
        </button>
      </div>

      <div className="code-meta">
        {meta && <span className="chip">{langLabel(meta.lang)}</span>}
        {meta && <span className="chip">{meta.loc} lines</span>}
        {meta && meta.commits > 0 && <span className="chip">{meta.commits} commits</span>}
        {meta?.lastDate && <span className="chip">touched {meta.lastDate}</span>}
        {meta && meta.imports.length > 0 && <span className="chip">{meta.imports.length} imports</span>}
        {meta && meta.endpoints.length > 0 && (
          <span className="chip accent">{meta.endpoints.length} routes</span>
        )}
      </div>

      <div className="code-actions">
        <button
          type="button"
          className="ghost small"
          disabled={!activeSymbol}
          onClick={() => activeSymbol && onImpact(activeSymbol.id)}
          title={activeSymbol ? `Impact of ${activeSymbol.name}` : "Place the cursor on a symbol"}
        >
          Blast radius
        </button>
        <button
          type="button"
          className="ghost small"
          disabled={!activeSymbol}
          onClick={() => activeSymbol && onTrace(activeSymbol.id)}
        >
          Trace flow
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => onAsk(`How does ${file} work, and what does it depend on?`)}
        >
          Ask about file
        </button>
      </div>

      {activeSymbol && (
        <div className="active-symbol">
          In focus: <strong>{activeSymbol.name}</strong> · {activeSymbol.kind} ·{" "}
          {callCounts.incoming.get(activeSymbol.id) ?? 0} callers ·{" "}
          {callCounts.outgoing.get(activeSymbol.id) ?? 0} callees
        </div>
      )}

      {meta && meta.endpoints.length > 0 && (
        <div className="endpoint-list">
          {meta.endpoints.map((endpoint, index) => (
            <button
              key={`${endpoint.method}-${endpoint.path}-${index}`}
              type="button"
              className="endpoint"
              onClick={() => onOpenFile(endpoint.file, endpoint.line)}
            >
              <span className={`method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
              <span className="endpoint-path">{endpoint.path}</span>
              <span className="endpoint-line">{endpoint.line}</span>
            </button>
          ))}
        </div>
      )}

      {symbols.length > 0 && (
        <div className="symbol-chips">
          {symbols.slice(0, 14).map((symbol) => (
            <button
              key={symbol.id}
              type="button"
              className={`symbol-chip ${activeSymbol?.id === symbol.id ? "active" : ""}`}
              onClick={() => onOpenFile(symbol.file, symbol.line)}
              title={`${symbol.kind} · ${symbol.loc} lines`}
            >
              {symbol.name}
            </button>
          ))}
        </div>
      )}

      <div className="code-body">
        {loading && <div className="code-placeholder">Loading source…</div>}
        {error && <div className="code-placeholder error">{error}</div>}
        {!loading && !error && content !== null && (
          <>
            {shown.map((text, index) => {
              const lineNumber = index + 1;
              const isHit = line === lineNumber;
              const inSymbol =
                activeSymbol !== undefined &&
                lineNumber >= activeSymbol.line &&
                lineNumber <= activeSymbol.endLine;
              return (
                <div
                  key={lineNumber}
                  ref={isHit ? hitRef : undefined}
                  className={`code-line ${isHit ? "hit" : ""} ${inSymbol ? "in-symbol" : ""}`}
                >
                  <span className="ln">{lineNumber}</span>
                  <span className="src">{text === "" ? " " : text}</span>
                </div>
              );
            })}
            {lines.length > maxLines && (
              <div className="code-placeholder">
                Showing the first {maxLines} of {lines.length} lines.
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
