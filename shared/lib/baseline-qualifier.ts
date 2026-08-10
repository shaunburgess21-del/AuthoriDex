/**
 * Detects "another / again" questions whose resolution criteria forgot the
 * baseline.
 *
 * Some questions are relative to something that already exists when the
 * market opens: "another film together", "delayed again", "a second album".
 * The pre-existing thing is usually the whole reason the question is
 * interesting — and it is also the thing most likely to be mistaken for the
 * answer.
 *
 * A real case: "Will Zendaya and Robert Pattinson be announced for another
 * movie together in 2026?" shipped with criteria reading "Resolves Yes if an
 * official announcement in 2026 confirms both are cast in the same film
 * project". That is satisfied by the film they were already cast in, so the
 * resolution scout proposed resolve-now at 99% confidence, citing the
 * baseline as its evidence.
 *
 * The import prompt now asks for the qualifier to be preserved. This is the
 * deterministic backstop for when it isn't: prompts drift, code doesn't.
 * Advisory only — it flags for a human rather than rejecting a good market
 * over wording.
 */

/**
 * Words that make a question relative to an existing baseline.
 *
 * Deliberately excludes "the next": "Who will win the next Ballon d'Or?" is a
 * well-defined recurring event, not a comparison against something that
 * already happened, and including it produced false positives.
 */
const BASELINE_QUALIFIER =
  /\b(another|again|a second|a 2nd|additional|once more|one more)\b/i;

/**
 * Phrases that show the criteria have anchored the baseline out: either an
 * explicit reference to what already exists, or a novelty/temporal boundary a
 * pre-existing instance necessarily falls outside.
 *
 * Deliberately does NOT accept bare exclusion language like "do not count".
 * Nearly every market carries a "rumors do not count" line, so treating that
 * as acknowledgement made the detector miss the exact case it was written for.
 */
const BASELINE_ACKNOWLEDGED =
  /(\balready\b|pre-?existing|\bbaseline\b|on or after|later than|after the market|since the market|\bnewly\b|\bolder\b|\bprevious(ly)?\b|\bprior\b|\bnew (song|single|film|movie|album|project|release|date|episode|season|tour|deal|contract)\b)/i;

export interface BaselineQualifierAdvice {
  /** True when the title is baseline-relative but the criteria never say so. */
  flagged: boolean;
  /** The qualifier found in the title, when any. */
  qualifier: string | null;
  /** Short, admin-facing rationale. */
  reason: string;
}

/** True when a title asks whether something happens again. */
export function hasBaselineQualifier(title: string | null | undefined): boolean {
  return BASELINE_QUALIFIER.test((title ?? "").trim());
}

/**
 * Flag a market whose title is baseline-relative but whose criteria read as
 * though any instance counts. Pure + shared so the importer and the admin
 * modal agree.
 */
export function computeBaselineQualifierAdvice(args: {
  title: string | null | undefined;
  criteria: Array<string | null | undefined> | null | undefined;
}): BaselineQualifierAdvice {
  const title = (args.title ?? "").trim();
  const match = BASELINE_QUALIFIER.exec(title);
  if (!match) {
    return { flagged: false, qualifier: null, reason: "" };
  }

  const criteria = (args.criteria ?? [])
    .map((c) => (typeof c === "string" ? c : ""))
    .join(" ");
  if (BASELINE_ACKNOWLEDGED.test(criteria)) {
    return {
      flagged: false,
      qualifier: match[0],
      reason: "Criteria already exclude the pre-existing case.",
    };
  }

  return {
    flagged: true,
    qualifier: match[0],
    reason:
      `The question asks about "${match[0]}", so it is relative to something that ` +
      `already exists — but the criteria never exclude it. As written, the thing ` +
      `that already happened satisfies the market. Name the baseline and say it ` +
      `doesn't count before publishing.`,
  };
}
