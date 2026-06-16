import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Flag, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { appendShareAttribution } from "@/lib/share";
import { useAuth } from "@/contexts/AuthContext";

interface CommentActionDrawerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Omit to hide the Report button entirely. Surfaces without a server-side
   * report endpoint (e.g. CommunityInsights) pass `undefined` and the drawer
   * degrades to Share-only.
   */
  onReport?: (reason: string) => void;
  onDelete?: () => void;
  commentId: string | null;
  entitySlug: string;
}

const REPORT_REASONS = [
  "Spam or misleading",
  "Hate speech or harassment",
  "Misinformation",
  "Off-topic",
  "Other",
];

export function CommentActionDrawer({
  open,
  onClose,
  onReport,
  onDelete,
  commentId,
  entitySlug,
}: CommentActionDrawerProps) {
  const [showReportPicker, setShowReportPicker] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);

  useEffect(() => {
    if (!open) {
      setShowReportPicker(false);
      setReportSubmitted(false);
    }
  }, [open]);

  const { user } = useAuth();
  const handleShare = useCallback(async () => {
    const rawUrl = `${window.location.origin}${window.location.pathname}#comment-${commentId}`;
    const url = appendShareAttribution(rawUrl, {
      sharerUserId: user?.id ?? null,
      surface: "comment",
    });
    if (navigator.share) {
      try {
        await navigator.share({ title: "Check out this comment", url });
        onClose();
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          onClose();
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied!");
    } catch {
      toast.error("Could not copy link");
    }
    onClose();
  }, [commentId, entitySlug, onClose, user?.id]);

  const handleReport = useCallback((reason: string) => {
    setReportSubmitted((already) => {
      if (already) return already;
      onReport?.(reason);
      return true;
    });
  }, [onReport]);

  const handleDelete = useCallback(() => {
    onDelete?.();
  }, [onDelete]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70]" data-interactive="true">
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl animate-in slide-in-from-bottom duration-200 pb-[env(safe-area-inset-bottom,16px)]">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        {!showReportPicker ? (
          <div className="px-4 pb-4">
            <button
              onClick={handleShare}
              className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Share2 className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">Share</span>
            </button>
            {onReport && (
              <button
                onClick={() => setShowReportPicker(true)}
                className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Flag className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">Report</span>
              </button>
            )}
            {onDelete && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl hover:bg-destructive/10 transition-colors text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Trash2 className="h-5 w-5" />
                <span className="text-sm font-medium">Delete</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl hover:bg-muted/50 transition-colors mt-1 border-t border-border/10 pt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <X className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Cancel</span>
            </button>
          </div>
        ) : (
          <div className="px-4 pb-4">
            <h3 className="text-sm font-semibold mb-3 px-4">Why are you reporting this comment?</h3>
            {REPORT_REASONS.map((reason) => (
              <button
                key={reason}
                onClick={() => handleReport(reason)}
                disabled={reportSubmitted}
                className="flex items-center w-full px-4 py-3 rounded-xl hover:bg-muted/50 transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
              >
                {reason}
              </button>
            ))}
            <button
              onClick={() => setShowReportPicker(false)}
              className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl hover:bg-muted/50 transition-colors mt-1 border-t border-border/10 pt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="text-sm font-medium text-muted-foreground">Back</span>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
