/** User-facing account-deletion copy shared by Settings and tests.
 *  Describes the real 7-day schedule. Does not describe the account
 *  as permanently deleted during that window. */

export const DELETE_ACCOUNT_SETTINGS_SUMMARY =
  "Schedule deletion in 7 days. Your account stays active until then, and you can cancel.";

export const DELETE_ACCOUNT_DIALOG_PARAGRAPHS = [
  "Scheduling deletion starts a 7-day window. During those 7 days your account stays active, you can still sign in, and you can cancel. The account is not permanently deleted during this window.",
  "When the 7 days end, we remove your sign-in email and auth identity, username, avatar, bio, demographics, date of birth, recovery email, phone number, and social handles. Your public profile is removed. Vox balance, XP, streaks, referrals, preferences, and interests are cleared.",
  "Votes, poll responses, matchup votes, and predictions stay so historical results remain intact, but they are no longer tied to an identifiable account. Comment text is replaced with a placeholder and the author is shown as a deleted user. The virtual credit ledger stays as an engineering audit log with identifying fields removed.",
] as const;

export const DELETE_ACCOUNT_PENDING_BODY = (when: string) =>
  `Your account is scheduled for deletion on ${when}. It stays active until then, and you can cancel any time before that.`;
