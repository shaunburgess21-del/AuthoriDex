import type { Express } from "express";
import { requireAuth, type AuthRequest } from "../auth-middleware";
import { blockUser, unblockUser } from "../services/user-blocks";
import { dbUserBlockStore, listBlocksForViewer } from "../services/user-blocks-store";

function userIdParam(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function registerUserBlockRoutes(app: Express): void {
  app.get("/api/me/blocks", requireAuth, async (req: AuthRequest, res) => {
    try {
      const blocks = await listBlocksForViewer(req.userId!);
      res.json({ data: { blocks } });
    } catch (error) {
      console.error("[user-blocks] list failed:", error);
      res.status(500).json({ error: "Failed to load blocked users" });
    }
  });

  app.post("/api/users/:userId/block", requireAuth, async (req: AuthRequest, res) => {
    try {
      const blockedId = userIdParam(req.params.userId);
      if (!blockedId) return res.status(400).json({ error: "Invalid user" });

      const result = await blockUser(dbUserBlockStore, req.userId!, blockedId);
      if (!result.ok && result.reason === "self") {
        return res.status(400).json({ error: "You cannot block yourself" });
      }
      if (!result.ok && result.reason === "not_found") {
        return res.status(404).json({ error: "User not found" });
      }
      if (!result.ok) {
        return res.status(400).json({ error: "Failed to block user" });
      }

      res.json({
        data: { blockedUserId: blockedId, alreadyBlocked: result.alreadyBlocked },
      });
    } catch (error) {
      console.error("[user-blocks] block failed:", error);
      res.status(500).json({ error: "Failed to block user" });
    }
  });

  app.delete("/api/users/:userId/block", requireAuth, async (req: AuthRequest, res) => {
    try {
      const blockedId = userIdParam(req.params.userId);
      if (!blockedId) return res.status(400).json({ error: "Invalid user" });

      const result = await unblockUser(dbUserBlockStore, req.userId!, blockedId);
      if (!result.ok && result.reason === "self") {
        return res.status(400).json({ error: "You cannot unblock yourself" });
      }
      if (!result.ok) {
        return res.status(400).json({ error: "Failed to unblock user" });
      }

      res.json({
        data: { blockedUserId: blockedId, unblocked: result.unblocked },
      });
    } catch (error) {
      console.error("[user-blocks] unblock failed:", error);
      res.status(500).json({ error: "Failed to unblock user" });
    }
  });
}
