import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minimize2, X } from "lucide-react";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { Button } from "@/components/ui/button";

const COMPOSER_MAX_HEIGHT_PX = 160;

type ComposerMode = "auto" | "manual" | "fullscreen";

export interface CommentComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  isPending: boolean;
  disabled?: boolean;
  authorAvatarUrl: string | null;
  authorDisplayName: string;
  replyTo: { id: string; username: string } | null;
  onCancelReply: () => void;
  supportsFullscreen?: boolean;
  parentExpanded?: boolean;
  variant?: "card" | "inline";
  testIds?: {
    input?: string;
    inputFullscreen?: string;
    submit?: string;
    submitFullscreen?: string;
    cancel?: string;
    cancelFullscreen?: string;
  };
}

export function CommentComposer({
  value,
  onChange,
  onSubmit,
  placeholder = "Share your thoughts...",
  isPending,
  disabled = false,
  authorAvatarUrl,
  authorDisplayName,
  replyTo,
  onCancelReply,
  supportsFullscreen = true,
  parentExpanded = false,
  variant = "card",
  testIds,
}: CommentComposerProps) {
  const [composerMode, setComposerMode] = useState<ComposerMode>("auto");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fullscreenInputRef = useRef<HTMLTextAreaElement>(null);
  const composerContainerRef = useRef<HTMLDivElement>(null);
  const wasPendingRef = useRef(false);

  const isManualComposer = composerMode === "manual";
  const isFullscreenComposer = composerMode === "fullscreen";
  const inlineExpanded = variant === "inline" && isFullscreenComposer;

  const showButtons = isFocused || value.length > 0;
  const submitDisabled = disabled || !value.trim() || isPending;

  const resizeAutoComposer = useCallback((textarea: HTMLTextAreaElement) => {
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT_PX);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    if (composerMode !== "auto") {
      textarea.style.height = "";
      textarea.style.overflowY = "";
      return;
    }
    resizeAutoComposer(textarea);
  }, [composerMode, value, resizeAutoComposer]);

  useEffect(() => {
    if (composerMode === "fullscreen" && !parentExpanded) {
      setComposerMode("auto");
    }
  }, [composerMode, parentExpanded]);

  useEffect(() => {
    if (composerMode === "fullscreen") {
      setTimeout(() => fullscreenInputRef.current?.focus(), 50);
    }
  }, [composerMode]);

  // Post-success behaviour: when isPending falls true -> false and the body
  // has been cleared (the hook clears on success, not on error), reset the
  // composer to its full rest state per the C2 state diagram:
  // mode -> auto, blur whichever input had focus, fullscreen exits via the
  // mode reset which unmounts the overlay.
  useEffect(() => {
    if (wasPendingRef.current && !isPending && !value) {
      setComposerMode("auto");
      inputRef.current?.blur();
      fullscreenInputRef.current?.blur();
    }
    wasPendingRef.current = isPending;
  }, [isPending, value]);

  // When a reply target is set, switch to manual mode and focus the inline
  // textarea (mirrors the old CardComments startReply imperative path).
  useEffect(() => {
    if (!replyTo) return;
    setComposerMode("manual");
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [replyTo]);

  const handleComposerToggle = useCallback(() => {
    if (!supportsFullscreen) return;
    setComposerMode((mode) => {
      if (mode !== "auto") return "auto";
      const nextMode = parentExpanded ? "fullscreen" : "manual";
      if (nextMode === "manual") {
        requestAnimationFrame(() => {
          composerContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
          window.setTimeout(() => {
            window.scrollBy({ top: 80, behavior: "smooth" });
          }, 300);
        });
      }
      return nextMode;
    });
  }, [parentExpanded, supportsFullscreen]);

  // Cancel = abandon draft. Clears value, dismisses any reply intent, exits
  // fullscreen if active, blurs the focused textarea. Buttons fade out via
  // showButtons because both isFocused and value end up falsy.
  const handleCancel = useCallback(() => {
    onChange("");
    onCancelReply();
    setComposerMode("auto");
    inputRef.current?.blur();
    fullscreenInputRef.current?.blur();
  }, [onChange, onCancelReply]);

  // Keyboard semantics (Q10 Option B):
  // - Enter alone: insert newline (default browser behaviour, no preventDefault)
  // - Cmd/Ctrl + Enter: submit
  // - Escape: cancel (clear + cancel reply + exit fullscreen + blur)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onSubmit();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [onSubmit, handleCancel],
  );

  const buttonRowClass = `mt-2 flex items-center justify-end gap-2 motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-out ${
    showButtons ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
  }`;

  const postButtonClass =
    "inline-flex items-center justify-center gap-2 min-h-9 rounded-md px-4 text-sm font-medium" +
    " bg-[#3C83F6] text-white hover:bg-[#3C83F6]/90 active:bg-[#3C83F6]/80" +
    " disabled:opacity-50 disabled:pointer-events-none" +
    " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3C83F6]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background" +
    " transition-colors";

  const renderActionRow = (idSuffix: "" | "-fullscreen") => {
    const isFullscreen = idSuffix === "-fullscreen";
    return (
      <div className={buttonRowClass} aria-hidden={!showButtons}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCancel}
          className="min-h-9"
          tabIndex={showButtons ? 0 : -1}
          data-testid={(isFullscreen ? testIds?.cancelFullscreen : testIds?.cancel) ?? `button-cancel-comment${idSuffix}`}
        >
          Cancel
        </Button>
        <button
          type="button"
          disabled={submitDisabled}
          onClick={onSubmit}
          tabIndex={showButtons ? 0 : -1}
          className={postButtonClass}
          data-testid={(isFullscreen ? testIds?.submitFullscreen : testIds?.submit) ?? `button-submit-comment${idSuffix}`}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Posting…" : "Post"}
        </button>
      </div>
    );
  };

  return (
    <>
      <div
        ref={composerContainerRef}
        className={`pt-3 border-t border-border/20${inlineExpanded ? " flex-1 flex flex-col" : ""}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 4px)" }}
      >
        {replyTo && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-xs text-cyan-600 dark:text-cyan-400">
              Replying to @{replyTo.username}
            </span>
            <button
              onClick={onCancelReply}
              className="text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className={`flex gap-2 items-start${inlineExpanded ? " flex-1" : ""}`}>
          <div className="flex h-[42px] shrink-0 items-center">
            <UserProfileAvatar
              displayName={authorDisplayName}
              avatarUrl={authorAvatarUrl}
              className="h-7 w-7"
              fallbackClassName="text-[10px]"
            />
          </div>
          <div className={`flex-1 min-w-0${inlineExpanded ? " flex flex-col" : ""}`}>
            <div className={`relative${inlineExpanded ? " flex-1 min-h-0 flex flex-col" : ""}`}>
              <textarea
                ref={inputRef}
                placeholder={replyTo ? `Reply to @${replyTo.username}...` : placeholder}
                value={value}
                onChange={(e) => {
                  onChange(e.target.value);
                  if (composerMode === "auto") {
                    resizeAutoComposer(e.currentTarget);
                  }
                }}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                className={`block w-full bg-muted/30 border border-border/30 rounded-xl px-3 py-2 ${supportsFullscreen ? "pr-12" : "pr-3"} text-base resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 focus:border-border/30${isManualComposer ? " h-40 overflow-y-auto" : ""}${inlineExpanded ? " flex-1 min-h-0" : ""}`}
                rows={1}
                data-testid={testIds?.input ?? "input-comment"}
              />
              {supportsFullscreen && (
                <div className="absolute right-2 bottom-1.5 flex items-center">
                  <button
                    onClick={handleComposerToggle}
                    onPointerUp={(event) => event.currentTarget.blur()}
                    className="flex h-8 w-8 items-center justify-center text-slate-300 hover:text-slate-100 transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    type="button"
                    aria-label={composerMode === "auto" ? "Expand comment input" : "Collapse comment input"}
                    aria-pressed={composerMode !== "auto"}
                  >
                    {composerMode === "auto" ? <Maximize2 className="h-5 w-5" /> : <Minimize2 className="h-5 w-5" />}
                  </button>
                </div>
              )}
            </div>
            {renderActionRow("")}
          </div>
        </div>
      </div>

      {isFullscreenComposer && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-background p-4 safe-top" data-testid="comment-composer-fullscreen">
          <div className="mb-3 flex items-center justify-between border-b border-border/20 pb-3">
            <div>
              <p className="text-sm font-semibold">Write a comment</p>
              {replyTo && (
                <p className="text-xs text-cyan-600 dark:text-cyan-400">
                  Replying to @{replyTo.username}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setComposerMode("auto")}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Close full-screen composer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="relative flex-1 min-h-0">
            <textarea
              ref={fullscreenInputRef}
              placeholder={replyTo ? `Reply to @${replyTo.username}...` : placeholder}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              className="h-full w-full resize-none rounded-2xl border border-border/30 bg-muted/30 px-4 py-4 text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 focus:border-border/30"
              data-testid={testIds?.inputFullscreen ?? "input-comment-fullscreen"}
            />
          </div>
          {renderActionRow("-fullscreen")}
        </div>
      )}
    </>
  );
}
