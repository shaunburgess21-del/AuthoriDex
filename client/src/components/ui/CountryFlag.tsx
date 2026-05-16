import { Globe2 } from "lucide-react";
import * as Flags from "country-flag-icons/react/3x2";
import { cn } from "@/lib/utils";

interface CountryFlagProps {
  code: string | null | undefined;
  className?: string;
  title?: string;
}

const FLAG_LOOKUP = Flags as unknown as Record<
  string,
  React.ComponentType<{ title?: string; className?: string }> | undefined
>;

/**
 * Renders the SVG flag for an ISO 3166-1 alpha-2 country code.
 * Falls back to a globe icon when the code is missing, malformed,
 * or a legacy free-text value (e.g. an old "South Africa" string
 * that pre-dates the combobox migration).
 */
export function CountryFlag({ code, className, title }: CountryFlagProps) {
  const upper =
    typeof code === "string" && /^[A-Za-z]{2}$/.test(code.trim())
      ? code.trim().toUpperCase()
      : null;
  const Flag = upper ? FLAG_LOOKUP[upper] : undefined;
  if (!Flag) {
    return (
      <Globe2
        className={cn("h-4 w-4 text-muted-foreground", className)}
        aria-label={title ?? "Unknown country"}
      />
    );
  }
  return (
    <Flag
      title={title ?? upper ?? undefined}
      className={cn(
        "inline-block h-3.5 w-5 rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.05)]",
        className,
      )}
    />
  );
}
