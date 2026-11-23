import { toast } from "sonner";
import {
  currentShareContext,
  isShareCancelled,
  shareWithSystemSheet,
  toPublicShareUrl,
} from "@/lib/nativeShare";
import { appendShareAttribution, type ShareSurface } from "@/lib/share";

/** Same shape `captureReferralFromUrl` accepts. Anything else is dropped. */
export const REFERRAL_CODE_PATTERN = /^VX[A-Z0-9]{6}$/;

export const LINK_COPIED_TOAST = "Link copied";

export type ShareDelivery = "shared" | "copied" | "cancelled" | "failed";

export interface VoteCardShareInput {
  headline: string;
  percent: number;
  path: string;
  surface: ShareSurface;
  sharerUserId?: string | null;
  referralCode?: string | null;
}

export interface ShareDeliveryDeps {
  systemSheet: (options: {
    title?: string;
    text?: string;
    url?: string;
  }) => Promise<"shared" | "cancelled" | "unavailable">;
  webShare: ((data: { title?: string; text?: string; url?: string }) => Promise<void>) | null;
  writeText: (value: string) => Promise<void>;
  fallbackCopy?: (value: string) => boolean;
  notifyCopied: (message: string) => void;
  notifyFailed?: (message: string) => void;
}

/**
 * Prefill for the crowd-line share. The percent is the user's share,
 * the same number the crowd line already shows.
 */
export function voteCrowdShareText(percent: number, headline: string): string {
  const safe = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  const title = headline.replace(/"/g, "'").replace(/\s+/g, " ").trim() || "this vote";
  return `I'm with ${safe}% on "${title}" on VoxDex`;
}

export function referralCodeForShare(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalised = code.trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(normalised) ? normalised : null;
}

/** Adds `?ref=` when the code matches the inbound referral capture. */
export function withReferralParam(url: string, referralCode: string | null | undefined): string {
  const code = referralCodeForShare(referralCode);
  if (!code) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.searchParams.has("ref")) parsed.searchParams.set("ref", code);
  return parsed.toString();
}

/**
 * Card link plus the existing share attribution. The referral code is
 * appended only when it would survive `captureReferralFromUrl`.
 */
export function buildVoteCardShareUrl(input: VoteCardShareInput): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://voxdex.com";
  const base = new URL(input.path, origin).toString();
  const attributed = appendShareAttribution(base, {
    sharerUserId: input.sharerUserId ?? null,
    surface: input.surface,
  });
  const withRef = withReferralParam(attributed, input.referralCode);
  return toPublicShareUrl(withRef, currentShareContext());
}

function copyWithTextarea(value: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Native sheet, then `navigator.share`, then copy. A copied link toasts
 * `Link copied`. Cancelling the sheet does not toast.
 */
export async function deliverShareLink(
  payload: { title: string; text: string; url: string },
  deps: ShareDeliveryDeps,
): Promise<ShareDelivery> {
  const sheet = await deps.systemSheet({
    title: payload.title,
    text: payload.text,
    url: payload.url,
  });
  if (sheet === "shared" || sheet === "cancelled") return sheet;

  if (deps.webShare) {
    try {
      await deps.webShare({ title: payload.title, text: payload.text, url: payload.url });
      return "shared";
    } catch (err) {
      if (isShareCancelled(err)) return "cancelled";
    }
  }

  try {
    await deps.writeText(payload.url);
  } catch {
    const copied = deps.fallbackCopy?.(payload.url) ?? false;
    if (!copied) {
      deps.notifyFailed?.("Could not copy link");
      return "failed";
    }
  }
  deps.notifyCopied(LINK_COPIED_TOAST);
  return "copied";
}

function browserShareDeps(): ShareDeliveryDeps {
  const webShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function"
      ? (data: { title?: string; text?: string; url?: string }) => navigator.share(data)
      : null;
  return {
    systemSheet: shareWithSystemSheet,
    webShare,
    writeText: async (value: string) => {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(value);
    },
    fallbackCopy: copyWithTextarea,
    notifyCopied: (message) => {
      toast.success(message, { duration: 1500 });
    },
    notifyFailed: (message) => {
      toast.error(message);
    },
  };
}

export async function shareVoteCard(
  input: VoteCardShareInput,
  deps: ShareDeliveryDeps = browserShareDeps(),
): Promise<ShareDelivery> {
  const text = voteCrowdShareText(input.percent, input.headline);
  const url = buildVoteCardShareUrl(input);
  return deliverShareLink({ title: text, text, url }, deps);
}
