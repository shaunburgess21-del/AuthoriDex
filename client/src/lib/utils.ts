import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Converts a 1-5 vote scale to an approval percentage (0-100%).
 * Uses zero-anchored formula: (vote - 1) * 25
 * 
 * Vote 1 = 0% (strongly negative)
 * Vote 2 = 25%
 * Vote 3 = 50% (neutral)
 * Vote 4 = 75%
 * Vote 5 = 100% (strongly positive)
 */
export function voteToApprovalPercent(vote: number | null | undefined): number {
  if (!vote || vote < 1) return 0;
  if (vote > 5) return 100;
  return Math.round((vote - 1) * 25);
}
