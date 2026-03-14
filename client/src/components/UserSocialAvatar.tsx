import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarInitials, getAvatarGradient } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * Circular avatar for user/social contexts (Town Square, activity feeds, etc.).
 * Differentiates from celebrity avatars (square with rounded corners) by being circular
 * and using a gradient with subtle pixelated pattern for fallback.
 */
interface UserSocialAvatarProps {
  displayName: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
  className?: string;
  onClick?: () => void;
}

export function UserSocialAvatar({
  displayName,
  avatarUrl,
  isAgent = false,
  className,
  onClick,
}: UserSocialAvatarProps) {
  const gradient = getAvatarGradient(displayName);
  const initials = getAvatarInitials(displayName);

  const wrapperClass = cn(
    "shrink-0 rounded-full overflow-hidden ring-2 ring-white/10",
    onClick && "cursor-pointer"
  );
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      aria-label={onClick ? `View ${displayName}'s profile` : undefined}
      className={wrapperClass}
    >
      <Avatar className={cn("h-9 w-9 rounded-full", className)}>
        {avatarUrl && !isAgent ? (
          <AvatarImage src={avatarUrl} alt={displayName} className="rounded-full object-cover" />
        ) : (
          <AvatarFallback
            className={cn("rounded-full text-white font-semibold", gradient)}
          >
            {initials}
          </AvatarFallback>
        )}
      </Avatar>
    </div>
  );
}
