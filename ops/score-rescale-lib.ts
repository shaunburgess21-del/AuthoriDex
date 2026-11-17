/**
 * Pure transforms for the Nov 2026 score rescale (legacy x10,000 scale →
 * x1,000 scale, i.e. every stored score divided by 10 and rounded).
 *
 * No DB access and no side effects — everything here is unit-tested in
 * tests/score-rescale.test.ts. The orchestration lives in
 * ops/rescale-scores-div10.ts.
 */

export const RESCALE_DIVISOR = 10;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Divide by 10 and round half away from zero — the same rule as Postgres
 * `round(numeric)`, so values rescaled here and values rescaled in SQL agree
 * exactly. (JS `Math.round` alone rounds -0.5 toward zero.) Integers use
 * integer arithmetic so there is no floating-point tie ambiguity.
 */
export function rescaleScore(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  if (Number.isInteger(abs)) {
    const quotient = Math.trunc(abs / RESCALE_DIVISOR);
    const rounded = abs % RESCALE_DIVISOR >= RESCALE_DIVISOR / 2 ? quotient + 1 : quotient;
    return rounded === 0 ? 0 : sign * rounded;
  }
  const rounded = Math.round(abs / RESCALE_DIVISOR);
  return rounded === 0 ? 0 : sign * rounded;
}

/**
 * Rescale a value that was derived from two scores (a margin or a change).
 * If the stored value is consistent with its two source scores, recompute it
 * from the *rescaled* sources so the three numbers still add up on screen
 * (independent rounding could otherwise leave "off by 1" mismatches). If it
 * is not consistent — or a source is missing — fall back to a plain rescale.
 */
export function rescaleDerived(
  stored: number,
  a: unknown,
  b: unknown,
  mode: "absDiff" | "aMinusB",
): number {
  if (isFiniteNumber(a) && isFiniteNumber(b)) {
    const expected = mode === "absDiff" ? Math.abs(a - b) : a - b;
    if (stored === expected) {
      const ra = rescaleScore(a);
      const rb = rescaleScore(b);
      return mode === "absDiff" ? Math.abs(ra - rb) : ra - rb;
    }
  }
  return rescaleScore(stored);
}

/** Rescale the listed numeric keys of an object in place. Returns how many changed. */
function rescaleKeys(target: JsonRecord, keys: readonly string[]): number {
  let changed = 0;
  for (const key of keys) {
    const value = target[key];
    if (isFiniteNumber(value)) {
      target[key] = rescaleScore(value);
      changed++;
    }
  }
  return changed;
}

// ───────────────────────────────────────────────────────────────────────────
// prediction_markets.resolution_notes (TEXT column holding JSON)
// ───────────────────────────────────────────────────────────────────────────

export type NativeMarketType = "updown" | "h2h" | "gainer" | "jackpot";

export function isNativeMarketType(value: string): value is NativeMarketType {
  return value === "updown" || value === "h2h" || value === "gainer" || value === "jackpot";
}

export interface ResolutionNotesResult {
  /** New text for the column (identical to the input when nothing changed). */
  text: string;
  /** Number of score fields rewritten. */
  changedFields: number;
  /** True when the original was not compact / 2-space JSON and had to be re-serialised compactly. */
  reformatted: boolean;
  /** Set when the text could not be processed; the row must be left alone. */
  skipped?: "not_json" | "not_object";
}

/**
 * Rescale the score fields inside a native market's resolution notes.
 *
 * Only score-valued keys are touched. Credits (`creditedToHouse`,
 * `payoutLiability`, `warmStartCost`, `totalPool`, `payout`, …), counts,
 * timestamps and the pre-formatted percent strings are deliberately left
 * exactly as they are — percentages are scale-free.
 */
export function rescaleResolutionNotes(marketType: NativeMarketType, text: string): ResolutionNotesResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { text, changedFields: 0, reformatted: false, skipped: "not_json" };
  }
  if (!isRecord(parsed)) {
    return { text, changedFields: 0, reformatted: false, skipped: "not_object" };
  }

  // Work out how the original was serialised *before* mutating, so the
  // rewritten text keeps the same style.
  const wasCompact = JSON.stringify(parsed) === text;
  const wasPretty = !wasCompact && JSON.stringify(parsed, null, 2) === text;

  let changedFields = 0;

  if (marketType === "updown") {
    const open = parsed.openScore;
    const close = parsed.closeScore;
    const change = parsed.change;
    if (isFiniteNumber(change)) {
      parsed.change = rescaleDerived(change, close, open, "aMinusB");
      changedFields++;
    }
    changedFields += rescaleKeys(parsed, ["openScore", "closeScore", "singleCloseScore"]);
  } else if (marketType === "h2h") {
    for (const entryKey of ["entryA", "entryB"] as const) {
      const entry = parsed[entryKey];
      if (isRecord(entry)) {
        changedFields += rescaleKeys(entry, ["score", "singleScore"]);
      }
    }
  } else if (marketType === "gainer") {
    const rankings = parsed.rankings;
    if (Array.isArray(rankings)) {
      for (const row of rankings) {
        if (isRecord(row)) {
          changedFields += rescaleKeys(row, ["openScore", "closeScore", "singleCloseScore"]);
        }
      }
    }
  } else {
    const actual = parsed.actualScore;
    const winning = parsed.winningPrediction;
    const margin = parsed.margin;
    if (isFiniteNumber(margin)) {
      parsed.margin = rescaleDerived(margin, winning, actual, "absDiff");
      changedFields++;
    }
    changedFields += rescaleKeys(parsed, ["actualScore", "winningPrediction"]);
  }

  if (changedFields === 0) {
    return { text, changedFields: 0, reformatted: false };
  }

  return {
    text: wasPretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed),
    changedFields,
    reformatted: !wasCompact && !wasPretty,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// notifications.body (jackpot "market_resolved" rows)
// ───────────────────────────────────────────────────────────────────────────

export interface NotificationBodyResult {
  body: string;
  replacements: number;
  /** Score values present in metadata whose phrase was not found in the body. */
  misses: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite the scores quoted in a jackpot resolution notification so the text
 * matches its (rescaled) metadata.
 *
 * Deliberately NOT a blind "divide every number" pass: a body can also quote
 * credits ("Lost 100 credits", "Payout 5,600") and other notification kinds
 * quote real-world figures. A number is only rewritten when it sits behind a
 * known phrase AND equals the value stored in this row's own metadata.
 *
 * `oldMetadata` must be the metadata as it was BEFORE the rescale.
 */
export function rescaleJackpotNotificationBody(body: string, oldMetadata: unknown): NotificationBodyResult {
  if (!isRecord(oldMetadata)) {
    return { body, replacements: 0, misses: [] };
  }

  const actual = oldMetadata.actualScore;
  const predicted = oldMetadata.predictedScore;
  const margin = oldMetadata.margin;

  const targets: Array<{ name: string; phrase: string; oldValue: number; newValue: number }> = [];
  if (isFiniteNumber(actual)) {
    targets.push({ name: "actualScore", phrase: "[Cc]losed at ", oldValue: actual, newValue: rescaleScore(actual) });
  }
  if (isFiniteNumber(predicted)) {
    targets.push({ name: "predictedScore", phrase: "You predicted ", oldValue: predicted, newValue: rescaleScore(predicted) });
  }
  if (isFiniteNumber(margin)) {
    targets.push({
      name: "margin",
      phrase: "off by ",
      oldValue: margin,
      newValue: rescaleDerived(margin, predicted, actual, "absDiff"),
    });
  }

  let next = body;
  let replacements = 0;
  const misses: string[] = [];

  for (const target of targets) {
    // The lookahead stops "607929" matching inside "6079291" or "607929.5".
    const pattern = new RegExp(`(${target.phrase})${escapeRegExp(String(target.oldValue))}(?![0-9,]|\\.[0-9])`);
    if (pattern.test(next)) {
      next = next.replace(pattern, `$1${target.newValue}`);
      replacements++;
    } else {
      misses.push(target.name);
    }
  }

  return { body: next, replacements, misses };
}

// ───────────────────────────────────────────────────────────────────────────
// Active jackpot tickets — unique (market_id, predictedScore) must survive
// ───────────────────────────────────────────────────────────────────────────

export interface ActiveTicket {
  id: string;
  marketId: string;
  predictedScore: number;
  isAgent: boolean;
  /** ISO timestamp or epoch ms — only used for ordering. */
  createdAt: string | number;
}

export interface TicketAssignment {
  id: string;
  marketId: string;
  oldScore: number;
  newScore: number;
  /** newScore − round(oldScore / 10); non-zero only for tickets moved off a collision. */
  nudge: number;
}

function toEpoch(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Assign every active jackpot ticket its rescaled number.
 *
 * Two tickets on the same market that were up to 9 apart on the old scale
 * can round to the same number, and a unique index
 * (`market_bets_jackpot_score_unique_idx`) forbids that. When it happens:
 *
 *   - a human's ticket always keeps its number ahead of an agent's;
 *   - otherwise the earlier ticket keeps it;
 *   - the loser moves to the nearest free number, trying first the side its
 *     original guess was on (so relative order is preserved where possible).
 *
 * A nudge of ±1 on the new scale equals ±10 on the old one — i.e. the same
 * magnitude as the rounding itself.
 */
export function assignActiveTicketScores(
  tickets: readonly ActiveTicket[],
  maxScore: number,
): TicketAssignment[] {
  const byMarket = new Map<string, ActiveTicket[]>();
  for (const ticket of tickets) {
    const list = byMarket.get(ticket.marketId);
    if (list) list.push(ticket);
    else byMarket.set(ticket.marketId, [ticket]);
  }

  const assignments: TicketAssignment[] = [];

  for (const [marketId, marketTickets] of byMarket) {
    const ordered = [...marketTickets].sort((a, b) => {
      if (a.isAgent !== b.isAgent) return a.isAgent ? 1 : -1;
      const byTime = toEpoch(a.createdAt) - toEpoch(b.createdAt);
      if (byTime !== 0) return byTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const taken = new Map<number, ActiveTicket>();

    for (const ticket of ordered) {
      const base = rescaleScore(ticket.predictedScore);
      let chosen: number | null = null;

      if (!taken.has(base)) {
        chosen = base;
      } else {
        const holder = taken.get(base)!;
        // Prefer the side the original guess sat on relative to the holder.
        const preferUp = ticket.predictedScore >= holder.predictedScore;
        for (let offset = 1; offset <= marketTickets.length + 1 && chosen === null; offset++) {
          const candidates = preferUp ? [base + offset, base - offset] : [base - offset, base + offset];
          for (const candidate of candidates) {
            if (candidate >= 1 && candidate <= maxScore && !taken.has(candidate)) {
              chosen = candidate;
              break;
            }
          }
        }
      }

      if (chosen === null) {
        throw new Error(
          `No free jackpot number near ${base} for ticket ${ticket.id} on market ${marketId}`,
        );
      }

      taken.set(chosen, ticket);
      assignments.push({
        id: ticket.id,
        marketId,
        oldScore: ticket.predictedScore,
        newScore: chosen,
        nudge: chosen - base,
      });
    }
  }

  return assignments;
}
