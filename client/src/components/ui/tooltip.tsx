"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

/**
 * Tooltip — AuthoriDex "pulse-card" surface.
 *
 * Visual language matches the rest of the app's premium dark UI (see
 * `.pulse-card-*` in client/src/index.css):
 *   - frosted-glass body with layered blue-tinted ambient bloom
 *   - hairline translucent border + subtle inset top highlight
 *   - rounded-lg (9px) to match --radius
 *   - eased entry/exit (cubic-bezier 0.16, 1, 0.3, 1 — "easeOutExpo")
 *
 * Animation still rides on Radix data-state + tailwindcss-animate so the
 * existing API is unchanged and no caller needs touching. Honors
 * `prefers-reduced-motion` via the global override in index.css.
 *
 * Backwards-compatible exports — no caller changes needed. `TooltipArrow`
 * is exported additionally for future opt-in usage.
 */

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

// "tooltip-surface" — the visual shell. Exported so TouchTooltip's mobile
// fallback (a Popover) can wear the exact same skin without duplicating
// the long classname.
export const tooltipSurfaceClass = cn(
  // Layout
  "z-50 max-w-xs rounded-lg px-3 py-2 text-sm",
  // Frosted glass surface — falls back to solid popover bg in browsers
  // without backdrop-filter so it never reads transparent on top of busy
  // content.
  "bg-popover/95 supports-[backdrop-filter]:bg-popover/75",
  "backdrop-blur-xl backdrop-saturate-150",
  // Hairline border — light/dark aware
  "border border-black/[0.06] dark:border-white/[0.08]",
  // Layered shadow:
  //   1. Drop shadow for elevation off the page
  //   2. Soft brand-blue ambient bloom (matches pulse-card-voxdex glow weight)
  //   3. Inset top highlight for a subtle "lit" edge
  "shadow-[0_8px_28px_-6px_rgba(15,23,42,0.18),0_0_28px_-10px_hsl(217_91%_60%_/_0.14),inset_0_1px_0_0_rgba(255,255,255,0.04)]",
  "dark:shadow-[0_12px_36px_-8px_rgba(0,0,0,0.55),0_0_36px_-10px_hsl(217_91%_60%_/_0.20),inset_0_1px_0_0_rgba(255,255,255,0.06)]",
  // Typography
  "text-popover-foreground",
  // Origin so the scale animation pivots from the trigger side, not center
  "origin-[--radix-tooltip-content-transform-origin]",
  // Entry/exit — driven by Radix data-state via tailwindcss-animate.
  // Custom easing + slightly longer duration gives a "premium pop" feel
  // vs. the stock 150ms ease-out.
  "will-change-[transform,opacity]",
  "duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
  "animate-in fade-in-0 zoom-in-95",
  "data-[side=bottom]:slide-in-from-top-1.5 data-[side=top]:slide-in-from-bottom-1.5 data-[side=left]:slide-in-from-right-1.5 data-[side=right]:slide-in-from-left-1.5",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-150",
)

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  // Render into a portal so the tooltip can escape any ancestor's
  // overflow-hidden (eg. the Momentum Signals Cards that clip their
  // top-border gradient). Matches how our Popover is already wired.
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(tooltipSurfaceClass, className)}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

const TooltipArrow = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Arrow>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Arrow>
>(({ className, width = 10, height = 5, ...props }, ref) => (
  // Match the body's translucent fill so the arrow reads as the same
  // surface continuing toward the trigger. Drop-shadow keeps it visible
  // against busy backgrounds.
  <TooltipPrimitive.Arrow
    ref={ref}
    width={width}
    height={height}
    className={cn(
      "fill-popover/95 supports-[backdrop-filter]:fill-popover/75",
      "drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]",
      className,
    )}
    {...props}
  />
))
TooltipArrow.displayName = TooltipPrimitive.Arrow.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipArrow }
