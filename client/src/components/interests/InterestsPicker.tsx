// Interest Picker — Phase 1 shared modal.
//
// Renders the same content in three "modes" so the picker is reusable for:
//   * onboarding  — first-time prompt after /login/welcome (Skip available)
//   * settings    — inline card on /me/settings (no Skip, persistent)
//   * reprompt    — soft re-prompt for skippers (Skip = "Not now")
//
// Layout:
//   * Mobile (<768px): vaul Drawer for thumb-reach (mirrors OnboardingDrawer).
//   * Desktop:         Radix Dialog centered modal.
//   * Settings mode:   never wrapped — caller embeds the body in a Card.
//
// Persistence:
//   * Save  -> PATCH /api/profile/me/interests { interests: [...] }
//   * Skip  -> PATCH /api/profile/me/interests { interests: [], dismissed: true }
//
// Saving an empty selection without `dismissed` is a "clear all" — used by
// the Settings card. The server treats that as "no interests, not dismissed"
// so cold-start ordering kicks back in.

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
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
import { cn } from "@/lib/utils";

export type InterestsPickerMode = "onboarding" | "settings" | "reprompt";

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
  // cold-start ordering on). Modal modes only enable the CTA when something
  // is picked so users don't accidentally "Let's go" with an empty set.
  const canSave =
    !saving && (mode === "settings" ? dirty : selected.size > 0);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/profile/me/interests", {
        interests: Array.from(selected),
      });
      await refreshProfile();
      if (mode === "settings") {
        toast.success("Interests saved");
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
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
    <div className="relative flex flex-col gap-5 px-5 pb-6 pt-5 sm:px-6 sm:pt-6">
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

      <div className="pr-10">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
          {copy.title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
      </div>

      <div
        role="group"
        aria-label="Category interests"
        className="flex flex-wrap gap-2"
        data-testid="interests-pill-grid"
      >
        {CANONICAL_CATEGORIES.map((cat) => {
          const isSelected = selected.has(cat.id);
          const style = getCategoryStyle(cat.id);
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => toggle(cat.id)}
              aria-pressed={isSelected}
              data-testid={`interest-pill-${cat.id}`}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-all duration-150 active:scale-95",
                isSelected
                  ? `${style.bg} ${style.border} ${style.text}`
                  : "border-border bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              )}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      <Button
        onClick={handleSave}
        disabled={!canSave}
        className="w-full"
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

  if (mode === "settings") {
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
        className="max-w-md gap-0 p-0 sm:max-w-lg"
        // Hide the default Radix close X — we render our own Skip button
        // inside PickerBody so the action is explicit (and routes through
        // the dismissed PATCH instead of just closing).
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
