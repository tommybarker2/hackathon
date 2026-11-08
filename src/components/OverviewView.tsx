import { useMemo } from "react";
import type { Analysis, CommitInfo } from "../../shared/types";
import { fmt, langLabel, LANG_COLORS } from "../format";

interface Props {
  analysis: Analysis;
  onOpenFile: (path: string, line?: number) => void;
  onAsk: (question: string) => void;
  onTrace: () => void;
  onLoadCommit: (commit: CommitInfo) => void;
  busy: boolean;
}

export function OverviewView({
  analysis,
  onOpenFile,
  onAsk,
  onTrace,
  onLoadCommit,
  busy,
}: Props) {
  const fanIn = useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of analysis.fileEdges) map.set(edge.to, (map.get(edge.to) ?? 0) + 1);
    return map;
  }, [analysis.fileEdges]);

  const topModules = useMemo(
    () =>
      [...analysis.files]
        .filter((f) => f.presence === "code")
        .sort((a, b) => (fanIn.get(b.path) ?? 0) - (fanIn.get(a.path) ?? 0) || b.loc - a.loc)
        .slice(0, 6),
    [analysis.files, fanIn],
  );

  const hotspots = useMemo(
    () =>
      [...analysis.files]
        .filter((f) => f.churn > 0)
        .sort((a, b) => b.churn - a.churn)
        .slice(0, 6),
    [analysis.files],
  );

  const entryFiles = analysis.entryPoints
    .map((path) => analysis.files.find((f) => f.path === path))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));

  const maxLoc = Math.max(1, ...analysis.stats.languages.map((l) => l.loc));

  return (
    <div className="overview">
      <section className="hero card">
        <div>
          <p className="eyebrow">Repository map</p>
          <h2>{analysis.source.label}</h2>
          <p className="lede">
            {fmt(analysis.stats.files)} files · {fmt(analysis.stats.loc)} lines ·{" "}
            {analysis.stats.symbols} symbols · {analysis.stats.endpoints} routes
            {analysis.source.ref
              ? ` · snapshot ${analysis.source.ref}`
              : analysis.source.branch
                ? ` · ${analysis.source.branch}`
                : ""}
          </p>
          <p className="muted small-text">
            {analysis.source.ref
              ? [analysis.source.refSubject, analysis.source.refDate].filter(Boolean).join(" · ")
              : analysis.source.kind === "github"
                ? analysis.source.url
                : "Local working tree"}{" "}
            · analysed {new Date(analysis.analyzedAt).toLocaleTimeString()}
          </p>
        </div>
        <div className="hero-actions">
          <button type="button" className="primary" onClick={onTrace}>
            Trace an execution flow
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onAsk("Give me an architecture overview of this repository.")}
          >
            Ask for an overview
          </button>
        </div>
      </section>

      <div className="stat-grid">
        <Stat label="Files" value={fmt(analysis.stats.files)} />
        <Stat label="Lines of code" value={fmt(analysis.stats.loc)} />
        <Stat label="Symbols" value={fmt(analysis.stats.symbols)} />
        <Stat label="HTTP routes" value={fmt(analysis.stats.endpoints)} />
        <Stat label="DB operations" value={fmt(analysis.stats.dbOps)} />
        <Stat
          label={analysis.stats.gitAvailable ? "Commits read" : "Symbols with calls"}
          value={fmt(
            analysis.stats.gitAvailable ? analysis.stats.commits : analysis.callEdges.length,
          )}
        />
      </div>

      <div className="two-col">
        <section className="card">
          <div className="section-head">
            <h3>Start here</h3>
            <span className="muted">Entry points &amp; wiring</span>
          </div>
          {entryFiles.length ? (
            <div className="list">
              {entryFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className="list-row"
                  onClick={() => onOpenFile(file.path, 1)}
                >
                  <span className="row-title">{file.path}</span>
                  <span className="row-sub">{file.summary}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty">No obvious entry point — open the Cloud map to explore.</p>
          )}
        </section>

        <section className="card">
          <div className="section-head">
            <h3>Most depended-on modules</h3>
            <span className="muted">Fan-in</span>
          </div>
          <div className="list">
            {topModules.map((file) => {
              const count = fanIn.get(file.path) ?? 0;
              return (
                <button
                  key={file.path}
                  type="button"
                  className="list-row"
                  onClick={() => onOpenFile(file.path, 1)}
                >
                  <span className="row-title">{file.path}</span>
                  <span className="row-sub">
                    imported by {count} module{count === 1 ? "" : "s"} · {file.loc} lines
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="section-head">
            <h3>Languages</h3>
            <span className="muted">{analysis.stats.languages.length} detected</span>
          </div>
          <div className="lang-bars">
            {analysis.stats.languages.slice(0, 7).map((language) => (
              <div className="lang-row" key={language.lang}>
                <span className="lang-name">{langLabel(language.lang)}</span>
                <span className="bar">
                  <span
                    className="bar-fill"
                    style={{
                      width: `${Math.max(3, (language.loc / maxLoc) * 100)}%`,
                      background: LANG_COLORS[language.lang] ?? "#8b98a9",
                    }}
                  />
                </span>
                <span className="lang-value">{fmt(language.loc)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <h3>Hotspots</h3>
            <span className="muted">Churn from git</span>
          </div>
          {hotspots.length ? (
            <div className="list">
              {hotspots.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className="list-row"
                  onClick={() => onOpenFile(file.path, 1)}
                >
                  <span className="row-title">{file.path}</span>
                  <span className="row-sub">
                    {file.commits} commits · {fmt(file.churn)} lines changed
                    {file.lastDate ? ` · last ${file.lastDate}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty">No local git history — analyze a local clone to unlock churn analysis.</p>
          )}
        </section>
      </div>

      <section className="card">
        <div className="section-head">
          <h3>Recent archaeology</h3>
          <span className="muted">
            {analysis.source.ref ? "Older commits from this snapshot" : "Pick a commit to load that version"}
          </span>
        </div>
        {analysis.commits.length ? (
          <div className="commit-list">
            {analysis.commits.slice(0, 8).map((commit) => {
              const current = Boolean(analysis.source.ref) && analysis.source.ref === commit.hash;
              return (
                <button
                  type="button"
                  className={`commit${current ? " current" : ""}`}
                  key={`${commit.hash}-${commit.subject}`}
                  onClick={() => onLoadCommit(commit)}
                  disabled={busy || current}
                  title={
                    current
                      ? "This commit is already loaded"
                      : "Analyze the repository at this commit"
                  }
                >
                  <span className="commit-hash">{commit.hash}</span>
                  <span className="commit-subject">{commit.subject}</span>
                  <span className="commit-meta">
                    <span>
                      {commit.author} · {commit.date}
                      {commit.files ? ` · ${commit.files} files` : ""}
                    </span>
                    <span className="commit-action">
                      {current ? "Viewing" : busy ? "Working…" : "Load →"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="empty">
            Commit history is not available for this source. For local clones the app reads{" "}
            <code>git log --numstat</code> directly.
          </p>
        )}
      </section>

      <section className="card notes">
        <div className="section-head">
          <h3>How this map was produced</h3>
          <span className="muted">Be honest about limits</span>
        </div>
        <ul>
          {analysis.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat card">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
