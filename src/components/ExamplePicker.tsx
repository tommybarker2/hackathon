import { useEffect, useRef } from "react";
import { EXAMPLES, type ExampleRepo } from "../examples";

interface Props {
  open: boolean;
  busy: boolean;
  staticMode?: boolean;
  onClose: () => void;
  onPick: (example: ExampleRepo) => void;
}

export function ExamplePicker({ open, busy, staticMode = false, onClose, onPick }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="example-modal" role="dialog" aria-modal="true" aria-labelledby="examples-title">
        <div className="example-head">
          <div>
            <p className="eyebrow">Example expeditions</p>
            <h2 id="examples-title">Start with a repository</h2>
            <p>
              {staticMode
                ? "Load one of the repositories analyzed into this static build. Each snapshot comes from real source files, never mocked."
                : "Load a baked-in example instantly, or paste any public GitHub URL into the source bar — it switches modes automatically. Everything is read from real files, never mocked."}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close examples"
          >
            ✕
          </button>
        </div>

        <div className="example-grid">
          {EXAMPLES.map((example) => (
            <button
              key={example.id}
              type="button"
              className="example-card"
              disabled={busy}
              onClick={() => onPick(example)}
            >
              <span className="example-top">
                <span
                  className="example-dot"
                  style={{ background: `var(${example.accent})` }}
                  aria-hidden
                />
                <span className="example-name">{example.name}</span>
                {example.kind === "local" && <span className="example-tag">local</span>}
              </span>
              <span className="example-repo">{example.owner}</span>
              <span className="example-blurb">{example.blurb}</span>
              <span className="example-foot">
                <span>{example.lang}</span>
                <strong>{busy ? "Working…" : "Analyze →"}</strong>
              </span>
            </button>
          ))}
        </div>

        <p className="example-note">
          {staticMode
            ? "Static Pages demo: these six snapshots were analyzed at build time. Run the app locally for arbitrary GitHub or local imports."
            : "Public GitHub repositories only. Unauthenticated imports share a 60 requests/hour API limit; set GITHUB_TOKEN to raise it."}
        </p>
      </div>
    </div>
  );
}
