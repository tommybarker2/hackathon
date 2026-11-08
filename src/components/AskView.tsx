import { useEffect, useMemo, useRef, useState } from "react";
import type { Analysis, Citation } from "../../shared/types";
import { askQuestion } from "../api";
import { Markdown } from "./Markdown";

interface Props {
  analysis: Analysis;
  pending?: { question: string; nonce: number };
  onOpenFile: (path: string, line?: number) => void;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  mode?: "local" | "llm";
  error?: boolean;
}

export function AskView({ analysis, pending, onOpenFile }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text:
        `**I have mapped ${analysis.source.label}.** ${analysis.stats.files} files, ` +
        `${analysis.stats.symbols} symbols and ${analysis.stats.endpoints} HTTP routes.\n\n` +
        "Ask me how something works, where a behaviour lives, or what depends on a function. " +
        "Answers about code cite real files and line numbers — click any citation to open the source.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastPending = useRef(0);

  const suggestions = useMemo(() => {
    const endpoints = analysis.files.flatMap((f) => f.endpoints).slice(0, 3);
    const list = endpoints.map((e) => `What happens when ${e.method} ${e.path} is called?`);
    if (analysis.files.some((f) => /analy/i.test(f.path))) {
      list.push("How does the analysis pipeline work?");
    }
    list.push("Where is application state maintained?");
    return list.slice(0, 4);
  }, [analysis]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setBusy(true);
    try {
      const res = await askQuestion(analysis.id, trimmed);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: res.answer, citations: res.citations, mode: res.mode },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: error instanceof Error ? error.message : String(error),
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!pending || pending.nonce === lastPending.current) return;
    lastPending.current = pending.nonce;
    void send(pending.question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.nonce]);

  return (
    <div className="ask-view">
      <div className="ask-head">
        <div>
          <h2>Ask the repository</h2>
          <p className="muted">
            Retrieval over {analysis.stats.symbols} parsed symbols. Code answers carry a source
            location.
          </p>
        </div>
        <span className="engine-badge inline">
          {analysis.source.label} · {analysis.stats.loc.toLocaleString()} LOC
        </span>
      </div>

      <div className="chat" ref={scrollRef}>
        {messages.map((message, index) => (
          <div key={index} className={`bubble-row ${message.role}`}>
            {message.role === "assistant" && <div className="avatar">CA</div>}
            <div className={`bubble ${message.role} ${message.error ? "error" : ""}`}>
              {message.role === "assistant" ? (
                <Markdown text={message.text} onCitation={onOpenFile} />
              ) : (
                <p>{message.text}</p>
              )}
              {message.citations && message.citations.length > 0 && (
                <div className="citations">
                  <span className="citations-label">
                    Evidence {message.mode === "llm" ? "· LLM" : "· retrieved"}
                  </span>
                  {message.citations.map((citation, i) => (
                    <button
                      key={`${citation.file}-${citation.line}-${i}`}
                      type="button"
                      className="cite"
                      onClick={() => onOpenFile(citation.file, citation.line)}
                    >
                      {citation.file.split("/").slice(-2).join("/")}:{citation.line}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="bubble-row assistant">
            <div className="avatar">CA</div>
            <div className="bubble assistant thinking">
              <span className="pulse" />
              Searching symbols, call edges and source lines…
            </div>
          </div>
        )}
      </div>

      <div className="suggestions">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="suggestion"
            disabled={busy}
            onClick={() => void send(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="e.g. What happens when the analyze endpoint is called?"
          rows={2}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
        />
        <button type="submit" className="primary" disabled={busy || !input.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
