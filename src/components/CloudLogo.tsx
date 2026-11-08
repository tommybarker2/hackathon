import type { CSSProperties } from "react";

interface Props {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Cloud mascot with a flat base, overlapping top lobes and a simple face.
 * The silhouette is drawn from same-coloured shapes so the interior seams
 * disappear into one chunky outline.
 */
export function CloudLogo({ size = 96, className = "", style }: Props) {
  return (
    <svg
      viewBox="0 0 100 86"
      width={size}
      height={Math.round(size * 0.86)}
      className={`cloud-logo ${className}`}
      style={style}
      role="presentation"
      aria-hidden="true"
    >
      <g
        className="cloud-logo-body"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
      >
        <circle cx="27" cy="50" r="20" />
        <circle cx="50" cy="35" r="24" />
        <circle cx="73" cy="50" r="20" />
        <path d="M21 82H79c7.7 0 14-6.3 14-14c0-10-8-18-18-18H25c-10 0-18 8-18 18c0 7.7 6.3 14 14 14z" />
      </g>
      <circle className="cloud-logo-eye" cx="40" cy="49" r="3.8" />
      <circle className="cloud-logo-eye" cx="60" cy="49" r="3.8" />
      <path className="cloud-logo-mouth" d="M42 57h16a8 8 0 0 1-16 0z" />
    </svg>
  );
}
