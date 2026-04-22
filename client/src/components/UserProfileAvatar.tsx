import { useEffect, useState } from "react";
import {
  getAvatarInitials,
  getAvatarGradient,
  HUMAN_AVATAR_FALLBACK_CLASS,
} from "@/lib/avatar";
import { cn } from "@/lib/utils";

type UserProfileAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<UserProfileAvatarSize, string> = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-16 w-16",
  xl: "h-24 w-24",
};

const SIZE_TEXT_CLASS: Record<UserProfileAvatarSize, string> = {
  xs: "text-[10px]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-lg",
  xl: "text-2xl",
};

type RemoteImageStatus = "idle" | "loading" | "loaded" | "error";

interface UserProfileAvatarProps {
  displayName: string | null | undefined;
  avatarUrl?: string | null;
  size?: UserProfileAvatarSize;
  /** Tailwind classes merged onto the Avatar root — use for size overrides (e.g. "h-7 w-7"). */
  className?: string;
  /** Extra classes on the fallback, e.g. a custom text-size override. */
  fallbackClassName?: string;
  testId?: string;
}

/**
 * Circular user avatar. Enforces the product design rule that user photos
 * are always round (distinct from celebrity/content photos which stay
 * rounded-square via PersonAvatar). Fallback is always initials on a
 * gradient; never a broken-image icon.
 *
 * When `avatarUrl` is set, shows a neutral skeleton (not initials) until the
 * image loads, so Radix Avatar does not flash initials while the photo decodes.
 */
export function UserProfileAvatar({
  displayName,
  avatarUrl,
  size = "md",
  className,
  fallbackClassName,
  testId,
}: UserProfileAvatarProps) {
  const name = displayName ?? "";
  const gradient = getAvatarGradient(name);
  const initials = getAvatarInitials(name);

  const [remoteStatus, setRemoteStatus] = useState<RemoteImageStatus>(() =>
    avatarUrl ? "loading" : "idle",
  );

  useEffect(() => {
    if (!avatarUrl) {
      setRemoteStatus("idle");
      return;
    }
    setRemoteStatus("loading");
  }, [avatarUrl]);

  const initialsEl = (
    <div
      className={cn(
        SIZE_CLASS[size],
        "flex shrink-0 items-center justify-center rounded-full",
        gradient,
        HUMAN_AVATAR_FALLBACK_CLASS,
        SIZE_TEXT_CLASS[size],
        fallbackClassName,
        className,
      )}
      data-testid={testId}
    >
      {initials}
    </div>
  );

  if (!avatarUrl) {
    return initialsEl;
  }

  if (remoteStatus === "error") {
    return initialsEl;
  }

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full",
        SIZE_CLASS[size],
        className,
      )}
      data-testid={testId}
    >
      {remoteStatus === "loading" && (
        <div
          className="absolute inset-0 z-0 animate-pulse rounded-full bg-muted"
          aria-hidden
        />
      )}
      <img
        key={avatarUrl}
        src={avatarUrl}
        alt={name || "User avatar"}
        className={cn(
          "relative z-10 h-full w-full rounded-full object-cover transition-opacity duration-200",
          remoteStatus === "loaded" ? "opacity-100" : "opacity-0",
        )}
        onLoad={() => setRemoteStatus("loaded")}
        onError={() => setRemoteStatus("error")}
      />
    </div>
  );
}

export default UserProfileAvatar;
