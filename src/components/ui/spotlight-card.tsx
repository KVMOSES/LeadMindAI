"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SpotlightCard — layered surface with a subtle pointer-following radial glow.
 *
 * Implementation notes:
 * - The glow is scoped to the card element only: the position is written to
 *   two CSS custom properties via `onMouseMove` on the card itself. There are
 *   no global/window event listeners, so no cleanup is required — React
 *   detaches the handler automatically on unmount.
 * - The glow itself is rendered purely in CSS (globals.css, `[data-spotlight]`).
 * - `prefers-reduced-motion` disables the glow transition (CSS layer).
 * - On touch devices the glow simply stays dormant; the card remains fully
 *   readable and interactive without pointer-dependent behaviour.
 * - Content sits above the glow (`z-10` wrapper) so readability is preserved.
 */

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Colour of the radial glow. Defaults to the brand violet. */
  spotlightColor?: string;
  /** Render as a different element (e.g. `section`). */
  as?: "div" | "section" | "article";
}

export const SpotlightCard = React.forwardRef<HTMLDivElement, SpotlightCardProps>(
  ({ className, children, spotlightColor, as = "div", ...props }, ref) => {
    const Tag = as as React.ElementType;

    const handleMouseMove = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
    }, []);

    return (
      <Tag
        ref={ref}
        data-spotlight=""
        onMouseMove={handleMouseMove}
        className={cn("lm-panel rounded-xl border", className)}
        {...props}
      >
        <div className="relative z-10 h-full" style={spotlightColor ? { "--spot-color": spotlightColor } as React.CSSProperties : undefined}>
          {children}
        </div>
      </Tag>
    );
  },
);
SpotlightCard.displayName = "SpotlightCard";

export { SpotlightCard as default };
