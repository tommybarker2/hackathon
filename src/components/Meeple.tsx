import type { CSSProperties } from "react";

interface Props {
  size?: number;
  hat?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Board-game meeple mascot. The silhouette is a union of same-coloured shapes,
 * so overlapping strokes disappear into one chunky outline.
 */
export function Meeple({ size = 96, hat = false, className = "", style }: Props) {
  return (
    <svg
      viewBox="0 0 100 130"
      width={size}
      height={Math.round(size * 1.3)}
      className={`meeple ${className}`}
      style={style}
      role="presentation"
      aria-hidden="true"
    >
      <g fill="#222" stroke="#222" strokeWidth="8" strokeLinejoin="round">
        <rect x="4" y="52" width="92" height="20" rx="10" />
        <rect x="30" y="44" width="40" height="54" rx="10" />
        <rect x="28" y="88" width="17" height="38" rx="8" />
        <rect x="55" y="88" width="17" height="38" rx="8" />
        <circle cx="50" cy="34" r="20" />
      </g>
      <circle cx="42" cy="33" r="2.6" fill="#fff" />
      <circle cx="58" cy="33" r="2.6" fill="#fff" />
      {hat && (
        <g>
          <rect x="26" y="12" width="48" height="8" rx="4" fill="#ffd95e" />
          <path d="M36 16V8a6 6 0 0 1 6-6h16a6 6 0 0 1 6 6v8z" fill="#ffd95e" />
        </g>
      )}
    </svg>
  );
}
