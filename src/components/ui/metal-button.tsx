"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * MetalButton — brushed-metal action button for special, high-emphasis
 * actions (model training, major analyses, important confirmations).
 *
 * Implementation notes:
 * - The brushed-metal gradient and the shine sweep are implemented purely in
 *   CSS on the element and its ::after overlay. The component registers no
 *   mouse/touch/keyboard handlers of its own, so consumer-provided callbacks
 *   (onClick, onMouseDown, onTouchStart, …) are always preserved.
 * - Renders a native <button> (or <Slot> with asChild) → full keyboard
 *   support and visible focus-visible ring.
 * - Disabled state dims the metal and blocks pointer events.
 * - `prefers-reduced-motion` disables the shine sweep and press animation.
 * - Colour variants are semantic: default (neutral steel), primary (brand
 *   violet steel), success (emerald), error (destructive), gold (special AI /
 *   premium action), bronze (secondary highlighted action).
 */

const metalVariants = cva(
  [
    "group/metal relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg",
    "font-semibold outline-none",
    "transition-[filter,box-shadow] duration-200",
    "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:[transform:translateY(1px)] disabled:pointer-events-none disabled:opacity-55 disabled:shadow-none",
    "overflow-hidden",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "text-zinc-50 border border-black/30",
          "bg-[linear-gradient(180deg,#8a8f9c_0%,#5d626e_45%,#43474f_100%)]",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45),inset_0_-1px_1px_0_rgba(0,0,0,0.45),0_2px_6px_rgba(0,0,0,0.35)]",
        ],
        primary: [
          "text-white border border-black/30",
          "bg-[linear-gradient(180deg,#8d84e8_0%,#6d5fd0_45%,#53479f_100%)]",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.4),inset_0_-1px_1px_0_rgba(0,0,0,0.4),0_2px_8px_rgba(124,108,240,0.35)]",
        ],
        success: [
          "text-white border border-black/30",
          "bg-[linear-gradient(180deg,#4ecf9b_0%,#2faf7c_45%,#1e8560_100%)]",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.4),inset_0_-1px_1px_0_rgba(0,0,0,0.4),0_2px_8px_rgba(16,185,129,0.3)]",
        ],
        error: [
          "text-white border border-black/30",
          "bg-[linear-gradient(180deg,#f07a80_0%,#d8555e_45%,#a83742_100%)]",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),inset_0_-1px_1px_0_rgba(0,0,0,0.4),0_2px_8px_rgba(244,63,94,0.3)]",
        ],
        gold: [
          "text-[#2b2005] border border-black/25",
          "bg-[linear-gradient(180deg,#f4dc94_0%,#d9b45c_45%,#a8813a_100%)]",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5),inset_0_-1px_1px_0_rgba(0,0,0,0.35),0_2px_10px_rgba(217,180,92,0.4)]",
        ],
        bronze: [
          "text-[#2b1608] border border-black/25",
          "bg-[linear-gradient(180deg,#e2a37c_0%,#c07e51_45%,#8f5a34_100%)]",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45),inset_0_-1px_1px_0_rgba(0,0,0,0.35),0_2px_10px_rgba(192,126,81,0.35)]",
        ],
      },
      size: {
        default: "h-9 px-4 text-sm",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-6 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface MetalButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof metalVariants> {
  asChild?: boolean;
}

export const MetalButton = React.forwardRef<HTMLButtonElement, MetalButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(metalVariants({ variant, size }), className)} {...props}>
        {/* Brushed-metal micro-texture + engraved top edge (decorative) */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25 mix-blend-overlay"
          style={{
            backgroundImage:
              "repeating-linear-gradient(95deg, rgba(255,255,255,0.14) 0px, rgba(255,255,255,0.14) 1px, transparent 1px, transparent 3px)",
          }}
        />
        {/* Shine sweep — CSS only, so consumer handlers are never overridden */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(105deg,transparent_35%,rgba(255,255,255,0.35)_50%,transparent_65%)] transition-transform duration-700 ease-out motion-reduce:hidden group-hover/metal:translate-x-full"
        />
        <span className="relative z-10 inline-flex items-center gap-2 drop-shadow-[0_1px_0_rgba(0,0,0,0.18)]">
          {children}
        </span>
      </Comp>
    );
  },
);
MetalButton.displayName = "MetalButton";

export { metalVariants };
