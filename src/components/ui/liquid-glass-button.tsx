"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * LiquidGlassButton — high-value action button with a translucent "liquid
 * glass" treatment: layered backdrop blur, specular top highlight, and a
 * subtle SVG refraction sheen.
 *
 * Implementation notes:
 * - Each instance generates its own SVG filter id via `useId()`, so two
 *   buttons on the same page can never collide on a global filter id.
 * - The refraction filter is applied only to a decorative overlay; if the
 *   browser does not support `backdrop-filter` or SVG filters on HTML
 *   elements the button still renders as an elegant translucent surface.
 * - Renders a native `<button>` (keyboard focusable) or `<Slot>` when
 *   `asChild` is used, preserving shadcn conventions.
 * - `disabled` and `loading` are fully supported; `loading` also disables
 *   interaction and announces state to assistive tech via aria-busy.
 * - Visible `focus-visible` ring in both dark and light contexts.
 */

const liquidGlassVariants = cva(
  [
    "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "rounded-lg font-medium outline-none",
    "transition-[transform,box-shadow,background-color,border-color] duration-200",
    "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55",
    // Glass base: layered translucent surface + specular top border.
    // Where backdrop-filter is unsupported this still renders as an elegant
    // translucent surface — graceful degradation without extra CSS branches.
    "border border-white/25 bg-white/10 backdrop-blur-md",
    "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),inset_0_-1px_0_0_rgba(255,255,255,0.06),0_8px_24px_-12px_rgba(0,0,0,0.45)]",
    "dark:border-white/20 dark:bg-white/[0.08]",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "text-foreground hover:bg-white/20 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45),0_10px_28px_-12px_rgba(0,0,0,0.55)]",
        brand: [
          "text-white border-[var(--lm-brand)]/40",
          "bg-[var(--lm-brand)]/85 hover:bg-[var(--lm-brand)]",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.4),inset_0_-1px_0_0_rgba(255,255,255,0.12),0_10px_30px_-10px_var(--lm-brand)]",
        ],
        outline:
          "border-white/20 bg-white/5 text-foreground hover:bg-white/10 dark:border-white/15 dark:bg-white/[0.04]",
      },
      size: {
        default: "h-9 px-4 text-sm",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-6 text-sm",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface LiquidGlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof liquidGlassVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const LiquidGlassButton = React.forwardRef<HTMLButtonElement, LiquidGlassButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    // Unique per-instance filter id — prevents duplicate global SVG ids.
    const filterId = React.useId().replace(/[^a-zA-Z0-9]/g, "");
    const Comp = asChild ? Slot : "button";

    return (
      <>
        {/* Per-instance refraction filter (decorative only) */}
        <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute">
          <defs>
            <filter id={`lg-${filterId}`} x="-20%" y="-20%" width="140%" height="140%">
              <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="7" result="noise" />
              <feGaussianBlur in="noise" stdDeviation="1.6" result="smooth" />
              <feDisplacementMap in="SourceGraphic" in2="smooth" scale="6" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
        <Comp
          ref={ref}
          className={cn(liquidGlassVariants({ variant, size }), "overflow-hidden", className)}
          disabled={asChild ? undefined : disabled || loading}
          aria-busy={loading || undefined}
          {...props}
        >
          {asChild ? (
            children
          ) : (
            <>
              {/* Specular sheen with refraction; silently absent if unsupported */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-1/2 opacity-70"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(255,255,255,0.28), rgba(255,255,255,0.02))",
                  filter: `url(#lg-${filterId})`,
                }}
              />
              <span className="relative z-10 inline-flex items-center gap-2">
                {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {children}
              </span>
            </>
          )}
        </Comp>
      </>
    );
  },
);
LiquidGlassButton.displayName = "LiquidGlassButton";

export { liquidGlassVariants };
