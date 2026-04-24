import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, Loader2, Share2, Square, RectangleHorizontal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  canCopyImageToClipboard,
  canUseNativeShare,
  copyImageToClipboard,
  downloadBlob,
  shareImage,
} from "@/lib/share";
import { useShareCardImage } from "@/hooks/useShareCardImage";
import { ShareCard, SHARE_DIMENSIONS, type ShareAspect, type ShareCardData } from "./ShareCard";

interface ShareCardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ShareCardData | null;
  /** Optional fallback text for native share / "Copy text" action. */
  fallbackText?: string;
  /** Optional URL included alongside the image on native share. */
  shareUrl?: string;
  /** Suggested filename (without extension) for downloads. */
  filenameBase?: string;
}

/**
 * Modal that previews a `ShareCard` and lets the user share/copy/download.
 *
 * Implementation notes:
 * - The real-size card (1080x1080 / 1200x630) is rendered *off-screen* in a
 *   fixed-position wrapper so html-to-image sees a properly laid-out DOM
 *   tree without affecting page layout or scrollbar behaviour.
 * - The modal shows a scaled-down preview so mobile users can see the
 *   entire card without horizontal scroll.
 * - Buttons are feature-detected: "Share" only appears if `navigator.share`
 *   is available; "Copy image" only if clipboard image writes are supported.
 *   Download always appears — it's the universal fallback.
 */
export function ShareCardModal({
  open,
  onOpenChange,
  data,
  fallbackText,
  shareUrl,
  filenameBase = "voxdex-share",
}: ShareCardModalProps) {
  const [aspect, setAspect] = useState<ShareAspect>("square");
  const [pendingAction, setPendingAction] = useState<null | "share" | "copy" | "download">(null);
  const [copied, setCopied] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const { toast } = useToast();

  // Reset state whenever the modal opens for a new data set. Avoids stale
  // "Copied" ticks after re-opening.
  useEffect(() => {
    if (open) {
      setCopied(false);
      setCopiedText(false);
      setPendingAction(null);
    }
  }, [open, data]);

  const dims = SHARE_DIMENSIONS[aspect];
  const { cardRef, generate, generating } = useShareCardImage({
    width: dims.width,
    height: dims.height,
  });

  // Decide which action buttons are available. We compute this once on mount
  // rather than on every render so the button layout doesn't flicker.
  const availability = useMemo(
    () => ({
      native: canUseNativeShare(),
      clipboard: canCopyImageToClipboard(),
    }),
    [],
  );

  const filename = `${filenameBase}-${aspect}.png`;

  const runGenerate = async (): Promise<Blob | null> => {
    try {
      return await generate();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ShareCardModal] generate failed", err);
      toast({
        title: "Couldn't create image",
        description: "Try again, or use the Copy text button as a fallback.",
        variant: "destructive",
      });
      return null;
    }
  };

  const handleShare = async () => {
    if (pendingAction) return;
    setPendingAction("share");
    const blob = await runGenerate();
    if (!blob) {
      setPendingAction(null);
      return;
    }
    const result = await shareImage(blob, {
      title: "VoxDex",
      text: fallbackText,
      url: shareUrl,
      filename,
    });
    setPendingAction(null);
    if (result.status === "shared" || result.status === "copied" || result.status === "downloaded") {
      // Close the modal after a successful share path so the user returns to
      // wherever they were rather than sitting on a stale preview.
      setTimeout(() => onOpenChange(false), 300);
    }
  };

  const handleCopyImage = async () => {
    if (pendingAction) return;
    setPendingAction("copy");
    const blob = await runGenerate();
    if (!blob) {
      setPendingAction(null);
      return;
    }
    const ok = await copyImageToClipboard(blob);
    setPendingAction(null);
    if (ok) {
      setCopied(true);
      toast({ title: "Image copied!", description: "Paste it into X, IG, Slack, anywhere." });
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast({
        title: "Clipboard blocked",
        description: "Download the image instead — it works everywhere.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = async () => {
    if (pendingAction) return;
    setPendingAction("download");
    const blob = await runGenerate();
    setPendingAction(null);
    if (!blob) return;
    downloadBlob(blob, filename);
    toast({ title: "Image downloaded", description: filename });
  };

  const handleCopyText = async () => {
    if (!fallbackText) return;
    try {
      await navigator.clipboard.writeText(fallbackText);
      setCopiedText(true);
      toast({ title: "Text copied to clipboard" });
      setTimeout(() => setCopiedText(false), 2000);
    } catch {
      toast({ title: "Could not copy text", variant: "destructive" });
    }
  };

  // Scale the (real-size) card into the preview slot. The preview slot has
  // a fixed max-width; we compute the scale factor so the whole card fits.
  const previewMaxWidth = 420;
  const previewScale = previewMaxWidth / dims.width;
  const previewHeight = dims.height * previewScale;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Share your card</DialogTitle>
          <DialogDescription>
            Pick a format, then share, copy, or download. Great for X, Instagram, WhatsApp.
          </DialogDescription>
        </DialogHeader>

        {/* Aspect toggle */}
        <div className="flex items-center gap-2">
          <AspectButton
            active={aspect === "square"}
            onClick={() => setAspect("square")}
            label="Square"
            sub="1080 × 1080"
            icon={Square}
          />
          <AspectButton
            active={aspect === "landscape"}
            onClick={() => setAspect("landscape")}
            label="Landscape"
            sub="1200 × 630"
            icon={RectangleHorizontal}
          />
        </div>

        {/* Preview */}
        <div
          className="relative mx-auto overflow-hidden rounded-xl border border-white/10 bg-[#0B0B1B] shadow-[0_10px_30px_-15px_rgba(0,0,0,0.6)]"
          style={{
            width: previewMaxWidth,
            height: previewHeight,
          }}
        >
          {data && (
            <div
              style={{
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
                width: dims.width,
                height: dims.height,
              }}
            >
              <ShareCard data={data} aspect={aspect} />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {availability.native && (
            <Button
              onClick={handleShare}
              disabled={!data || !!pendingAction}
              className="gap-2"
              data-testid="share-card-native"
            >
              {pendingAction === "share" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
              Share
            </Button>
          )}
          {availability.clipboard && (
            <Button
              variant="outline"
              onClick={handleCopyImage}
              disabled={!data || !!pendingAction}
              className="gap-2"
              data-testid="share-card-copy-image"
            >
              {pendingAction === "copy" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : copied ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copy image
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={!data || !!pendingAction}
            className="gap-2"
            data-testid="share-card-download"
          >
            {pendingAction === "download" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download
          </Button>
          {fallbackText && (
            <Button
              variant="ghost"
              onClick={handleCopyText}
              className="ml-auto gap-2 text-xs"
              data-testid="share-card-copy-text"
            >
              {copiedText ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Copy text
            </Button>
          )}
        </div>

        {/* Off-screen real-size card used for snapshots. We keep it mounted so
            html-to-image can read laid-out dimensions; positioning off-screen
            (not display:none) means images & fonts actually render. */}
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            pointerEvents: "none",
            zIndex: -1,
            opacity: 0,
            transform: "translate(-200vw, -200vh)",
          }}
        >
          {data && <ShareCard ref={cardRef} data={data} aspect={aspect} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AspectButton({
  active,
  onClick,
  label,
  sub,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
  icon: typeof Square;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-1 inline-flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
        active
          ? "border-violet-500/60 bg-violet-500/10 text-foreground"
          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <div className="flex flex-col leading-tight">
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[10px] text-muted-foreground">{sub}</span>
      </div>
    </button>
  );
}
