import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import type { BadgeCardData } from "@/components/BadgeCard";
import { CREDIT_ACTIONS } from "@shared/credit-config";

// XP values mirror server/scripts/seed-gamification.ts. Kept inline
// (rather than imported from gamification-content.ts) to avoid a
// circular import at module load. If those values change in the seed,
// update both this list and the seed in lockstep — the unit-test
// harness in tests/profile-rewards.test.ts (TODO) will eventually
// pin them together.
const PROFILE_XP_KEYS: ReadonlyArray<{ key: string; xp: number }> = [
  { key: "profile_avatar", xp: 25 },
  { key: "profile_bio", xp: 25 },
  { key: "profile_demographics", xp: 100 },
];
const PROFILE_CREDIT_KEYS: ReadonlyArray<string> = [
  "profile_avatar",
  "profile_bio",
  "profile_demographics",
];

const TOTAL_PROFILE_XP = PROFILE_XP_KEYS.reduce((sum, a) => sum + a.xp, 0);
const TOTAL_PROFILE_CREDITS = PROFILE_CREDIT_KEYS.reduce((sum, key) => {
  const action = CREDIT_ACTIONS.find((a) => a.key === key);
  return sum + (action?.proposedCredits ?? 0);
}, 0);

/**
 * Compact "Complete your profile" prompt rendered on /me. Hidden once
 * the user holds the `full_voxmaxer` badge — the same key the
 * checkAndAwardProfileBadges helper awards when every tracked field
 * is filled. Reads earned state from /api/me/badges so the surface
 * stays consistent with the trophy cabinet and the badge toasts
 * (one source of truth, no drift).
 *
 * Progress count tracks the same fields the backend uses to decide
 * the full_voxmaxer threshold (avatar, bio, dateOfBirth, gender,
 * countryOfResidence, at least one social handle, occupation).
 * Total = 7. Hide rather than render at 100% even if the badge
 * hasn't been awarded yet — the next save round-trip will catch up.
 */
export function ProfileCompletionCard() {
  const { profile, isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();

  const { data: badges } = useQuery<BadgeCardData[]>({
    queryKey: ["/api/me/badges"],
    enabled: isLoggedIn,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/badges");
      return res.json();
    },
  });

  if (!profile) return null;

  const fullVoxmaxer = badges?.find((b) => b.key === "full_voxmaxer");
  if (fullVoxmaxer?.earned) return null;

  const checks = [
    Boolean(profile.avatarUrl),
    Boolean(profile.bio?.trim()),
    Boolean(profile.dateOfBirth),
    Boolean(profile.gender),
    Boolean(profile.countryOfResidence?.trim()),
    Boolean(
      profile.socialXHandle?.trim() || profile.socialInstagramHandle?.trim(),
    ),
    Boolean(profile.occupationIndustry),
  ];
  const completed = checks.filter(Boolean).length;
  const total = checks.length;
  const pct = Math.round((completed / total) * 100);

  return (
    <Card className="p-4 my-4 border-violet-500/30 bg-gradient-to-br from-violet-500/8 to-fuchsia-500/8">
      <div className="flex items-start gap-3">
        <div className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm">Complete your profile</p>
          <p className="text-xs text-muted-foreground">
            Earn up to {TOTAL_PROFILE_XP} XP + {TOTAL_PROFILE_CREDITS} Credits
            as you fill in your profile.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {completed} / {total}
            </span>
          </div>
          <Button
            size="sm"
            className="mt-3 w-full sm:w-auto bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
            onClick={() => setLocation("/me/settings#about")}
            data-testid="button-complete-profile"
          >
            Complete profile <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
