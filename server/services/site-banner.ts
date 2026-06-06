import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../db";
import {
  siteAnnouncements,
  type SiteBannerStyle,
  type SiteBannerLinkDisplay,
} from "@shared/schema";

export type PublicSiteBanner = {
  id: string;
  message: string;
  href: string | null;
  linkLabel: string | null;
  linkDisplay: SiteBannerLinkDisplay;
  style: SiteBannerStyle;
  dismissible: boolean;
};

export function resolveSiteBannerLinkLabel(linkLabel: string | null | undefined): string {
  const trimmed = linkLabel?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Learn more";
}

export function normalizeSiteBannerLinkDisplay(
  linkDisplay: string | null | undefined,
): SiteBannerLinkDisplay {
  return linkDisplay === "inline_link" ? "inline_link" : "cta_chevron";
}

export async function getActiveSiteBanner(): Promise<PublicSiteBanner | null> {
  const now = new Date();
  const rows = await db
    .select({
      id: siteAnnouncements.id,
      message: siteAnnouncements.message,
      href: siteAnnouncements.href,
      linkLabel: siteAnnouncements.linkLabel,
      linkDisplay: siteAnnouncements.linkDisplay,
      style: siteAnnouncements.style,
      dismissible: siteAnnouncements.dismissible,
    })
    .from(siteAnnouncements)
    .where(
      and(
        eq(siteAnnouncements.isEnabled, true),
        lte(siteAnnouncements.startsAt, now),
        or(isNull(siteAnnouncements.endsAt), gte(siteAnnouncements.endsAt, now)),
      ),
    )
    .orderBy(desc(siteAnnouncements.startsAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const style = row.style as SiteBannerStyle;
  const validStyles: SiteBannerStyle[] = ["info", "promo", "warning"];
  return {
    id: row.id,
    message: row.message,
    href: row.href,
    linkLabel: row.linkLabel,
    linkDisplay: normalizeSiteBannerLinkDisplay(row.linkDisplay),
    style: validStyles.includes(style) ? style : "promo",
    dismissible: row.dismissible,
  };
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
