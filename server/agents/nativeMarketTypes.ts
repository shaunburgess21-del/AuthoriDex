/** Cached LLM assessment for native markets (updown / h2h / gainer). */

export type NativeExpectedDirection = "UP" | "DOWN" | "FLAT";

export interface NativeAssessment {
  expectedDirection: NativeExpectedDirection;
  /** 0–1 probability the market resolves UP (or leading entry for H2H/Race). */
  probability: number;
  rationale: string;
  fetchedAt: string;
  model: string;
  marketType: string;
  inputs?: {
    pctChangeVsOpen?: number;
    scoreDelta7d?: number;
    scoreDelta14d?: number;
    topNewsHeadlines?: string[];
    entryLabels?: string[];
  };
}
