import { useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "../../shared/types";
import { LANG_COLORS, langLabel } from "../format";

interface Props {
  analysis: Analysis;
  selectedFile?: string;
  highlightFiles: string[];
  onSelectFile: (path: string) => void;
}

const W = 1200;
const H = 760;
const MAX_NODES = 130;

interface GNode {
  path: string;
  label: string;
  loc: number;
  lang: string;
  degree: number;
}

interface GLink {
  source: string;
  target: string;
}

function buildGraph(analysis: Analysis, langFilter: string | null): { nodes: GNode[]; links: GLink[] } {
  const degree = new Map<string, number>();
  for (const edge of analysis.fileEdges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const eligible = analysis.files
    .filter((f) => f.presence !== "doc" && f.presence !== "config")
    .filter((f) => !langFilter || f.lang === langFilter)
    .sort(
      (a, b) =>
        (degree.get(b.path) ?? 0) - (degree.get(a.path) ?? 0) ||
        b.loc - a.loc ||
        a.path.localeCompare(b.path),
    );

  const nodes = eligible.slice(0, MAX_NODES).map((f) => ({
    path: f.path,
    label: f.path.split("/").pop() ?? f.path,
    loc: f.loc,
    lang: f.lang,
    degree: degree.get(f.path) ?? 0,
  }));
  const included = new Set(nodes.map((n) => n.path));
  const links = analysis.fileEdges
    .filter((e) => included.has(e.from) && included.has(e.to))
    .map((e) => ({ source: e.from, target: e.to }));
  return { nodes, links };
}

function layout(nodes: GNode[], links: GLink[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const n = nodes.length;
  if (!n) return positions;

  const state = nodes.map((_, index) => {
    const angle = index * 2.399963;
    const radius = 40 + Math.sqrt(index + 1) * 26;
    return {
      x: W / 2 + Math.cos(angle) * radius,
      y: H / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
  const indexOf = new Map(nodes.map((node, index) => [node.path, index]));

  for (let iteration = 0; iteration < 220; iteration++) {
    const cooling = 1 - iteration / 220;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = state[i].x - state[j].x;
        let dy = state[i].y - state[j].y;
        let distanceSq = dx * dx + dy * dy;
        if (distanceSq < 9) {
          dx = ((i % 7) - 3) * 0.6 + 0.1;
          dy = ((j % 5) - 2) * 0.6 + 0.1;
          distanceSq = dx * dx + dy * dy;
        }
        const distance = Math.sqrt(distanceSq);
        const force = Math.min(26, 1500 / distanceSq);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        state[i].vx += fx;
        state[i].vy += fy;
        state[j].vx -= fx;
        state[j].vy -= fy;
      }
    }

    for (const link of links) {
      const a = state[indexOf.get(link.source) ?? -1];
      const b = state[indexOf.get(link.target) ?? -1];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (distance - 105) * 0.014;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (let i = 0; i < n; i++) {
      const s = state[i];
      s.vx += (W / 2 - s.x) * 0.0015 * cooling;
      s.vy += (H / 2 - s.y) * 0.0015 * cooling;
      s.vx *= 0.82;
      s.vy *= 0.82;
      s.x = Math.max(46, Math.min(W - 46, s.x + s.vx));
      s.y = Math.max(40, Math.min(H - 40, s.y + s.vy));
    }
  }

  nodes.forEach((node, index) => positions.set(node.path, { x: state[index].x, y: state[index].y }));
  return positions;
}

function radiusFor(loc: number): number {
  return Math.max(4.5, Math.min(15, 4 + Math.sqrt(loc) / 3.2));
}

export function Graph({ analysis, selectedFile, highlightFiles, onSelectFile }: Props) {
  const [langFilter, setLangFilter] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<{ path: string; moved: boolean } | null>(null);
  const panning = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );

  const { nodes, links } = useMemo(() => buildGraph(analysis, langFilter), [analysis, langFilter]);
  const positions = useMemo(() => layout(nodes, links), [nodes, links]);

  useEffect(() => {
    setDragged({});
    setView({ x: 0, y: 0, k: 1 });
  }, [analysis.id, langFilter]);

  const highlight = useMemo(() => new Set(highlightFiles), [highlightFiles]);

  const neighbors = useMemo(() => {
    const set = new Set<string>();
    if (!selectedFile) return set;
    for (const link of links) {
      if (link.source === selectedFile) set.add(link.target);
      if (link.target === selectedFile) set.add(link.source);
    }
    return set;
  }, [links, selectedFile]);

  const languageOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) counts.set(node.lang, (counts.get(node.lang) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [nodes]);

  function positionOf(path: string): { x: number; y: number } {
    return dragged[path] ?? positions.get(path) ?? { x: W / 2, y: H / 2 };
  }

  function toViewBox(event: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
  }

  function toWorld(event: React.PointerEvent): { x: number; y: number } {
    const point = toViewBox(event);
    return { x: (point.x - view.x) / view.k, y: (point.y - view.y) / view.k };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (dragging.current) {
      const world = toWorld(event);
      dragging.current.moved = true;
      setDragged((prev) => ({ ...prev, [dragging.current!.path]: world }));
      return;
    }
    if (panning.current) {
      const dx = event.clientX - panning.current.startX;
      const dy = event.clientY - panning.current.startY;
      setView((v) => ({
        ...v,
        x: panning.current!.originX + dx * (W / (svgRef.current?.clientWidth ?? W)),
        y: panning.current!.originY + dy * (H / (svgRef.current?.clientHeight ?? H)),
      }));
    }
  }

  function zoom(factor: number) {
    setView((v) => {
      const k = Math.max(0.5, Math.min(2.6, v.k * factor));
      const ratio = k / v.k;
      return {
        k,
        x: W / 2 - (W / 2 - v.x) * ratio,
        y: H / 2 - (H / 2 - v.y) * ratio,
      };
    });
  }

  const dimmed = (path: string): boolean => {
    if (highlight.size) return !highlight.has(path);
    if (selectedFile && path !== selectedFile && !neighbors.has(path)) return true;
    return false;
  };

  return (
    <div className="graph-shell">
      <div className="graph-toolbar">
        <div className="legend">
          {languageOptions.map(([lang, count]) => (
            <button
              key={lang}
              type="button"
              className={`legend-item ${langFilter === lang ? "active" : ""}`}
              onClick={() => setLangFilter(langFilter === lang ? null : lang)}
              title={`Filter to ${langLabel(lang)}`}
            >
              <span className="dot" style={{ background: LANG_COLORS[lang] ?? "#8b98a9" }} />
              {langLabel(lang)} <span className="count">{count}</span>
            </button>
          ))}
          {langFilter && (
            <button type="button" className="ghost tiny" onClick={() => setLangFilter(null)}>
              Clear
            </button>
          )}
        </div>
        <div className="zoom-controls">
          <button type="button" className="ghost" onClick={() => zoom(1.25)} title="Zoom in">
            +
          </button>
          <button type="button" className="ghost" onClick={() => zoom(0.8)} title="Zoom out">
            −
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setView({ x: 0, y: 0, k: 1 });
              setDragged({});
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        className="graph-svg"
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={handlePointerMove}
        onPointerUp={() => {
          dragging.current = null;
          panning.current = null;
        }}
        onPointerLeave={() => {
          dragging.current = null;
          panning.current = null;
          setHovered(null);
        }}
        onPointerDown={(event) => {
          const tag = (event.target as Element).tagName;
          if (event.target === event.currentTarget || tag === "rect") {
            panning.current = {
              startX: event.clientX,
              startY: event.clientY,
              originX: view.x,
              originY: view.y,
            };
          }
        }}
      >
        <rect width={W} height={H} fill="transparent" />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {links.map((link, index) => {
            const a = positionOf(link.source);
            const b = positionOf(link.target);
            const active =
              link.source === selectedFile ||
              link.target === selectedFile ||
              (highlight.size > 0 && highlight.has(link.source) && highlight.has(link.target));
            return (
              <line
                key={`${link.source}-${link.target}-${index}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={`graph-link ${active ? "active" : ""}`}
              />
            );
          })}
          {nodes.map((node) => {
            const point = positionOf(node.path);
            const isSelected = node.path === selectedFile;
            const isHovered = node.path === hovered;
            const showLabel = isSelected || isHovered || node.degree >= 4 || highlight.has(node.path);
            return (
              <g
                key={node.path}
                className={`graph-node ${isSelected ? "selected" : ""} ${dimmed(node.path) ? "dim" : ""}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  dragging.current = { path: node.path, moved: false };
                }}
                onPointerEnter={() => setHovered(node.path)}
                onPointerLeave={() => setHovered((h) => (h === node.path ? null : h))}
                onClick={() => {
                  if (dragging.current?.moved) return;
                  onSelectFile(node.path);
                }}
              >
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={radiusFor(node.loc) + (isSelected ? 3 : 0)}
                  fill={LANG_COLORS[node.lang] ?? "#8b98a9"}
                  fillOpacity={isSelected ? 0.95 : 0.75}
                />
                {showLabel && (
                  <text x={point.x} y={point.y - radiusFor(node.loc) - 7} className="graph-label">
                    {node.label.length > 24 ? `${node.label.slice(0, 22)}…` : node.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="graph-foot">
        <span>
          {nodes.length} of {analysis.files.length} files · {links.length} import edges
        </span>
        <span className="muted">Click to inspect · drag to rearrange · scroll the list for details</span>
      </div>
      {hovered && (
        <div className="graph-hover">
          <strong>{hovered}</strong>
          <span>{analysis.files.find((f) => f.path === hovered)?.summary}</span>
        </div>
      )}
    </div>
  );
}
