/**
 * Badge system — single source of truth.
 *
 * Mirrors `shared/credit-config.ts` and `shared/rank-config.ts`:
 * the canonical list of badge definitions lives here in code, and
 * `seedBadges()` in `server/scripts/seed-gamification.ts` upserts it
 * into the `badges` table on every seed run. Admin tooling reads
 * the DB row (so isActive/visibleOnFrontend toggles take effect
 * without a redeploy) but the config file is the source of every
 * fresh seed.
 *
 * Rules of engagement when adding/editing badges:
 *  - `key` is forever. Renaming breaks every `user_badges` row.
 *  - `criteriaJson` is descriptive, not executable. The actual
 *    award logic lives in hand-written helpers in
 *    `server/services/badges.ts` so we can afford bespoke per-
 *    badge criteria without an interpreter.
 *  - Bumping a `rarity` is fine. Changing thresholds requires a
 *    follow-up backfill if the old population should be re-checked.
 */

export const BADGE_CATEGORIES = {
  VOTING: "VOTING",
  PREDICTION: "PREDICTION",
  CONTENT: "CONTENT",
  STREAK: "STREAK",
  SOCIAL: "SOCIAL",
  PROFILE: "PROFILE",
  SPECIAL: "SPECIAL",
} as const;
export type BadgeCategory =
  (typeof BADGE_CATEGORIES)[keyof typeof BADGE_CATEGORIES];

export const BADGE_RARITIES = {
  COMMON: "COMMON",
  RARE: "RARE",
  EPIC: "EPIC",
  LEGENDARY: "LEGENDARY",
} as const;
export type BadgeRarity =
  (typeof BADGE_RARITIES)[keyof typeof BADGE_RARITIES];

export interface BadgeConfig {
  key: string;
  name: string;
  description: string;
  category: BadgeCategory;
  rarity: BadgeRarity;
  // Lucide icon name in kebab-case. Resolved client-side via the
  // shared icon map. Keep these in sync with imports in
  // client/src/lib/badge-icons.ts.
  icon: string;
  // Descriptive criteria — drives the admin UI and How It Works
  // page only. Runtime award logic lives in the per-badge check
  // helpers in server/services/badges.ts.
  criteriaJson: Record<string, unknown>;
  isActive: boolean;
  visibleOnFrontend: boolean;
  sortOrder: number;
}

export const BADGES: BadgeConfig[] = [
  // ---- VOTING (10) ----
  {
    key: "first_vote",
    name: "First Vote",
    description: "Cast your first vote on VoxDex",
    category: BADGE_CATEGORIES.VOTING,
    rarity: BADGE_RARITIES.COMMON,
    icon: "check-square",
    criteriaJson: { type: "vote_count", threshold: 1, authenticated_only: true },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 100,
  },
  {
    key: "quarter_century",
    name: "Quarter Century",
    description: "Cast 25 votes",
    category: BADGE_CATEGORIES.VOTING,
    rarity: BADGE_RARITIES.COMMON,
    icon: "target",
    criteriaJson: { type: "vote_count", threshold: 25 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 110,
  },
  {
    key: "century_citizen",
    name: "Century Citizen",
    description: "Cast 100 votes",
    category: BADGE_CATEGORIES.VOTING,
    rarity: BADGE_RARITIES.COMMON,
    icon: "trophy",
    criteriaJson: { type: "vote_count", threshold: 100 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 120,
  },
  {
    key: "dedicated_voter",
    name: "Dedicated Voter",
    description: "Cast 500 votes",
    category: BADGE_CATEGORIES.VOTING,
    rarity: BADGE_RARITIES.RARE,
    icon: "vote",
    criteriaJson: { type: "vote_count", threshold: 500 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 130,
  },
  {
    key: "voxmax_voter",
    name: "VoxMax Voter",
    description: "Cast 1,000 votes",
    category: BADGE_CATEGORIES.VOTING,
    rarity: BADGE_RARITIES.EPIC,
    icon: "medal",
    criteriaJson: { type: "vote_count", threshold: 1000 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 140,
  },
  {
    key: "legend_of_ballot",
    name: "Legend of the Ballot",
    description: "Cast 10,000 votes",
    category: BADGE_CATEGORIES.VOTING,
    rarity: BADGE_RARITIES.LEGENDARY,
    icon: "crown",
    criteriaJson: { type: "vote_count", threshold: 10000 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 150,
  },
  {
    key: "well_rounded",
    name: "Well-Rounded",
    description: "Vote in 4 or more different vote sections",
    category: BADGE_CATEGORIES.VOTING,
    rarity: BADGE_RARITIES.RARE,
    icon: "sparkles",
    criteriaJson: { type: "vote_sections", threshold: 4 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 160,
  },
  {
    key: "subject_shaper",
    name: "Subject Shaper",
    description: "Cast 5 or more votes on the same person",
    category: BADGE_CATEGORIES.VOTING,
    rarity: BADGE_RARITIES.RARE,
    icon: "flame",
    criteriaJson: { type: "votes_per_person", threshold: 5 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 170,
  },
  {
    key: "induction_champion",
    name: "Induction Champion",
    description: "Vote on 50 induction candidates",
    category: BADGE_CATEGORIES.VOTING,
    rarity: BADGE_RARITIES.RARE,
    icon: "award",
    criteriaJson: { type: "induction_vote_count", threshold: 50 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 180,
  },
  {
    key: "image_curator",
    name: "Image Curator",
    description: "Cast 100 image curation votes",
    category: BADGE_CATEGORIES.VOTING,
    rarity: BADGE_RARITIES.COMMON,
    icon: "image",
    criteriaJson: { type: "curation_vote_count", threshold: 100 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 190,
  },

  // ---- PREDICTION (7) ----
  {
    key: "first_win",
    name: "First Win",
    description: "Win your first prediction",
    category: BADGE_CATEGORIES.PREDICTION,
    rarity: BADGE_RARITIES.COMMON,
    icon: "trending-up",
    criteriaJson: { type: "prediction_wins", threshold: 1 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 200,
  },
  {
    key: "forecaster_1",
    name: "Forecaster I",
    description: "Place 50 predictions",
    category: BADGE_CATEGORIES.PREDICTION,
    rarity: BADGE_RARITIES.COMMON,
    icon: "line-chart",
    criteriaJson: { type: "prediction_count", threshold: 50 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 210,
  },
  {
    key: "forecaster_2",
    name: "Forecaster II",
    description: "Place 500 predictions",
    category: BADGE_CATEGORIES.PREDICTION,
    rarity: BADGE_RARITIES.RARE,
    icon: "line-chart",
    criteriaJson: { type: "prediction_count", threshold: 500 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 220,
  },
  {
    key: "forecaster_3",
    name: "Forecaster III",
    description: "Place 5,000 predictions",
    category: BADGE_CATEGORIES.PREDICTION,
    rarity: BADGE_RARITIES.EPIC,
    icon: "line-chart",
    criteriaJson: { type: "prediction_count", threshold: 5000 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 230,
  },
  {
    key: "sharp_mind",
    name: "Sharp Mind",
    description: "Achieve 60% or higher win rate across 20+ predictions",
    category: BADGE_CATEGORIES.PREDICTION,
    rarity: BADGE_RARITIES.RARE,
    icon: "brain",
    criteriaJson: { type: "win_rate", threshold: 0.6, min_predictions: 20 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 240,
  },
  {
    key: "oracle",
    name: "Oracle",
    description: "Achieve 70% or higher win rate across 50+ predictions",
    category: BADGE_CATEGORIES.PREDICTION,
    rarity: BADGE_RARITIES.EPIC,
    icon: "eye",
    criteriaJson: { type: "win_rate", threshold: 0.7, min_predictions: 50 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 250,
  },
  {
    key: "jackpot_hunter",
    name: "Jackpot Hunter",
    description: "Win a jackpot prediction",
    category: BADGE_CATEGORIES.PREDICTION,
    rarity: BADGE_RARITIES.RARE,
    icon: "gem",
    criteriaJson: { type: "jackpot_win", threshold: 1 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 260,
  },

  // ---- CONTENT (8) ----
  {
    key: "first_insight",
    name: "First Insight",
    description: "Post your first community insight",
    category: BADGE_CATEGORIES.CONTENT,
    rarity: BADGE_RARITIES.COMMON,
    icon: "lightbulb",
    criteriaJson: { type: "insight_count", threshold: 1 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 300,
  },
  {
    key: "thought_leader",
    name: "Thought Leader",
    description: "Post 50 community insights",
    category: BADGE_CATEGORIES.CONTENT,
    rarity: BADGE_RARITIES.RARE,
    icon: "graduation-cap",
    criteriaJson: { type: "insight_count", threshold: 50 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 310,
  },
  {
    key: "rising_voice",
    name: "Rising Voice",
    description: "Receive 10 upvotes on your insights and comments",
    category: BADGE_CATEGORIES.CONTENT,
    rarity: BADGE_RARITIES.COMMON,
    icon: "thumbs-up",
    criteriaJson: { type: "upvotes_received", threshold: 10 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 320,
  },
  {
    key: "community_favourite",
    name: "Community Favourite",
    description: "Receive 100 upvotes",
    category: BADGE_CATEGORIES.CONTENT,
    rarity: BADGE_RARITIES.RARE,
    icon: "heart",
    criteriaJson: { type: "upvotes_received", threshold: 100 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 330,
  },
  {
    key: "viral_voice",
    name: "Viral Voice",
    description: "Receive 500 upvotes",
    category: BADGE_CATEGORIES.CONTENT,
    rarity: BADGE_RARITIES.EPIC,
    icon: "megaphone",
    criteriaJson: { type: "upvotes_received", threshold: 500 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 340,
  },
  {
    key: "legends_echo",
    name: "Legend's Echo",
    description: "Receive 1,000 upvotes on your insights and comments",
    category: BADGE_CATEGORIES.CONTENT,
    rarity: BADGE_RARITIES.LEGENDARY,
    icon: "radio",
    criteriaJson: { type: "upvotes_received", threshold: 1000 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 350,
  },
  {
    key: "first_approved_suggestion",
    name: "First Approved Suggestion",
    description: "Have your first content suggestion approved by the team",
    category: BADGE_CATEGORIES.CONTENT,
    rarity: BADGE_RARITIES.RARE,
    icon: "badge-check",
    criteriaJson: { type: "suggestions_approved", threshold: 1 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 360,
  },
  {
    key: "content_creator",
    name: "Content Creator",
    description: "Have 10 suggestions approved",
    category: BADGE_CATEGORIES.CONTENT,
    rarity: BADGE_RARITIES.EPIC,
    icon: "pen-tool",
    criteriaJson: { type: "suggestions_approved", threshold: 10 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 370,
  },

  // ---- STREAK (4) ----
  {
    key: "streak_keeper",
    name: "Streak Keeper",
    description: "Maintain a 7-day login streak",
    category: BADGE_CATEGORIES.STREAK,
    rarity: BADGE_RARITIES.RARE,
    icon: "flame",
    criteriaJson: { type: "login_streak", threshold: 7 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 400,
  },
  {
    key: "fortnight",
    name: "Fortnight",
    description: "Maintain a 14-day login streak",
    category: BADGE_CATEGORIES.STREAK,
    rarity: BADGE_RARITIES.RARE,
    icon: "calendar-days",
    criteriaJson: { type: "login_streak", threshold: 14 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 410,
  },
  {
    key: "monthly_regular",
    name: "Monthly Regular",
    description: "Maintain a 30-day login streak",
    category: BADGE_CATEGORIES.STREAK,
    rarity: BADGE_RARITIES.EPIC,
    icon: "calendar-check",
    criteriaJson: { type: "login_streak", threshold: 30 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 420,
  },
  {
    key: "century_streak",
    name: "Century Streak",
    description: "Maintain a 100-day login streak",
    category: BADGE_CATEGORIES.STREAK,
    rarity: BADGE_RARITIES.LEGENDARY,
    icon: "calendar-heart",
    criteriaJson: { type: "login_streak", threshold: 100 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 430,
  },

  // ---- SOCIAL (4) ----
  {
    key: "pioneer",
    name: "Pioneer",
    description: "Successfully refer your first friend to VoxDex",
    category: BADGE_CATEGORIES.SOCIAL,
    rarity: BADGE_RARITIES.COMMON,
    icon: "user-plus",
    criteriaJson: { type: "referral_count", threshold: 1 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 500,
  },
  {
    key: "connector",
    name: "Connector",
    description: "Successfully refer 5 friends",
    category: BADGE_CATEGORIES.SOCIAL,
    rarity: BADGE_RARITIES.RARE,
    icon: "users",
    criteriaJson: { type: "referral_count", threshold: 5 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 510,
  },
  {
    key: "community_builder",
    name: "Community Builder",
    description: "Successfully refer 10 friends",
    category: BADGE_CATEGORIES.SOCIAL,
    rarity: BADGE_RARITIES.EPIC,
    icon: "network",
    criteriaJson: { type: "referral_count", threshold: 10 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 520,
  },
  {
    key: "share_master",
    name: "Share Master",
    description: "Share a VoxDex link that gets followed by someone new",
    category: BADGE_CATEGORIES.SOCIAL,
    rarity: BADGE_RARITIES.COMMON,
    icon: "share-2",
    criteriaJson: { type: "share_clicks", threshold: 1 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 530,
  },

  // ---- PROFILE (4) ----
  {
    key: "avatar_uploaded",
    name: "Fresh Look",
    description: "Change your avatar after signing up",
    category: BADGE_CATEGORIES.PROFILE,
    rarity: BADGE_RARITIES.COMMON,
    icon: "camera",
    criteriaJson: { type: "profile_field", field: "avatar_url" },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 600,
  },
  {
    key: "getting_personal",
    name: "Getting Personal",
    description: "Complete your name and bio",
    category: BADGE_CATEGORIES.PROFILE,
    rarity: BADGE_RARITIES.COMMON,
    icon: "user",
    criteriaJson: { type: "profile_fields", fields: ["full_name", "bio"] },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 610,
  },
  {
    key: "community_member",
    name: "Community Member",
    description: "Add your age, gender, and country of residence",
    category: BADGE_CATEGORIES.PROFILE,
    rarity: BADGE_RARITIES.RARE,
    icon: "globe-2",
    criteriaJson: {
      type: "profile_fields",
      fields: ["date_of_birth", "gender", "country_of_residence"],
    },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 620,
  },
  {
    key: "full_voxmaxer",
    name: "Full VoxMaxxer",
    description: "Complete all profile demographic fields",
    category: BADGE_CATEGORIES.PROFILE,
    rarity: BADGE_RARITIES.EPIC,
    icon: "id-card",
    criteriaJson: {
      type: "profile_fields",
      fields: [
        "date_of_birth",
        "gender",
        "country_of_origin",
        "country_of_residence",
        "ethnicity",
      ],
    },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 630,
  },

  // ---- SPECIAL (5) ----
  {
    key: "founder",
    name: "Founder",
    description: "Joined VoxDex during the launch era",
    category: BADGE_CATEGORIES.SPECIAL,
    rarity: BADGE_RARITIES.LEGENDARY,
    icon: "star",
    criteriaJson: { type: "manual" },
    isActive: true,
    visibleOnFrontend: false,
    sortOrder: 700,
  },
  {
    key: "hall_inductee",
    name: "Hall Inductee",
    description: "Reach Hall of Famer rank",
    category: BADGE_CATEGORIES.SPECIAL,
    rarity: BADGE_RARITIES.EPIC,
    icon: "landmark",
    criteriaJson: { type: "rank_tier", threshold: 7 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 710,
  },
  {
    key: "voxmax_legend_badge",
    name: "VoxMax Legend",
    description: "Reach VoxMax Legend rank — the rarest status on VoxDex",
    category: BADGE_CATEGORIES.SPECIAL,
    rarity: BADGE_RARITIES.LEGENDARY,
    icon: "crown",
    criteriaJson: { type: "rank_tier", threshold: 8 },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 720,
  },
  {
    key: "seasonal_event",
    name: "Seasonal Event",
    description: "Participate in a featured seasonal event",
    category: BADGE_CATEGORIES.SPECIAL,
    rarity: BADGE_RARITIES.RARE,
    icon: "party-popper",
    criteriaJson: { type: "manual" },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 730,
  },
  {
    key: "admin_awarded",
    name: "Admin Awarded",
    description: "Recognised by the VoxDex team for outstanding contribution",
    category: BADGE_CATEGORIES.SPECIAL,
    rarity: BADGE_RARITIES.EPIC,
    icon: "shield-check",
    criteriaJson: { type: "manual" },
    isActive: true,
    visibleOnFrontend: true,
    sortOrder: 740,
  },
];

const BADGE_BY_KEY = new Map(BADGES.map((b) => [b.key, b]));

export function getBadge(key: string): BadgeConfig | undefined {
  return BADGE_BY_KEY.get(key);
}

export function getBadgesByCategory(category: BadgeCategory): BadgeConfig[] {
  return BADGES.filter((b) => b.category === category);
}

export function getBadgesByRarity(rarity: BadgeRarity): BadgeConfig[] {
  return BADGES.filter((b) => b.rarity === rarity);
}

/**
 * Streak badges that should be delayed in the realtime toast pipeline
 * so they don't visually fight with the existing streak-milestone
 * toast. Imported by client/src/hooks/useNotificationsRealtime.ts.
 */
export const STREAK_BADGE_KEYS = new Set<string>([
  "streak_keeper",
  "fortnight",
  "monthly_regular",
  "century_streak",
]);

/**
 * Streak threshold (days) → badge key. Wired into POST
 * /api/gamification/daily-checkin so a streak crossing N days fires
 * the matching badge alongside the existing streak milestone XP/credit.
 */
export const STREAK_MILESTONE_BADGE_KEYS: Record<number, string> = {
  7: "streak_keeper",
  14: "fortnight",
  30: "monthly_regular",
  100: "century_streak",
};

/**
 * Rank tier (1-indexed, matches RANKS in shared/rank-config.ts) →
 * badge key, awarded when awardXp() promotes the user past that
 * tier. tier 7 = Hall of Famer, tier 8 = VoxMax Legend.
 */
export const RANK_TIER_BADGE_KEYS: Record<number, string> = {
  7: "hall_inductee",
  8: "voxmax_legend_badge",
};

/**
 * Referral count → highest badge key crossed. Used by the
 * referral-handler when a referral_completed credit is awarded.
 */
export const REFERRAL_COUNT_BADGE_KEYS: Array<{
  threshold: number;
  key: string;
}> = [
  { threshold: 1, key: "pioneer" },
  { threshold: 5, key: "connector" },
  { threshold: 10, key: "community_builder" },
];
