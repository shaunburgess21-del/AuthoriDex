import type { Express } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { profiles, xpActions } from "@shared/schema";
import { requireAuth, type AuthRequest } from "../auth-middleware";
import { gamificationService } from "../services/gamification";
import {
  STREAK_GRACE_PERIOD_DAYS,
  STREAK_MILESTONES,
  STREAK_MILESTONE_XP,
  streakMilestoneActionKey,
  type StreakMilestone,
} from "@shared/streak-config";

/**
 * Extracted read-only gamification endpoints from the main routes.ts monolith.
 *
 * NOTE: as of the streak overhaul, /api/gamification/stats is now a
 * pure READ endpoint — the daily-login + streak side effects have moved
 * to POST /api/gamification/daily-checkin (defined in this module).
 * That split makes the streak machine deterministic (only one writer)
 * and lets the GET endpoint be safely cached / re-fetched on focus.
 */

/**
 * UTC YYYY-MM-DD for the given date. We standardise on UTC because the
 * `last_login_date` column carries no timezone — every comparison must
 * happen in the same frame the writer used.
 */
function utcDateString(d: Date = new Date()): string {
  return d.toISOString().split("T")[0];
}

/**
 * Returns the YYYY-MM-DD that is `daysAgo` calendar days before
 * `from` in UTC. Pure function so the daily-checkin handler can build
 * "yesterday" / "two days ago" without sprinkling Date math inline.
 */
function utcDateOffset(daysAgo: number, from: Date = new Date()): string {
  const t = new Date(from.getTime() - daysAgo * 86_400_000);
  return utcDateString(t);
}

export function registerGamificationRoutes(app: Express): void {
  // Check a specific capability permission for the authenticated user.
  app.get("/api/gamification/check-permission/:capability", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { capability } = req.params;
      const hasPermission = await gamificationService.checkPermission(req.userId!, capability as any);
      res.json({ capability, hasPermission });
    } catch (error: any) {
      console.error("Error checking permission:", error?.message);
      res.status(500).json({ error: "Failed to check permission" });
    }
  });

  // Recent XP ledger entries for the current user.
  app.get("/api/gamification/xp-history", requireAuth, async (req: AuthRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const history = await gamificationService.getXpHistory(req.userId!, limit);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching XP history:", error?.message);
      res.status(500).json({ error: "Failed to fetch XP history" });
    }
  });

  // Recent credit ledger entries for the current user.
  app.get("/api/gamification/credit-history", requireAuth, async (req: AuthRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const history = await gamificationService.getCreditHistory(req.userId!, limit);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching credit history:", error?.message);
      res.status(500).json({ error: "Failed to fetch credit history" });
    }
  });

  // Today's XP summary — used by UI to show remaining daily caps.
  app.get("/api/gamification/daily-summary", requireAuth, async (req: AuthRequest, res) => {
    try {
      const summary = await gamificationService.getDailyXpSummary(req.userId!);
      res.json(summary);
    } catch (error: any) {
      console.error("Error fetching daily summary:", error?.message);
      res.status(500).json({ error: "Failed to fetch daily summary" });
    }
  });

  // Public list of active XP actions (for displaying "how to earn XP" UI).
  app.get("/api/gamification/xp-actions", async (_req, res) => {
    try {
      const actions = await db.select().from(xpActions).where(eq(xpActions.isActive, true));
      res.json(actions);
    } catch (error: any) {
      console.error("Error fetching XP actions:", error?.message);
      res.status(500).json({ error: "Failed to fetch XP actions" });
    }
  });

  // Daily check-in — the single mutation point for the streak state
  // machine. Idempotent within a UTC day: a second call from the same
  // user on the same day no-ops (returns the current state with
  // xpAwarded=0). Drives:
  //
  //   * profiles.current_streak  — the headline counter
  //   * profiles.longest_streak  — peak ever reached (lazily promoted)
  //   * profiles.last_login_date — authoritative gate for the next
  //                                consecutive-day / grace / reset
  //                                decision
  //   * xp_ledger entries for daily_login (always), streak_bonus
  //     (consecutive day, non-milestone), and streak_milestone_<n>
  //     (lifetime once-per-milestone)
  //
  // Returns the new state plus a payload the client can hand to the
  // streak toast. Errors here are non-fatal for the rest of the auth
  // flow — the client should tolerate a 500 silently.
  app.post("/api/gamification/daily-checkin", requireAuth, async (req: AuthRequest, res) => {
    const userId = req.userId!;
    try {
      const today = utcDateString();
      const yesterday = utcDateOffset(1);
      const dayBeforeYesterday = utcDateOffset(1 + STREAK_GRACE_PERIOD_DAYS);

      const [profile] = await db
        .select({
          id: profiles.id,
          currentStreak: profiles.currentStreak,
          longestStreak: profiles.longestStreak,
          lastLoginDate: profiles.lastLoginDate,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      // Already checked in today — return current state, no writes.
      // We deliberately don't recompute streaks or re-award XP on
      // repeat calls; the state is whatever the first call of the day
      // produced.
      if (profile.lastLoginDate === today) {
        return res.json({
          streak: profile.currentStreak,
          longestStreak: profile.longestStreak,
          xpAwarded: 0,
          isMilestone: false,
          alreadyCheckedIn: true,
        });
      }

      // Decide the next streak value from the calendar gap. Only three
      // outcomes:
      //   - yesterday          → +1 (normal consecutive)
      //   - within grace window → +1 (the user "saved" their streak)
      //   - anything else (older, or null) → reset to 1
      let nextStreak: number;
      let graceUsed = false;
      if (profile.lastLoginDate === yesterday) {
        nextStreak = profile.currentStreak + 1;
      } else if (
        profile.lastLoginDate &&
        profile.lastLoginDate >= dayBeforeYesterday &&
        profile.lastLoginDate < yesterday
      ) {
        nextStreak = profile.currentStreak + 1;
        graceUsed = true;
      } else {
        nextStreak = 1;
      }

      const nextLongest = Math.max(profile.longestStreak, nextStreak);

      // 1) Daily login XP (always fires on a fresh day).
      const loginXp = await gamificationService.awardXp(
        userId,
        "daily_login",
        `daily_login_${today}_${userId}`,
        { date: today },
      );

      // 2) Persist the new streak state BEFORE the bonus award so the
      // ledger row metadata reflects the streak it earned.
      await db
        .update(profiles)
        .set({
          currentStreak: nextStreak,
          longestStreak: nextLongest,
          lastLoginDate: today,
        })
        .where(eq(profiles.id, userId));

      // 3) Bonus XP — milestone OR standard streak_bonus, never both.
      // Milestone keys are not date-scoped (lifetime-once per
      // milestone-level per user). The standard streak_bonus is the
      // per-day +25 the user already had pre-overhaul.
      const milestoneHit = (STREAK_MILESTONES as readonly number[]).includes(
        nextStreak,
      )
        ? (nextStreak as StreakMilestone)
        : null;

      let bonusXpAwarded = 0;
      let bonusActionKey: string | null = null;
      if (milestoneHit) {
        const actionKey = streakMilestoneActionKey(milestoneHit);
        const result = await gamificationService.awardXp(
          userId,
          actionKey,
          `streak_milestone_${milestoneHit}_${userId}`,
          { milestone: milestoneHit, date: today, streak: nextStreak },
        );
        if (result.success) {
          bonusXpAwarded = result.xpAwarded;
          bonusActionKey = actionKey;
        }
      } else if (nextStreak > 1) {
        const result = await gamificationService.awardXp(
          userId,
          "streak_bonus",
          `streak_bonus_${today}_${userId}`,
          { date: today, streak: nextStreak, graceUsed },
        );
        if (result.success) {
          bonusXpAwarded = result.xpAwarded;
          bonusActionKey = "streak_bonus";
        }
      }

      const loginAwarded = loginXp.success ? loginXp.xpAwarded : 0;
      const xpAwarded = loginAwarded + bonusXpAwarded;

      return res.json({
        streak: nextStreak,
        longestStreak: nextLongest,
        xpAwarded,
        isMilestone: milestoneHit !== null,
        milestoneDay: milestoneHit ?? undefined,
        graceUsed,
        bonusActionKey,
        alreadyCheckedIn: false,
      });
    } catch (error: any) {
      console.error("[daily-checkin] error:", error?.message);
      return res.status(500).json({ error: "Failed to run daily check-in" });
    }
  });

  // Public rank ladder — single source of truth for client rank UI.
  // Served from the in-memory ranks cache on GamificationService (5-min TTL).
  app.get("/api/gamification/ranks", async (_req, res) => {
    try {
      const ranksList = await gamificationService.getRanks();
      res.json(ranksList);
    } catch (error: any) {
      console.error("Error fetching ranks:", error?.message);
      res.status(500).json({ error: "Failed to fetch ranks" });
    }
  });
}
