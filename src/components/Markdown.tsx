import type { ReactNode } from "react";

interface Props {
  text: string;
  onCitation?: (file: string, line: number) => void;
}

const CITATION = /\[([^\]\n]+?):(\d+)(?:-(\d+))?\]/;

function inline(text: string, onCitation: Props["onCitation"], keyPrefix: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_|\[[^\]\n]+?:\d+(?:-\d+)?\])/g);
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return <strong key={key}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return <code key={key}>{token.slice(1, -1)}</code>;
    }
    if (token.startsWith("_") && token.endsWith("_") && token.length > 2) {
      return (
        <em key={key} className="muted">
          {token.slice(1, -1)}
        </em>
      );
    }
    const citation = token.match(CITATION);
    if (citation) {
      const file = citation[1];
      const line = Number(citation[2]);
      return (
        <button
          key={key}
          type="button"
          className="cite"
          title={`Open ${file}:${line}`}
          onClick={() => onCitation?.(file, line)}
        >
          {file.split("/").slice(-2).join("/")}:{line}
        </button>
      );
    }
    return <span key={key}>{token}</span>;
  });
}

export function Markdown({ text, onCitation }: Props) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let bullets: string[] = [];
  let ordered: string[] = [];

  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {bullets.map((item, index) => (
            <li key={index}>{inline(item, onCitation, `b-${blocks.length}-${index}`)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
    if (ordered.length) {
      blocks.push(
        <ol key={`ol-${blocks.length}`}>
          {ordered.map((item, index) => (
            <li key={index}>{inline(item, onCitation, `o-${blocks.length}-${index}`)}</li>
          ))}
        </ol>,
      );
      ordered = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      ordered.push(numbered[1]);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const content = inline(heading[2], onCitation, `h-${blocks.length}`);
      blocks.push(
        heading[1].length <= 2 ? (
          <h3 key={`h-${blocks.length}`}>{content}</h3>
        ) : (
          <h4 key={`h-${blocks.length}`}>{content}</h4>
        ),
      );
      continue;
    }
    flush();
    blocks.push(
      <p key={`p-${blocks.length}`}>{inline(line, onCitation, `p-${blocks.length}`)}</p>,
    );
  }
  flush();

  return <div className="markdown">{blocks}</div>;
}
