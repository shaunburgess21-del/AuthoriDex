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
// the classnames.
//
// IMPORTANT: the actual visual treatment (frosted glass, hairline border,
// layered shadow with brand-blue bloom, inset top highlight, custom
// easing) lives in `.tooltip-surface` in client/src/index.css — NOT in
// Tailwind arbitrary values. Tailwind v3's content scanner silently
// drops bracketed values containing commas (rgba/hsl/cubic-bezier multi-
// arg), so authoring those as a real CSS class is the only reliable
// option. See the comment block in index.css for the full reasoning.
export const tooltipSurfaceClass = cn(
  // Layout — these are simple Tailwind utilities (no commas) so they
  // generate fine.
  "z-50 max-w-xs rounded-lg px-3 py-2 text-sm",
  "text-popover-foreground",
  // Visual skin (defined in index.css)
  "tooltip-surface",
  // Origin so the scale animation pivots from the trigger side, not center
  "origin-[--radix-tooltip-content-transform-origin]",
  // Entry/exit — driven by Radix data-state via tailwindcss-animate.
  // Easing comes from .tooltip-surface's animation-timing-function.
  "will-change-transform",
  "duration-200",
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
      // drop-shadow lives in .tooltip-arrow (index.css) — Tailwind v3
      // can't generate `drop-shadow-[...rgba(0,0,0,0.15)]` because the
      // commas inside rgba() get the class dropped by the scanner.
      "tooltip-arrow",
      className,
    )}
    {...props}
  />
))
TooltipArrow.displayName = TooltipPrimitive.Arrow.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipArrow }
