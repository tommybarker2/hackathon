import type { Analysis, Issue } from "../../shared/types";

interface Props {
  analysis: Analysis;
  onOpenFile: (path: string, line?: number) => void;
}

const KIND_LABELS: Record<string, string> = {
  "god-file": "God file",
  "long-function": "Long function",
  "circular-dependency": "Circular dependency",
  "unused-symbol": "Unused symbol",
  "high-coupling": "High coupling",
};

export function DebtView({ analysis, onOpenFile }: Props) {
  const { issues } = analysis;
  const high = issues.filter((i) => i.severity === "high");
  const medium = issues.filter((i) => i.severity === "medium");
  const low = issues.filter((i) => i.severity === "low");

  return (
    <div className="debt">
      <div className="ask-head">
        <div>
          <h2>Technical debt</h2>
          <p className="muted">
            Structural smells found by static rules — each one links to the evidence in source.
          </p>
        </div>
        <div className="debt-counts">
          <span className="severity high">{high.length} high</span>
          <span className="severity medium">{medium.length} medium</span>
          <span className="severity low">{low.length} low</span>
        </div>
      </div>

      {issues.length === 0 && (
        <div className="card empty-card">
          Nothing structural stood out. That is a good sign — or a sign that the repository is small.
        </div>
      )}

      {[...high, ...medium, ...low].map((issue) => (
        <IssueCard key={issue.id} issue={issue} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}

function IssueCard({ issue, onOpenFile }: { issue: Issue; onOpenFile: Props["onOpenFile"] }) {
  return (
    <article className="card issue-card">
      <div className="issue-head">
        <span className={`severity ${issue.severity}`}>{issue.severity}</span>
        <span className="issue-kind">{KIND_LABELS[issue.kind] ?? issue.kind}</span>
        <span className="issue-file">
          {issue.file}:{issue.line}
        </span>
      </div>
      <h3>{issue.title}</h3>
      <p>{issue.detail}</p>
      <div className="issue-foot">
        <div className="evidence">
          {issue.evidence.slice(0, 6).map((item, index) => (
            <span className="chip" key={`${item}-${index}`}>
              {item}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="ghost small"
          onClick={() => onOpenFile(issue.file, issue.line)}
        >
          Open evidence
        </button>
      </div>
    </article>
  );
}
