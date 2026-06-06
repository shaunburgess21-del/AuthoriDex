import type { SiteBannerLinkDisplay } from "@shared/schema";

export function resolveSiteBannerLinkLabel(linkLabel: string | null | undefined): string {
  const trimmed = linkLabel?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Learn more";
}

export function normalizeSiteBannerLinkDisplay(
  linkDisplay: string | null | undefined,
): SiteBannerLinkDisplay {
  return linkDisplay === "inline_link" ? "inline_link" : "cta_chevron";
}

export function siteBannerStatus(
  row: {
    isEnabled: boolean;
    startsAt: Date;
    endsAt: Date | null;
  },
  now = new Date(),
): "disabled" | "scheduled" | "live" | "ended" {
  if (!row.isEnabled) return "disabled";
  if (row.startsAt > now) return "scheduled";
  if (row.endsAt && row.endsAt < now) return "ended";
  return "live";
}
