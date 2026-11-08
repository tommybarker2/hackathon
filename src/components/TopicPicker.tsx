import { useEffect, useMemo, useState } from "react";
import type { Analysis, RepoSymbol } from "../../shared/types";

const GROUPS = ["Pipelines", "Files", "Flows", "Functions", "Bubbles"] as const;
type TopicGroup = (typeof GROUPS)[number];

interface Topic {
  key: string;
  group: TopicGroup;
  label: string;
  question: string;
  symbolId?: string;
}

interface Props {
  analysis: Analysis;
  actionLabel: string;
  disabled?: boolean;
  onPick: (question: string, symbolId?: string) => void;
}

function buildTopics(analysis: Analysis): Topic[] {
  const incoming = new Map<string, number>();
  for (const edge of analysis.callEdges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const byInfluence = [...analysis.symbols].sort((a, b) => {
    const byCallers = (incoming.get(b.id) ?? 0) - (incoming.get(a.id) ?? 0);
    return (
      byCallers ||
      Number(b.exported) - Number(a.exported) ||
      a.name.localeCompare(b.name) ||
      a.file.localeCompare(b.file)
    );
  });
  const bestSymbolId = (match: (symbol: RepoSymbol) => boolean) =>
    byInfluence.find(match)?.id;

  const purposeByFile = new Map(analysis.files.map((file) => [file.path, file.purpose]));
  const importsByFile = new Map<string, string[]>();
  for (const edge of analysis.fileEdges) {
    const imported = importsByFile.get(edge.from) ?? [];
    imported.push(edge.to);
    importsByFile.set(edge.from, imported);
  }

  const topics: Topic[] = [];

  const directories = new Map<string, number>();
  for (const file of analysis.files) {
    const parts = file.path.split("/");
    if (parts.length < 2) continue;
    const directory = parts.slice(0, -1).join("/");
    directories.set(directory, (directories.get(directory) ?? 0) + 1);
  }
  for (const [directory] of [...directories]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const label = `the ${directory} pipeline`;
    topics.push({
      key: `pipeline:${directory}`,
      group: "Pipelines",
      label,
      question: `How does ${label} work?`,
      symbolId: bestSymbolId((symbol) => symbol.file.startsWith(`${directory}/`)),
    });
  }

  for (const file of [...analysis.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const label = `the ${file.path} file`;
    topics.push({
      key: `file:${file.path}`,
      group: "Files",
      label,
      question: `How does ${label} work?`,
      symbolId:
        bestSymbolId((symbol) => symbol.file === file.path) ??
        bestSymbolId((symbol) => (importsByFile.get(file.path) ?? []).includes(symbol.file)),
    });
  }

  const seenFlows = new Set<string>();
  for (const endpoint of analysis.files.flatMap((file) => file.endpoints)) {
    const flow = `${endpoint.method} ${endpoint.path}`;
    if (seenFlows.has(flow)) continue;
    seenFlows.add(flow);
    const label = `the ${flow} flow`;
    topics.push({
      key: `flow:${flow}`,
      group: "Flows",
      label,
      question: `How does ${label} work?`,
    });
  }

  for (const symbol of byInfluence) {
    const name = symbol.parent ? `${symbol.parent}.${symbol.name}` : symbol.name;
    const noun =
      symbol.kind === "class"
        ? "class"
        : symbol.kind === "component"
          ? "component"
          : symbol.kind === "method"
            ? "method"
            : "function";
    const label = `the ${name} ${noun} in ${symbol.file}`;
    topics.push({
      key: `symbol:${symbol.id}`,
      group: "Functions",
      label,
      question: `How does ${label} work?`,
      symbolId: symbol.id,
    });
  }

  const purposes = new Map<string, number>();
  for (const file of analysis.files) {
    purposes.set(file.purpose, (purposes.get(file.purpose) ?? 0) + 1);
  }
  for (const [purpose] of [...purposes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const label = `the ${purpose} bubble`;
    topics.push({
      key: `bubble:${purpose}`,
      group: "Bubbles",
      label,
      question: `How does ${label} work?`,
      symbolId: bestSymbolId((symbol) => purposeByFile.get(symbol.file) === purpose),
    });
  }

  return topics;
}

export function TopicPicker({ analysis, actionLabel, disabled = false, onPick }: Props) {
  const topics = useMemo(() => buildTopics(analysis), [analysis]);
  const [selected, setSelected] = useState("");
  const selectedTopic = topics.find((topic) => topic.key === selected);

  useEffect(() => {
    setSelected("");
  }, [analysis.id]);

  return (
    <div className="topic-builder">
      <span className="topic-builder-text">How does</span>
      <select
        aria-label="Suggested topics"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        disabled={disabled || topics.length === 0}
        title={selectedTopic?.question ?? "Pick a pipeline, file, flow, function or bubble"}
      >
        <option value="">pick a pipeline, file, flow, function or bubble</option>
        {GROUPS.map((group) => {
          const items = topics.filter((topic) => topic.group === group);
          if (items.length === 0) return null;
          return (
            <optgroup label={group} key={group}>
              {items.map((topic) => (
                <option value={topic.key} key={topic.key}>
                  {topic.label}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      <span className="topic-builder-text">work?</span>
      <button
        type="button"
        className="ghost small"
        disabled={disabled || !selectedTopic}
        onClick={() => {
          if (selectedTopic) onPick(selectedTopic.question, selectedTopic.symbolId);
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
}
