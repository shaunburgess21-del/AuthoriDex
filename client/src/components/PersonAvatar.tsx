import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface PersonAvatarProps {
  name: string;
  avatar?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}

export function PersonAvatar({ name, avatar, size = "md" }: PersonAvatarProps) {
  const sizeClass = 
    size === "sm" ? "h-10 w-10" : 
    size === "lg" ? "h-16 w-16" :
    size === "xl" ? "h-48 w-48" :
    "h-12 w-12";

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Avatar className={`${sizeClass} rounded-md`} data-testid={`avatar-${name.toLowerCase().replace(/\s/g, '-')}`}>
      {avatar && <AvatarImage src={avatar} alt={name} className="object-cover" />}
      <AvatarFallback className="bg-primary/10 text-primary font-semibold rounded-md">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
