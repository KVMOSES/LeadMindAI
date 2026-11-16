import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * LeadMind AI brand identity — "The Signal Mark".
 *
 * The symbol fuses an LM monogram with an intelligent signal path:
 *  - The "L" is a grounded neural rail (stem + baseline).
 *  - The "M" is a rising signal zigzag — its peaks read as both letter
 *    strokes and a growth chart climbing to the upper right.
 *  - Connection nodes mark the vertices; the highest peak carries a lime
 *    "signal acquired" node — the single playful accent.
 *
 * The mark works independently of the wordmark, on dark and light
 * backgrounds (it always sits on the dark brand badge for consistency).
 */

export interface LogoMarkProps {
  /** Pixel size of the square mark. */
  size?: number;
  /** Render the dark brand badge behind the signal mark. */
  badge?: boolean;
  className?: string;
}

export function LogoMark({ size = 32, badge = true, className }: LogoMarkProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const gid = `lmg${uid}`;
  const ringId = `lmr${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      role="img"
    >
      <defs>
        <linearGradient id={gid} x1="12" y1="37" x2="42" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="0.52" stopColor="#6366f1" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
        <linearGradient id={ringId} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.55" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {badge && (
        <rect x="0.75" y="0.75" width="46.5" height="46.5" rx="12.5" fill="#101319" stroke={`url(#${ringId})`} strokeWidth="1.5" />
      )}
      {/* L — grounded neural rail */}
      <path
        d="M13 11V35.5H23.5"
        stroke={`url(#${gid})`}
        strokeWidth="4.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* M — rising signal path */}
      <path
        d="M23.5 35.5L29.5 19.5L34.5 29.5L41.5 12"
        stroke={`url(#${gid})`}
        strokeWidth="4.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Connection nodes */}
      <circle cx="13" cy="11" r="2.4" fill="#c4b5fd" />
      <circle cx="29.5" cy="19.5" r="2.4" fill="#c4b5fd" />
      <circle cx="34.5" cy="29.5" r="2.4" fill="#7dd3fc" />
      {/* Signal peak — lime accent */}
      <circle cx="41.5" cy="12" r="3.6" fill="#a3e635" />
      <circle cx="41.5" cy="12" r="6" fill="#a3e635" opacity="0.22" />
    </svg>
  );
}

export interface LogoWordmarkProps {
  /** Hide the "Sales Intelligence OS" descriptor line. */
  compact?: boolean;
  className?: string;
}

/** Wordmark: Space Grotesk "LeadMind" + gradient "AI" chip. */
export function LogoWordmark({ compact = false, className }: LogoWordmarkProps) {
  return (
    <div className={cn("min-w-0 leading-none", className)}>
      <span className="flex items-center gap-1.5">
        <span className="font-display text-[15px] font-bold tracking-tight text-foreground">
          LeadMind
        </span>
        <span
          className="rounded-[5px] bg-[linear-gradient(120deg,var(--lm-brand),var(--lm-info))] px-1.5 py-[3px] font-display text-[9px] font-bold leading-none tracking-wide text-white"
          aria-hidden="true"
        >
          AI
        </span>
      </span>
      {!compact && (
        <span className="mt-1 block whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          Sales Intelligence OS
        </span>
      )}
    </div>
  );
}

/** Lockup: mark + wordmark (login, loading, mobile nav). */
export function LogoFull({
  markSize = 40,
  compact = false,
  className,
}: {
  markSize?: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LogoMark size={markSize} />
      <LogoWordmark compact={compact} />
    </div>
  );
}
