import type { Express, Request, Response } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { siteAnnouncements } from "@shared/schema";
import { requireAuth, requireAdmin, type AuthRequest } from "../auth-middleware";
import { getActiveSiteBanner, siteBannerStatus } from "../services/site-banner";
import {
  renderNewMarketSocialPng,
  renderTopPredictorsWeekSocialPng,
  socialTemplateFilename,
  type SocialTemplateAspect,
} from "../services/social-template-image";
import {
  resolveOgPagePayload,
  resolveCommunityMarketOg,
  resolveNativePredictOg,
  resolveSentimentPollOg,
  resolveOpinionPollOg,
  resolveMatchupOg,
  resolvePersonOg,
  resolveBetShareOg,
  resolveSiteOg,
} from "../services/og-page-payload";

const previewQuerySchema = z.object({
  url: z.string().optional(),
  pathname: z.string().optional(),
  entityType: z
    .enum([
      "site",
      "community_market",
      "native_predict",
      "sentiment_poll",
      "opinion_poll",
      "matchup",
      "person",
      "bet_share",
    ])
    .optional(),
  slug: z.string().optional(),
  marketId: z.string().optional(),
  predictType: z.enum(["updown", "h2h", "race", "jackpot"]).optional(),
  personId: z.string().optional(),
  betId: z.string().optional(),
});

const siteBannerStyleSchema = z.enum(["info", "promo", "warning"]);

const siteBannerBodySchema = z.object({
  message: z.string().min(1).max(200),
  href: z.string().max(500).optional().nullable(),
  style: siteBannerStyleSchema.default("promo"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().nullable(),
  isEnabled: z.boolean().default(true),
  dismissible: z.boolean().default(true),
});

function validateBannerSchedule(
  startsAt: string | undefined,
  endsAt: string | null | undefined,
): boolean {
  if (!endsAt || !startsAt) return true;
  return new Date(endsAt) > new Date(startsAt);
}

const createSiteBannerSchema = siteBannerBodySchema.refine(
  (d) => validateBannerSchedule(d.startsAt, d.endsAt),
  { message: "endsAt must be after startsAt" },
);

const patchSiteBannerSchema = siteBannerBodySchema.partial();

const socialTemplateQuerySchema = z.object({
  template: z.enum(["new_market", "top_predictors_week"]),
  aspect: z.enum(["square", "landscape"]).default("square"),
  entityType: z.enum(["community_market", "native_predict"]).optional(),
  slug: z.string().optional(),
  marketId: z.string().optional(),
  predictType: z.enum(["updown", "h2h", "race", "jackpot"]).optional(),
});

export function registerAdminBrandingRoutes(app: Express): void {
  app.get("/api/site-banner", async (_req: Request, res: Response) => {
    try {
      const banner = await getActiveSiteBanner();
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ banner });
    } catch (err: unknown) {
      console.error("[site-banner]", err);
      res.status(500).json({ banner: null });
    }
  });

  app.get(
    "/api/admin/site-banner",
    requireAuth,
    requireAdmin,
    async (_req: AuthRequest, res: Response) => {
      try {
        const rows = await db
          .select()
          .from(siteAnnouncements)
          .orderBy(desc(siteAnnouncements.startsAt))
          .limit(20);
        const now = new Date();
        res.json(
          rows.map((row) => ({
            ...row,
            status: siteBannerStatus(row, now),
          })),
        );
      } catch (err: unknown) {
        console.error("[admin/site-banner list]", err);
        res.status(500).json({ error: "Failed to list site banners" });
      }
    },
  );

  app.post(
    "/api/admin/site-banner",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = createSiteBannerSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        const d = parsed.data;
        const href =
          typeof d.href === "string" && d.href.trim().length > 0 ? d.href.trim() : null;
        const [row] = await db
          .insert(siteAnnouncements)
          .values({
            message: d.message.trim(),
            href,
            style: d.style,
            startsAt: new Date(d.startsAt),
            endsAt: d.endsAt ? new Date(d.endsAt) : null,
            isEnabled: d.isEnabled,
            dismissible: d.dismissible,
            createdBy: req.userId ?? null,
            updatedAt: new Date(),
          })
          .returning();
        res.status(201).json({
          ...row,
          status: siteBannerStatus(row),
        });
      } catch (err: unknown) {
        console.error("[admin/site-banner create]", err);
        res.status(500).json({ error: "Failed to create site banner" });
      }
    },
  );

  app.patch(
    "/api/admin/site-banner/:id",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = patchSiteBannerSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        const d = parsed.data;
        const [existing] = await db
          .select({
            startsAt: siteAnnouncements.startsAt,
            endsAt: siteAnnouncements.endsAt,
          })
          .from(siteAnnouncements)
          .where(eq(siteAnnouncements.id, req.params.id))
          .limit(1);
        if (!existing) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        const effectiveStarts = d.startsAt ?? existing.startsAt.toISOString();
        const effectiveEnds =
          d.endsAt !== undefined
            ? d.endsAt
            : existing.endsAt
              ? existing.endsAt.toISOString()
              : null;
        if (
          effectiveEnds &&
          !validateBannerSchedule(effectiveStarts, effectiveEnds)
        ) {
          res.status(400).json({ error: "endsAt must be after startsAt" });
          return;
        }
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (d.message !== undefined) patch.message = d.message.trim();
        if (d.href !== undefined) {
          patch.href =
            typeof d.href === "string" && d.href.trim().length > 0 ? d.href.trim() : null;
        }
        if (d.style !== undefined) patch.style = d.style;
        if (d.startsAt !== undefined) patch.startsAt = new Date(d.startsAt);
        if (d.endsAt !== undefined) patch.endsAt = d.endsAt ? new Date(d.endsAt) : null;
        if (d.isEnabled !== undefined) patch.isEnabled = d.isEnabled;
        if (d.dismissible !== undefined) patch.dismissible = d.dismissible;

        const [row] = await db
          .update(siteAnnouncements)
          .set(patch)
          .where(eq(siteAnnouncements.id, req.params.id))
          .returning();
        res.json({ ...row, status: siteBannerStatus(row) });
      } catch (err: unknown) {
        console.error("[admin/site-banner patch]", err);
        res.status(500).json({ error: "Failed to update site banner" });
      }
    },
  );

  app.delete(
    "/api/admin/site-banner/:id",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res: Response) => {
      try {
        const [row] = await db
          .delete(siteAnnouncements)
          .where(eq(siteAnnouncements.id, req.params.id))
          .returning({ id: siteAnnouncements.id });
        if (!row) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.json({ success: true });
      } catch (err: unknown) {
        console.error("[admin/site-banner delete]", err);
        res.status(500).json({ error: "Failed to delete site banner" });
      }
    },
  );

  app.get(
    "/api/admin/social-template.png",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = socialTemplateQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid query parameters" });
          return;
        }
        const q = parsed.data;
        const aspect = q.aspect as SocialTemplateAspect;
        let png: Buffer;

        if (q.template === "top_predictors_week") {
          png = await renderTopPredictorsWeekSocialPng({ aspect });
        } else {
          if (q.entityType === "community_market" && q.slug) {
            png = await renderNewMarketSocialPng({
              entityType: "community_market",
              slug: q.slug,
              aspect,
            });
          } else if (
            q.entityType === "native_predict" &&
            q.marketId &&
            q.predictType
          ) {
            png = await renderNewMarketSocialPng({
              entityType: "native_predict",
              marketId: q.marketId,
              predictType: q.predictType,
              aspect,
            });
          } else {
            res.status(400).json({
              error: "new_market requires entityType + slug or marketId + predictType",
            });
            return;
          }
        }

        const filename = socialTemplateFilename(q.template, aspect);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Cache-Control", "private, no-cache");
        res.send(png);
      } catch (err: unknown) {
        console.error("[admin/social-template]", err);
        res.status(500).json({
          error: err instanceof Error ? err.message : "Social template render failed",
        });
      }
    },
  );

  app.get(
    "/api/admin/og-preview",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = previewQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid query parameters" });
          return;
        }

        const q = parsed.data;
        let result;

        if (q.entityType === "site") {
          result = await resolveSiteOg();
        } else if (q.entityType === "community_market" && q.slug) {
          result = await resolveCommunityMarketOg(q.slug);
        } else if (q.entityType === "native_predict" && q.marketId && q.predictType) {
          result = await resolveNativePredictOg(q.predictType, q.marketId);
        } else if (q.entityType === "sentiment_poll" && q.slug) {
          result = await resolveSentimentPollOg(q.slug);
        } else if (q.entityType === "opinion_poll" && q.slug) {
          result = await resolveOpinionPollOg(q.slug);
        } else if (q.entityType === "matchup" && q.slug) {
          result = await resolveMatchupOg(q.slug);
        } else if (q.entityType === "person" && (q.personId || q.slug)) {
          result = await resolvePersonOg(q.personId ?? q.slug!);
        } else if (q.entityType === "bet_share" && q.betId) {
          result = await resolveBetShareOg(q.betId);
        } else if (q.url || q.pathname) {
          result = await resolveOgPagePayload({
            url: q.url,
            pathname: q.pathname,
          });
        } else {
          res.status(400).json({
            error: "Provide url, pathname, or entityType with required identifiers",
          });
          return;
        }

        res.json(result);
      } catch (err: unknown) {
        console.error("[admin/og-preview]", err);
        res.status(500).json({
          error: err instanceof Error ? err.message : "OG preview failed",
        });
      }
    },
  );
}
