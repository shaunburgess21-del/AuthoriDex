/**
 * Transient auth state shared between LoginPage and the verify/welcome screens.
 *
 * Why sessionStorage: this state must survive a same-tab route change but must
 * not leak across tabs (each tab gets its own pending submission) and must die
 * when the user closes the browser. The 10-minute TTL matches the OTP email
 * template's stated "code expires in 10 minutes" copy — if the snapshot is
 * older than that, the user must restart the flow anyway because the code on
 * the email is no longer accepted by Supabase.
 */
const KEY = "voxdex_pending_auth";
const TTL_MS = 10 * 60 * 1000;

export type PendingIntent = "password_signup" | "otp" | "email";

export interface PendingAuth {
  email: string;
  intent: PendingIntent;
  ts: number;
}

export function setPending(email: string, intent: PendingIntent): void {
  try {
    const payload: PendingAuth = { email, intent, ts: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage may be unavailable (privacy mode, quota); the verify
    // page will redirect back to /login if it can't read pending state.
  }
}

export function getPending(): PendingAuth | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingAuth> | null;
    if (
      !parsed ||
      typeof parsed.email !== "string" ||
      typeof parsed.intent !== "string" ||
      typeof parsed.ts !== "number"
    ) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    if (Date.now() - parsed.ts > TTL_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    if (
      parsed.intent !== "password_signup" &&
      parsed.intent !== "otp" &&
      parsed.intent !== "email"
    ) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return { email: parsed.email, intent: parsed.intent, ts: parsed.ts };
  } catch {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

export function clearPending(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
