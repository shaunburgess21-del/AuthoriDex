/**
 * Auto-link matchup option sides to induction-queue shadow tracked_people rows
 * by exact display-name match. Clears stored matchup-bucket image URLs when
 * linked so curate-winning avatars resolve correctly.
 */

import { and, eq, sql } from "drizzle-orm";
import { inductionCandidates, trackedPeople } from "@shared/schema";

export type InductionPersonMap = Map<string, string>;

export function inductionNameKey(displayName: string): string {
  return displayName.trim().toLowerCase();
}

/** Active induction_candidates joined to tracked_people shadows (status = induction). */
export async function buildInductionPersonIdByName(): Promise<InductionPersonMap> {
  const { db } = await import("../db");
  const rows = await db
    .select({
      displayName: inductionCandidates.displayName,
      personId: trackedPeople.id,
    })
    .from(inductionCandidates)
    .innerJoin(
      trackedPeople,
      sql`LOWER(TRIM(${trackedPeople.name})) = LOWER(TRIM(${inductionCandidates.displayName}))`,
    )
    .where(
      and(
        eq(inductionCandidates.isActive, true),
        eq(trackedPeople.status, "induction"),
      ),
    );

  const map: InductionPersonMap = new Map();
  for (const row of rows) {
    map.set(inductionNameKey(row.displayName), row.personId);
  }
  return map;
}

export type InductionSideLinkResult = {
  personId: string | null;
  clearImage: boolean;
  linked: boolean;
};

/**
 * Resolve whether an option side should link to an induction shadow person.
 * Returns linked=true when option text matches the induction map.
 */
export function resolveInductionMatchupSideLink(
  optionText: string,
  existingPersonId: string | null | undefined,
  inductionMap: InductionPersonMap,
): InductionSideLinkResult {
  const inductionId = inductionMap.get(inductionNameKey(optionText)) ?? null;
  if (!inductionId) {
    return {
      personId: existingPersonId ?? null,
      clearImage: false,
      linked: false,
    };
  }

  const personId = inductionId;
  const hadMismatch =
    existingPersonId != null && existingPersonId !== inductionId;
  if (hadMismatch) {
    console.warn(
      `[matchup-person-link] Induction name "${optionText}" maps to ${inductionId} ` +
        `but existing personId was ${existingPersonId}; using induction id`,
    );
  }

  return {
    personId,
    clearImage: true,
    linked: true,
  };
}

export type MatchupSideLinkInput = {
  optionAText: string;
  optionBText: string;
  personAId?: string | null;
  personBId?: string | null;
  optionAImage?: string | null;
  optionBImage?: string | null;
};

export type MatchupSideLinkOutput = {
  personAId: string | null;
  personBId: string | null;
  optionAImage: string | null;
  optionBImage: string | null;
};

/**
 * Normalize matchup person links: auto-link induction sides by name and
 * clear stored option images whenever a person id is set (matches admin UI).
 */
export function applyInductionMatchupSideLinks(
  input: MatchupSideLinkInput,
  inductionMap: InductionPersonMap,
): MatchupSideLinkOutput {
  const sideA = resolveInductionMatchupSideLink(
    input.optionAText,
    input.personAId,
    inductionMap,
  );
  const sideB = resolveInductionMatchupSideLink(
    input.optionBText,
    input.personBId,
    inductionMap,
  );

  let personAId = sideA.personId;
  let personBId = sideB.personId;
  let optionAImage = input.optionAImage ?? null;
  let optionBImage = input.optionBImage ?? null;

  if (sideA.clearImage) {
    optionAImage = null;
  }
  if (sideB.clearImage) {
    optionBImage = null;
  }

  // Belt-and-suspenders: any linked person uses avatar, not stored matchup URL.
  if (personAId) {
    optionAImage = null;
  }
  if (personBId) {
    optionBImage = null;
  }

  return { personAId, personBId, optionAImage, optionBImage };
}

export async function applyInductionMatchupSideLinksFromDb(
  input: MatchupSideLinkInput,
): Promise<MatchupSideLinkOutput> {
  const inductionMap = await buildInductionPersonIdByName();
  return applyInductionMatchupSideLinks(input, inductionMap);
}
