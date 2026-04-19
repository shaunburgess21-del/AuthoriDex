import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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

  return (
    <Avatar
      className={cn(SIZE_CLASS[size], "rounded-full", className)}
      data-testid={testId}
    >
      {avatarUrl ? (
        <AvatarImage
          src={avatarUrl}
          alt={name || "User avatar"}
          className="rounded-full object-cover"
        />
      ) : null}
      <AvatarFallback
        className={cn(
          "rounded-full",
          gradient,
          HUMAN_AVATAR_FALLBACK_CLASS,
          SIZE_TEXT_CLASS[size],
          fallbackClassName,
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

export default UserProfileAvatar;
