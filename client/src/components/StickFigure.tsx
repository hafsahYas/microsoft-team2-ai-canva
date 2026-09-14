import { memo } from "react";

interface StickFigureProps {
  /** Height in px (width scales via the viewBox ratio). */
  size?: number;
  /** Stroke color. */
  tone?: string;
  /** True while the companion is thinking — faster bobbing. */
  busy?: boolean;
  /** Hide the ground shadow (for small avatars). */
  hideShadow?: boolean;
  className?: string;
}

/**
 * The chatbot companion's stick figure, drawn as an inline SVG (head, body,
 * arms, legs + a soft ground shadow). Idle it breathes gently; while the bot
 * is generating, CSS speeds the bob up (see .chatbot-fig-* in index.css).
 */
function StickFigure({
  size = 96,
  tone = "#e11d48",
  busy = false,
  hideShadow = false,
  className = "",
}: StickFigureProps) {
  return (
    <svg
      viewBox="0 0 64 96"
      width={(size * 64) / 96}
      height={size}
      className={className}
      aria-hidden="true"
    >
      {!hideShadow && (
        <ellipse cx="32" cy="92" rx="15" ry="3" fill="rgba(15,23,42,0.15)" />
      )}
      <g
        stroke={tone}
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
        className={busy ? "chatbot-fig-busy" : "chatbot-fig-idle"}
      >
        <circle cx="32" cy="14" r="8" />
        <line x1="32" y1="22" x2="32" y2="54" />
        <line x1="32" y1="32" x2="17" y2="44" />
        <line x1="32" y1="32" x2="47" y2="44" />
        <line x1="32" y1="54" x2="21" y2="87" />
        <line x1="32" y1="54" x2="43" y2="87" />
      </g>
    </svg>
  );
}

export default memo(StickFigure);