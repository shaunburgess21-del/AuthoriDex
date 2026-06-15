import { Globe2 } from "lucide-react";
import * as Flags from "country-flag-icons/react/3x2";
import { cn } from "@/lib/utils";
import { resolveCountryCode } from "@shared/countries";

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
 * Renders the SVG flag for a country. Accepts an ISO 3166-1 alpha-2 code, a
 * full country name, or a known alias — all resolved via resolveCountryCode,
 * so legacy free-text values (e.g. an old "South Africa" string that pre-dates
 * the combobox migration) still render a flag. Falls back to a globe icon when
 * the value is missing or cannot be resolved to a known country.
 */
export function CountryFlag({ code, className, title }: CountryFlagProps) {
  const upper = resolveCountryCode(code);
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
