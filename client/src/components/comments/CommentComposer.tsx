import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, Maximize2, Minimize2, X } from "lucide-react";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";

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
}: CommentComposerProps) {
  const [composerMode, setComposerMode] = useState<ComposerMode>("auto");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fullscreenInputRef = useRef<HTMLTextAreaElement>(null);
  const composerContainerRef = useRef<HTMLDivElement>(null);
  const wasPendingRef = useRef(false);

  const isManualComposer = composerMode === "manual";
  const isFullscreenComposer = composerMode === "fullscreen";
  const inlineExpanded = variant === "inline" && isFullscreenComposer;

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

  // Mirror the old CardComments post-success behaviour: when isPending falls
  // from true to false and the value has been cleared (the hook clears on
  // success), collapse the composer back to auto mode. Failed posts retain
  // their content so this branch is skipped.
  useEffect(() => {
    if (wasPendingRef.current && !isPending && !value) {
      setComposerMode("auto");
    }
    wasPendingRef.current = isPending;
  }, [isPending, value]);

  // Mirror the old CardComments startReply imperative path: when a reply
  // target is set, switch to manual mode and focus the inline textarea.
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

  const submitDisabled = disabled || !value.trim() || isPending;

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
              className="text-muted-foreground hover:text-foreground transition-colors"
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
          <div className={`flex-1 min-w-0 relative${inlineExpanded ? " flex flex-col" : ""}`}>
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              className={`block w-full bg-muted/30 border border-border/30 rounded-xl px-3 py-2 pr-16 text-base resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 focus:border-border/30${isManualComposer ? " h-40 overflow-y-auto" : ""}${inlineExpanded ? " flex-1 min-h-0" : ""}`}
              rows={1}
              data-testid="input-comment"
            />
            <div className="absolute right-2 bottom-1.5 flex items-center gap-1">
              {supportsFullscreen && (
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
              )}
              <button
                disabled={submitDisabled}
                onClick={onSubmit}
                className="flex h-8 w-8 items-center justify-center text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 disabled:text-muted-foreground/30 transition-colors"
                data-testid="button-submit-comment"
              >
                {isPending ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <Send className="h-6 w-6" />
                )}
              </button>
            </div>
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
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              className="h-full w-full resize-none rounded-2xl border border-border/30 bg-muted/30 px-4 py-4 pr-14 text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 focus:border-border/30"
              data-testid="input-comment-fullscreen"
            />
            <button
              disabled={submitDisabled}
              onClick={onSubmit}
              className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-cyan-600 shadow-sm backdrop-blur dark:text-cyan-400 disabled:text-muted-foreground/30"
              data-testid="button-submit-comment-fullscreen"
            >
              {isPending ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Send className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
