import type { Analysis, ImpactResponse } from "../../shared/types";
import { symbolTooltip } from "../format";
import { Graph } from "./Graph";

interface Props {
  analysis: Analysis;
  selectedFile?: string;
  highlight: { files: string[]; label: string } | null;
  impact: ImpactResponse | null;
  onSelectFile: (path: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  onClearImpact: () => void;
  onClearHighlight: () => void;
  onAsk: (question: string) => void;
}

export function MapView({
  analysis,
  selectedFile,
  highlight,
  impact,
  onSelectFile,
  onOpenFile,
  onClearImpact,
  onClearHighlight,
  onAsk,
}: Props) {
  return (
    <div className="map-view">
      <div className="ask-head compact">
        <div>
          <h2>Cloud</h2>
          <p className="muted">
            Files gather in purpose bubbles — parser, graph, format, UI — with import lines showing
            how those areas connect. Node size follows file size.
          </p>
        </div>
        {highlight && (
          <div className="highlight-banner">
            <span>{highlight.label}</span>
            <span className="muted">{highlight.files.length} files</span>
            <button type="button" className="icon-button" onClick={onClearHighlight} title="Clear highlight">
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="map-body">
        <Graph
          analysis={analysis}
          selectedFile={selectedFile}
          highlightFiles={highlight?.files ?? []}
          onSelectFile={onSelectFile}
        />

        {impact && (
          <div className="impact-card card">
            <div className="impact-head">
              <div>
                <p className="eyebrow">Blast radius</p>
                <h3 title={impact.symbol ? symbolTooltip(impact.symbol) : undefined}>
                  {impact.symbol?.name ?? "No symbol"}
                </h3>
              </div>
              <button type="button" className="icon-button" onClick={onClearImpact}>
                ✕
              </button>
            </div>
            <p>{impact.summary}</p>

            {impact.affectedSymbols.length > 0 && (
              <div className="impact-section">
                <span className="impact-label">Affected symbols</span>
                <div className="chips">
                  {impact.affectedSymbols.slice(0, 12).map((symbol) => (
                    <button
                      key={symbol.id}
                      type="button"
                      className="chip clickable"
                      onClick={() => onOpenFile(symbol.file, symbol.line)}
                      title={symbolTooltip(symbol)}
                    >
                      {symbol.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {impact.endpoints.length > 0 && (
              <div className="impact-section">
                <span className="impact-label">Endpoints in range</span>
                <div className="chips">
                  {impact.endpoints.slice(0, 10).map((endpoint) => (
                    <button
                      key={`${endpoint.method}-${endpoint.path}-${endpoint.file}`}
                      type="button"
                      className="chip clickable"
                      onClick={() => onOpenFile(endpoint.file, endpoint.line)}
                    >
                      {endpoint.method} {endpoint.path}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="impact-section">
              <span className="impact-label">Tests</span>
              {impact.tests.length ? (
                <div className="chips">
                  {impact.tests.map((test) => (
                    <button
                      key={test}
                      type="button"
                      className="chip clickable"
                      onClick={() => onOpenFile(test, 1)}
                    >
                      {test.split("/").slice(-1)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted small-text">No test files in the affected area.</p>
              )}
            </div>

            <div className="impact-actions">
              <button
                type="button"
                className="ghost small"
                onClick={() =>
                  onAsk(
                    `What would break if I changed ${impact.symbol?.name ?? "this symbol"}? Walk through the affected callers.`,
                  )
                }
              >
                Ask follow-up
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
