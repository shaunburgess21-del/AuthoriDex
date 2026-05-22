import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { siteAnnouncements, type SiteBannerStyle } from "@shared/schema";

export type PublicSiteBanner = {
  id: string;
  message: string;
  href: string | null;
  style: SiteBannerStyle;
  dismissible: boolean;
};

export async function getActiveSiteBanner(): Promise<PublicSiteBanner | null> {
  const now = new Date();
  const rows = await db
    .select({
      id: siteAnnouncements.id,
      message: siteAnnouncements.message,
      href: siteAnnouncements.href,
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
