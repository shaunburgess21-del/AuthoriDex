/**
 * Paths a signed-in user who has not finished onboarding may open
 * without being sent back to /login/welcome. Legal and contact pages
 * stay readable mid-signup, including the public account-deletion
 * explanation.
 */
export const NEW_USER_GATE_ALLOWLIST = [
  "/terms",
  "/privacy",
  "/takedown",
  "/contact",
  "/account-deletion",
] as const;

export function isNewUserGateAllowlisted(path: string): boolean {
  return (NEW_USER_GATE_ALLOWLIST as readonly string[]).includes(path);
}
