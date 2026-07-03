import {
  PSEUDONYM_ADJECTIVES,
  PSEUDONYM_NOUNS,
} from "./pseudonym-words";

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;

const MAX_SUFFIX = 99;
const MIN_SUFFIX = 1;

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

export function buildPseudonym(adj: string, noun: string, num: number): string {
  const suffix = String(Math.min(MAX_SUFFIX, Math.max(MIN_SUFFIX, Math.floor(num))));
  return `${adj}${noun}${suffix}`;
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function randomSuffix(): number {
  return Math.floor(Math.random() * MAX_SUFFIX) + MIN_SUFFIX;
}

export interface PseudonymCandidate {
  adj: string;
  noun: string;
  num: number;
  username: string;
}

/** Random Adj + Noun + 1–99 in PascalCase (no separator). */
export function randomPseudonymCandidate(): PseudonymCandidate {
  const adj = pickRandom(PSEUDONYM_ADJECTIVES);
  const noun = pickRandom(PSEUDONYM_NOUNS);
  const num = randomSuffix();
  return {
    adj,
    noun,
    num,
    username: buildPseudonym(adj, noun, num),
  };
}

/** Same words, new suffix — used when bumping on collision. */
export function pseudonymWithNewSuffix(
  adj: string,
  noun: string,
  exclude?: number,
): PseudonymCandidate {
  let num = randomSuffix();
  let guard = 0;
  while (exclude != null && num === exclude && guard < 20) {
    num = randomSuffix();
    guard++;
  }
  return {
    adj,
    noun,
    num,
    username: buildPseudonym(adj, noun, num),
  };
}
