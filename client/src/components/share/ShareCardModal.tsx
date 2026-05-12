import { useEffect, useMemo, useRef, useState } from "react";
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
import { toast } from "sonner";
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
  // Cached blob from pre-generation. When the user clicks "Share" we use
  // this directly so `navigator.share()` is called within the click's
  // user-activation window. Without this the awaited generate() blows the
  // gesture budget on first click (1–2s for fonts + image decode) and
  // Chrome silently rejects the file-share intent, dropping us into the
  // clipboard fallback instead of the native share sheet.
  const cachedBlobRef = useRef<Blob | null>(null);
  // Tracks the (data, aspect) the cached blob corresponds to so we can
  // invalidate it on switch. Kept as refs (not state) to avoid re-renders.
  const cachedDataRef = useRef<ShareCardData | null>(null);
  const cachedAspectRef = useRef<ShareAspect | null>(null);

  // Reset state whenever the modal opens for a new data set. Avoids stale
  // "Copied" ticks after re-opening.
  useEffect(() => {
    if (open) {
      setCopied(false);
      setCopiedText(false);
      setPendingAction(null);
      cachedBlobRef.current = null;
      cachedDataRef.current = null;
      cachedAspectRef.current = null;
    }
  }, [open, data]);

  const dims = SHARE_DIMENSIONS[aspect];
  // `generating` is intentionally not destructured — we manage the
  // user-visible "generating" UX via `pendingAction` so the spinner can be
  // bound to the specific button (Share / Copy image / Download) the user
  // tapped, rather than blocking all three at once.
  const { cardRef, generate } = useShareCardImage({
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

  // Responsive preview width. The card is rendered at full size off-screen,
  // then scaled into a wrapper that fits inside the dialog's content area.
  // On mobile the dialog is full-width with p-6 (48px total side padding);
  // on sm+ it caps at max-w-lg (512px) → 464px usable. We clamp to 420 so
  // the desktop layout doesn't change. The previous fixed 420 was forcing
  // the (grid) dialog wider than the viewport on phones, cutting off the
  // preview and the action buttons on the right edge.
  const [previewMaxWidth, setPreviewMaxWidth] = useState(420);
  useEffect(() => {
    if (!open) return;
    const compute = () => {
      if (typeof window === "undefined") return;
      // Mirror the Dialog's own sizing: full-width minus 32px horizontal
      // gutter on phones (no rounded edges), capped at max-w-lg (512px) on
      // sm+. Subtract p-6 padding (24px each side = 48px total).
      const vw = window.innerWidth;
      const dialogOuter = Math.min(vw, 512);
      const usable = Math.max(0, dialogOuter - 48);
      setPreviewMaxWidth(Math.max(240, Math.min(420, usable)));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [open]);
  const previewScale = previewMaxWidth / dims.width;
  const previewHeight = dims.height * previewScale;

  const cacheValid = () =>
    cachedBlobRef.current !== null &&
    cachedDataRef.current === data &&
    cachedAspectRef.current === aspect;

  // Pre-generate the share blob whenever the modal opens (or aspect / data
  // changes). Runs after a short delay so the off-screen card's avatar +
  // fonts have a chance to decode — the first toBlob() call on a freshly
  // mounted card can otherwise take >1s, which is what was killing the
  // navigator.share user-gesture window on first click.
  useEffect(() => {
    if (!open || !data) return;
    if (cacheValid()) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const blob = await generate();
        if (cancelled) return;
        cachedBlobRef.current = blob;
        cachedDataRef.current = data;
        cachedAspectRef.current = aspect;
      } catch (err) {
        // Pre-warm failure is non-fatal — the click handler will retry.
        // eslint-disable-next-line no-console
        console.warn("[ShareCardModal] pre-warm generate failed", err);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data, aspect, generate]);

  const ensureBlob = async (): Promise<Blob | null> => {
    if (cacheValid()) {
      return cachedBlobRef.current;
    }
    try {
      const blob = await generate();
      cachedBlobRef.current = blob;
      cachedDataRef.current = data;
      cachedAspectRef.current = aspect;
      return blob;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ShareCardModal] generate failed", err);
      toast.error("Couldn't create image", {
        description: "Try again, or use the Copy text button as a fallback.",
      });
      return null;
    }
  };

  const handleShare = async () => {
    if (pendingAction) return;
    setPendingAction("share");
    const blob = await ensureBlob();
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
    const blob = await ensureBlob();
    if (!blob) {
      setPendingAction(null);
      return;
    }
    const ok = await copyImageToClipboard(blob);
    setPendingAction(null);
    if (ok) {
      setCopied(true);
      toast.success("Image copied!", { description: "Paste it into X, IG, Slack, anywhere." });
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Clipboard blocked", {
        description: "Download the image instead — it works everywhere.",
      });
    }
  };

  const handleDownload = async () => {
    if (pendingAction) return;
    setPendingAction("download");
    const blob = await ensureBlob();
    setPendingAction(null);
    if (!blob) return;
    downloadBlob(blob, filename);
    toast.success("Image downloaded", { description: filename });
  };

  const handleCopyText = async () => {
    if (!fallbackText) return;
    try {
      await navigator.clipboard.writeText(fallbackText);
      setCopiedText(true);
      toast.success("Text copied to clipboard");
      setTimeout(() => setCopiedText(false), 2000);
    } catch {
      toast.error("Could not copy text");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `overflow-x-hidden` + `min-w-0` keep the dialog from being pushed
          wider than the viewport by the fixed-size preview wrapper. The
          dialog uses `grid` internally and grid items default to
          `min-content` width, which was the root cause of the right-edge
          cut-off testers reported on mobile. We avoid `overflow-hidden`
          so vertical content (header + preview + button row) can still
          extend naturally on short viewports. */}
      <DialogContent className="max-w-xl overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Share your card</DialogTitle>
          <DialogDescription>
            Pick a format, then share, copy, or download. Great for X, Instagram, WhatsApp.
          </DialogDescription>
        </DialogHeader>

        {/* Aspect toggle */}
        <div className="flex items-center gap-2 min-w-0">
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

        {/* Preview — width is responsive (clamped to 420 on desktop,
            shrinks on mobile so it never exceeds the dialog body). */}
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

        {/* Action buttons — `min-w-0` so wrapping kicks in cleanly on
            narrow viewports (the previous layout would overflow the
            dialog's right edge when "Download" + "Copy text" didn't
            quite fit on the share row). */}
        <div className="flex flex-wrap items-center gap-2 pt-2 min-w-0">
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
              className="gap-2 text-xs"
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
