import type { Express } from "express";

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
}
