/**
 * Platform-wide voter demographics for Insights Vote tab.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import type {
  VoteSurfaceRow,
  VoterDemographicRow,
  VoterDemographics,
} from "@shared/insights/types";
import { VOTE_SURFACE_LABELS } from "@shared/insights/constants";
import { getCountryName } from "@shared/countries";
import { withDiscoverCache } from "./discover-cache";

const CORE_VOTE_TYPES = [
  "face_off",
  "opinion_poll",
  "trending_poll",
  "overall_rating",
  "value_vote",
  "sentiment",
] as const;

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  prefer_not_to_say: "Prefer not to say",
};

/** Collapse common gender free-text variants into stable bucket keys. */
function normalizeGenderKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === "male" || key === "man" || key === "m") return "male";
  if (key === "female" || key === "woman" || key === "f") return "female";
  if (
    key === "prefer_not_to_say" ||
    key === "prefer not to say" ||
    key === "prefer-not-to-say"
  ) {
    return "prefer_not_to_say";
  }
  return key;
}

const genderBucketSql = sql`
  CASE
    WHEN LOWER(TRIM(p.gender)) IN ('male', 'man', 'm') THEN 'male'
    WHEN LOWER(TRIM(p.gender)) IN ('female', 'woman', 'f') THEN 'female'
    WHEN LOWER(TRIM(p.gender)) IN (
      'prefer_not_to_say', 'prefer not to say', 'prefer-not-to-say'
    ) THEN 'prefer_not_to_say'
    ELSE LOWER(TRIM(p.gender))
  END
`;

function mapRows(result: unknown): Record<string, unknown>[] {
  return (
    (Array.isArray(result)
      ? result
      : (result as { rows: Record<string, unknown>[] }).rows) ?? []
  );
}

function avgVotes(voters: number, votes: number): number {
  if (voters <= 0) return 0;
  return Math.round((votes / voters) * 10) / 10;
}

function mapDemographicRows(
  rows: Record<string, unknown>[],
  keyField: string,
  labelForKey: (key: string) => string,
): VoterDemographicRow[] {
  return rows
    .map((row) => {
      const rawKey = String(row[keyField] ?? "unknown");
      const key = keyField === "gender_key" ? normalizeGenderKey(rawKey) : rawKey;
      const voters = Number(row.voters ?? 0);
      const votes = Number(row.votes ?? 0);
      return {
        key,
        label: labelForKey(key),
        voters,
        votes,
        avgVotes: avgVotes(voters, votes),
      };
    })
    .sort((a, b) => b.votes - a.votes);
}

function mapSurfaceRows(rows: Record<string, unknown>[]): VoteSurfaceRow[] {
  return rows.map((row) => {
    const key = String(row.vote_type ?? "unknown");
    return {
      key,
      label: VOTE_SURFACE_LABELS[key] ?? key,
      voters: Number(row.voters ?? 0),
      votes: Number(row.votes ?? 0),
    };
  });
}

export type DemographicsWindow = "all" | "30d" | "7d";

function demographicsCreatedAtFilter(window: DemographicsWindow) {
  if (window === "7d") return sql`AND va.created_at >= NOW() - INTERVAL '7 days'`;
  if (window === "30d") return sql`AND va.created_at >= NOW() - INTERVAL '30 days'`;
  return sql``;
}

const voteTypeFilter = sql`va.vote_type IN (
  'face_off', 'opinion_poll', 'trending_poll',
  'overall_rating', 'value_vote', 'sentiment'
)`;

const humanVoterFilter = sql`
  p.is_agent = false
  AND p.is_house = false
`;

export async function loadVoterDemographics(
  window: DemographicsWindow = "all",
): Promise<VoterDemographics> {
  const timeFilter = demographicsCreatedAtFilter(window);
  return withDiscoverCache(`vote:demographics:${window}`, async () => {
    const baseWhere = sql`
      va.action_kind = 'create'
      AND ${voteTypeFilter}
      AND ${humanVoterFilter}
    `;

    const [countryResult, genderResult, surfaceResult, totalsResult] = await Promise.all([
      db.execute(sql`
        SELECT
          p.country_of_residence AS country_code,
          COUNT(DISTINCT p.id)::int AS voters,
          COUNT(va.id)::int AS votes
        FROM vote_actions va
        INNER JOIN profiles p ON p.id = va.user_id
        WHERE ${baseWhere}
          AND p.country_of_residence IS NOT NULL
          AND p.country_of_residence != ''
          ${timeFilter}
        GROUP BY p.country_of_residence
        ORDER BY votes DESC
      `),
      db.execute(sql`
        SELECT
          ${genderBucketSql} AS gender_key,
          COUNT(DISTINCT p.id)::int AS voters,
          COUNT(va.id)::int AS votes
        FROM vote_actions va
        INNER JOIN profiles p ON p.id = va.user_id
        WHERE ${baseWhere}
          AND p.gender IS NOT NULL
          AND TRIM(p.gender) != ''
          ${timeFilter}
        GROUP BY 1
        ORDER BY votes DESC
      `),
      db.execute(sql`
        SELECT
          va.vote_type,
          COUNT(DISTINCT p.id)::int AS voters,
          COUNT(va.id)::int AS votes
        FROM vote_actions va
        INNER JOIN profiles p ON p.id = va.user_id
        WHERE ${baseWhere}
          ${timeFilter}
        GROUP BY va.vote_type
        ORDER BY votes DESC
      `),
      db.execute(sql`
        SELECT
          COUNT(DISTINCT p.id)::int AS voter_count,
          COUNT(DISTINCT p.country_of_residence) FILTER (
            WHERE p.country_of_residence IS NOT NULL AND p.country_of_residence != ''
          )::int AS country_count,
          COUNT(va.id)::int AS total_votes
        FROM vote_actions va
        INNER JOIN profiles p ON p.id = va.user_id
        WHERE ${baseWhere}
          ${timeFilter}
      `),
    ]);

    const countryRows = mapRows(countryResult);
    const genderRows = mapRows(genderResult);
    const surfaceRows = mapRows(surfaceResult);
    const totalsRow = mapRows(totalsResult)[0] ?? {};

    const byCountry = mapDemographicRows(countryRows, "country_code", (key) =>
      getCountryName(key) ?? key,
    );
    const byGender = mapDemographicRows(genderRows, "gender_key", (key) =>
      GENDER_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1),
    );
    const bySurface = mapSurfaceRows(surfaceRows);

    return {
      voterCount: Number(totalsRow.voter_count ?? 0),
      countryCount: Number(totalsRow.country_count ?? 0),
      totalVotes: Number(totalsRow.total_votes ?? 0),
      byCountry,
      byGender,
      bySurface,
    };
  });
}

export { CORE_VOTE_TYPES };
