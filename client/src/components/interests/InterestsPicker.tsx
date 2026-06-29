// Interest Picker — Phase 1 shared modal.
//
// Renders the same content in four "modes" so the picker is reusable for:
//   * onboarding  — first-time prompt after /login/welcome (Skip available)
//   * settings    — inline card on /me/settings (no Skip, persistent)
//   * reprompt    — soft re-prompt for skippers (Skip = "Not now")
//   * inline      — embedded as a step inside the multi-step onboarding
//                   container. Like `settings` it returns just the body
//                   (no Drawer/Dialog chrome) but uses the onboarding
//                   copy and exposes the same Save/Skip semantics —
//                   the container drives advance/skip via `onSaved`.
//
// Layout:
//   * Mobile (<768px): vaul Drawer for thumb-reach (mirrors OnboardingDrawer).
//   * Desktop:         Radix Dialog centered modal.
//   * Settings mode:   never wrapped — caller embeds the body in a Card.
//   * Inline mode:     never wrapped — used inside the onboarding flow.
//
// Persistence:
//   * Save  -> PATCH /api/profile/me/interests { interests: [...] }
//   * Skip  -> PATCH /api/profile/me/interests { interests: [], dismissed: true }
//
// Saving an empty selection without `dismissed` is a "clear all" — used by
// the Settings card. The server treats that as "no interests, not dismissed"
// so cold-start ordering kicks back in.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { CANONICAL_CATEGORIES } from "@shared/constants";
import { getCategoryStyle } from "@/components/CategoryPill";
import { getCategoryIcon } from "@/components/interests/categoryIcons";
import { cn } from "@/lib/utils";

export type InterestsPickerMode = "onboarding" | "settings" | "reprompt" | "inline";

/**
 * Category ids whose labels wrap to two lines at the icon-grid tile size
 * ("Food & Drink", "Media & Podcast"). These get pushed to the tail of
 * the grid so they share a row instead of stretching siblings on rows
 * that would otherwise be all single-line.
 */
const TRAILING_INTEREST_IDS = new Set(["food-drink", "media", "media-podcast"]);

interface InterestsPickerProps {
  mode: InterestsPickerMode;
  /** Drives `<Dialog open>` / `<Drawer open>` for modal modes. Ignored in settings mode. */
  open?: boolean;
  /** Called when the user closes the modal (Save, Skip, or backdrop). Modal modes only. */
  onOpenChange?: (open: boolean) => void;
  /** Pre-selected interests (used by settings mode and to keep state if reopened). */
  defaultValue?: string[];
  /** Optional callback after a successful save / skip. */
  onSaved?: () => void;
}

const MODE_COPY: Record<
  InterestsPickerMode,
  { title: string; subtitle: string; cta: string; skipLabel: string | null }
> = {
  onboarding: {
    title: "Pick what you're into.",
    subtitle: "Choose any you like — tap again to deselect.",
    cta: "Let's go",
    skipLabel: "Skip",
  },
  settings: {
    title: "Your interests",
    subtitle: "Tap to add or remove. Saved as you go — tap Save when you're done.",
    cta: "Save",
    skipLabel: null,
  },
  reprompt: {
    title: "Want better recommendations?",
    subtitle: "Pick what you're into so we can tailor your feed.",
    cta: "Let's go",
    skipLabel: "Not now",
  },
  // Inline mode borrows onboarding copy but the container renders the
  // step header above us — the body keeps its own pill grid + CTA so
  // Save / Skip wire through unchanged. Skip is owned by the container
  // (top-right "Skip" affordance) so the body suppresses its own.
  inline: {
    title: "Pick what you're into.",
    subtitle: "Choose any you like — tap again to deselect.",
    cta: "Continue",
    skipLabel: null,
  },
};

/**
 * Inner picker body — pill grid + CTA + (optional) Skip.
 *
 * The body is shared between the Dialog and Drawer wrappers so its visual
 * treatment is identical across breakpoints.
 */
function PickerBody({
  mode,
  defaultValue,
  onSaved,
  onClose,
}: {
  mode: InterestsPickerMode;
  defaultValue: string[];
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const { refreshProfile } = useAuth();
  const copy = MODE_COPY[mode];
  const { data: categoryRegistry } = useQuery<Array<{ id: string; label: string; sortOrder: number }>>({
    queryKey: ["/api/categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch categories");
      return res.json();
    },
  });
  const interestCategories = useMemo(() => {
    const base: ReadonlyArray<{ id: string; label: string }> =
      Array.isArray(categoryRegistry) && categoryRegistry.length > 0
        ? [...categoryRegistry]
            .sort(
              (a, b) =>
                (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                a.id.localeCompare(b.id),
            )
            .map((row) => ({ id: row.id, label: row.label }))
        : CANONICAL_CATEGORIES;
    // Send categories whose labels wrap to two lines on a 4-col grid to
    // the tail. Without this they'd stretch their row past `aspect-square`
    // and visually break the grid. The internal sizing (see the tile
    // markup below) is also tuned to accommodate two lines, so even after
    // this re-order every tile renders as a true square.
    const head = base.filter((c) => !TRAILING_INTEREST_IDS.has(c.id));
    const tail = base.filter((c) => TRAILING_INTEREST_IDS.has(c.id));
    return [...head, ...tail];
  }, [categoryRegistry]);
  const initialSet = useMemo(() => new Set(defaultValue), [defaultValue]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSet));
  const [saving, setSaving] = useState(false);

  // Re-sync local state when the modal is reopened with a new defaultValue.
  useEffect(() => {
    setSelected(new Set(initialSet));
  }, [initialSet]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const dirty = useMemo(() => {
    if (selected.size !== initialSet.size) return true;
    for (const id of selected) {
      if (!initialSet.has(id)) return true;
    }
    return false;
  }, [selected, initialSet]);

  // Settings mode allows saving an empty selection (clears interests, keeps
  // cold-start ordering on). Modal + inline modes only enable the CTA when
  // something is picked so users don't accidentally "Continue" with an
  // empty set — the container offers an explicit Skip for that path.
  const canSave =
    !saving && (mode === "settings" ? dirty : selected.size > 0);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const selectedArr = Array.from(selected);
    try {
      await apiRequest("PATCH", "/api/profile/me/interests", {
        interests: selectedArr,
      });
      await refreshProfile();
      if (mode === "settings") {
        toast.success("Interests saved");
      }
      onSaved?.();
      onClose?.();
    } catch (err: any) {
      console.error("[InterestsPicker] save failed:", err);
      toast.error("Couldn't save your interests", {
        description: "Please try again in a moment.",
      });
    } finally {
      setSaving(false);
    }
  }, [selected, refreshProfile, mode, onSaved, onClose]);

  const handleSkip = useCallback(async () => {
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/profile/me/interests", {
        interests: [],
        dismissed: true,
      });
      await refreshProfile();
      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error("[InterestsPicker] skip failed:", err);
      // Skip should never block the user — close anyway, but warn quietly.
      toast.error("Couldn't dismiss the prompt", {
        description: "We'll try again next time.",
      });
      onClose?.();
    } finally {
      setSaving(false);
    }
  }, [refreshProfile, onSaved, onClose]);

  const showSkip = copy.skipLabel !== null;

  return (
    <div
      className={cn(
        "relative flex flex-col gap-5",
        // Inline mode lives inside StepShell's flex-1 body — fill the
        // available vertical space so the Continue button can anchor
        // to the bottom via `mt-auto`. The other modes get their own
        // padding from the Drawer / Dialog wrapper.
        mode === "inline"
          ? "flex-1 px-0 pb-0 pt-0"
          : "px-5 pb-6 pt-5 sm:px-6 sm:pt-6",
      )}
    >
      {showSkip && (
        <button
          type="button"
          onClick={handleSkip}
          disabled={saving}
          className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          data-testid="interests-skip"
        >
          <X className="h-3.5 w-3.5" />
          {copy.skipLabel}
        </button>
      )}

      {/* Inline mode is rendered inside StepShell which already shows the
          step title above the body. The other modes (onboarding,
          reprompt, settings) launch in their own surface and need the
          title here. */}
      {mode !== "inline" ? (
        <div className="pr-10">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            {copy.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
      ) : null}

      {
        // Reddit-style icon grid. Each tile always shows its category
        // colour so palettes that read "muted" (politics, misc) don't
        // disappear in the unselected state. Selection bumps opacity
        // to 100 and adds a check pip — a clear, palette-independent
        // signal. Settings reuses the same tiles, widening to more
        // columns on large screens since the settings card has more
        // horizontal room than the onboarding drawer/dialog/step shell.
        <div
          role="group"
          aria-label="Category interests"
          className={cn(
            "grid grid-cols-3 gap-3 sm:grid-cols-4",
            mode === "settings" && "lg:grid-cols-6",
          )}
          data-testid="interests-pill-grid"
        >
          {interestCategories.map((cat) => {
            const isSelected = selected.has(cat.id);
            const style = getCategoryStyle(cat.id);
            const Icon = getCategoryIcon(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => toggle(cat.id)}
                aria-pressed={isSelected}
                data-testid={`interest-pill-${cat.id}`}
                className={cn(
                  "relative flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 transition-all duration-200 active:scale-[0.97]",
                  style.bg,
                  style.border,
                  isSelected
                    ? "opacity-100 shadow-[0_0_24px_-8px_currentColor]"
                    : "opacity-55 hover:opacity-90",
                  // Bind the shadow's currentColor to the category accent
                  // by routing the text colour onto the wrapper. The
                  // child label re-overrides foreground/muted as needed.
                  style.text,
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full bg-background/40 ring-1 ring-inset ring-white/5",
                    style.text,
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <span
                  className={cn(
                    "text-center text-[13px] font-medium leading-tight",
                    isSelected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {cat.label}
                </span>
                {isSelected ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 ring-1 ring-inset ring-white/10",
                      style.text,
                    )}
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      }

      <Button
        onClick={handleSave}
        disabled={!canSave}
        className={cn("w-full", mode === "inline" && "mt-auto")}
        size={mode === "inline" ? "lg" : "default"}
        data-testid="interests-save"
      >
        {saving ? "Saving…" : copy.cta}
      </Button>
    </div>
  );
}

/**
 * Exported component. In `settings` mode it returns just the body so the
 * caller can embed it inside their own Card. In `onboarding` / `reprompt`
 * modes it wraps the body in a Drawer (mobile) or Dialog (desktop).
 */
export function InterestsPicker({
  mode,
  open,
  onOpenChange,
  defaultValue = [],
  onSaved,
}: InterestsPickerProps) {
  const isMobile = useIsMobile();

  if (mode === "settings" || mode === "inline") {
    return (
      <PickerBody
        mode={mode}
        defaultValue={defaultValue}
        onSaved={onSaved}
      />
    );
  }

  const handleClose = () => onOpenChange?.(false);

  if (isMobile) {
    return (
      <Drawer open={!!open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh] focus:outline-none">
          <DrawerTitle className="sr-only">{MODE_COPY[mode].title}</DrawerTitle>
          <DrawerDescription className="sr-only">
            {MODE_COPY[mode].subtitle}
          </DrawerDescription>
          <PickerBody
            mode={mode}
            defaultValue={defaultValue}
            onSaved={onSaved}
            onClose={handleClose}
          />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={!!open} onOpenChange={onOpenChange}>
      <DialogContent
        // [&>button]:hidden hides the default Radix close X (rendered as a
        // direct-child <button> by shadcn's DialogContent). We render our
        // own "Skip" button inside PickerBody so the action is explicit
        // and routes through the dismissed PATCH instead of just closing.
        // Skip is nested inside PickerBody's <div>, so it isn't matched
        // by the direct-child selector.
        className="max-w-md gap-0 p-0 sm:max-w-lg [&>button]:hidden"
      >
        <DialogTitle className="sr-only">{MODE_COPY[mode].title}</DialogTitle>
        <DialogDescription className="sr-only">
          {MODE_COPY[mode].subtitle}
        </DialogDescription>
        <PickerBody
          mode={mode}
          defaultValue={defaultValue}
          onSaved={onSaved}
          onClose={handleClose}
        />
      </DialogContent>
    </Dialog>
  );
}
