import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";

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
