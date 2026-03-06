import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useResolvedImage, ImageContext } from "@/lib/imageResolver";

interface PersonAvatarProps {
  name: string;
  avatar?: string | null;
  imageSlug?: string | null;
  imageContext?: ImageContext;
  imageIndex?: number;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function PersonAvatar({ name, avatar, imageSlug, imageContext = "tile", imageIndex = 1, size = "md", className }: PersonAvatarProps) {
  const sizeClass = className ? className :
    size === "xs" ? "h-6 w-6" :
    size === "sm" ? "h-10 w-10" : 
    size === "lg" ? "h-16 w-16" :
    size === "xl" ? "h-32 w-32 sm:h-48 sm:w-48" :
    "h-12 w-12";

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const { src: resolvedSrc, onError: onResolvedError } = useResolvedImage(imageSlug, imageContext, imageIndex);

  // Prefer server-provided avatar (winning curate image URL) when present, so leaderboard
  // and profile show the same image. Otherwise use slug-based resolution then fallback.
  const hasServerAvatar = avatar && typeof avatar === "string" && /^https?:\/\//i.test(avatar.trim());
  const displaySrc = hasServerAvatar ? avatar! : (resolvedSrc || avatar || null);
  const onError = hasServerAvatar ? undefined : onResolvedError;

  return (
    <Avatar className={`${sizeClass} rounded-md`} data-testid={`avatar-${name.toLowerCase().replace(/\s/g, '-')}`}>
      {displaySrc && <AvatarImage key={displaySrc} src={displaySrc} alt={name} className="object-cover" onError={onError} />}
      <AvatarFallback className="bg-primary/10 text-primary font-semibold rounded-md">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
