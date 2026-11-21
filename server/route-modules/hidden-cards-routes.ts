import type { Express } from "express";
import { requireAuth, type AuthRequest } from "../auth-middleware";
import {
  executeHideCard,
  executeListHiddenCards,
  executeUnhideCard,
} from "../services/hidden-cards";
import { createDbHiddenCardStore, resolveHiddenCardSources } from "../services/hidden-cards-db";

/**
 * Personal hide list.
 *   GET    /api/me/hidden-cards  — cards this user hid, skipping ones that are gone
 *   POST   /api/me/hidden-cards  — hide one card (idempotent)
 *   DELETE /api/me/hidden-cards  — unhide one card (idempotent)
 *
 * All three require auth. A missing table returns 503 so a deploy that lands
 * before the migration does not look like a successful hide.
 */
export function registerHiddenCardRoutes(app: Express): void {
  const store = createDbHiddenCardStore();

  app.get("/api/me/hidden-cards", requireAuth, async (req: AuthRequest, res) => {
    const result = await executeListHiddenCards(store, req.userId!, resolveHiddenCardSources);
    res.status(result.status).json(result.body);
  });

  app.post("/api/me/hidden-cards", requireAuth, async (req: AuthRequest, res) => {
    const result = await executeHideCard(store, req.userId!, req.body);
    res.status(result.status).json(result.body);
  });

  app.delete("/api/me/hidden-cards", requireAuth, async (req: AuthRequest, res) => {
    const result = await executeUnhideCard(store, req.userId!, req.body);
    res.status(result.status).json(result.body);
  });
}
