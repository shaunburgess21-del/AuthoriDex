import type { Express } from "express";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  emailUnsubscribeState,
  notificationPreferences,
  profiles,
} from "@shared/schema";
import { verifyUnsubscribeToken } from "../emails/unsubscribe";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

/** Small public API surface kept out of the main routes module. */
export function registerPublicRoutes(app: Express): void {
  app.get("/api/config/supabase", (_req, res) => {
    res.json({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
    });
  });

  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // One-click unsubscribe endpoint for marketing/lifecycle email links.
  // Auth/OTP transactional messages remain unaffected.
  app.get("/api/email/unsubscribe", async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      return res.status(400).json({ error: "Missing unsubscribe token" });
    }

    const verified = verifyUnsubscribeToken(token);
    if (!verified.valid) {
      return res.status(400).json({ error: "Invalid or expired unsubscribe token" });
    }

    try {
      const userId = verified.userId;
      const now = new Date();
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const updates = {
        predictionsEmail: false,
        favoritesEmail: false,
        socialEmail: false,
        accountEmail: false,
        systemEmail: false,
        updatedAt: now,
      };

      await db
        .insert(notificationPreferences)
        .values({ userId, ...updates })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: updates,
        });

      await db
        .insert(emailUnsubscribeState)
        .values({
          userId,
          channel: "marketing_lifecycle",
          source: "email_link",
          tokenHash,
          unsubscribedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: emailUnsubscribeState.userId,
          set: {
            channel: "marketing_lifecycle",
            source: "email_link",
            tokenHash,
            unsubscribedAt: now,
            updatedAt: now,
          },
        });

      return res.json({
        ok: true,
        unsubscribed: true,
        scope: "marketing_lifecycle",
      });
    } catch (error: any) {
      console.error("Error processing unsubscribe request:", error?.message);
      return res.status(500).json({ error: "Failed to process unsubscribe request" });
    }
  });

  // Username availability check used by /login/welcome. Public + rate-limited
  // by the global limiter so unauthenticated users can verify before signup
  // completes. Format mirrors PATCH /api/profile/me/username on the server side.
  app.get("/api/profile/username-available", async (req, res) => {
    try {
      const raw = req.query.username;
      const username = typeof raw === "string" ? raw : "";

      if (!USERNAME_PATTERN.test(username)) {
        return res.json({ available: false, reason: "invalid_format" });
      }

      const existing = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.username, username))
        .limit(1);

      if (existing.length > 0) {
        return res.json({ available: false, reason: "taken" });
      }

      res.json({ available: true });
    } catch (error: any) {
      console.error("Error checking username availability:", error?.message);
      res.status(500).json({ error: "Failed to check username availability" });
    }
  });
}
