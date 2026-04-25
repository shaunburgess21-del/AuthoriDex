/**
 * Centralizes Supabase auth error → human-readable copy mapping. Returns a
 * stable `code` so call sites can branch on the canonical reason (e.g.
 * `email_not_confirmed` triggers the silent-resend recovery flow on
 * LoginPage) without parsing message strings themselves.
 *
 * Codes:
 *   - invalid_credentials       Wrong email/password.
 *   - email_not_confirmed       Account exists but verify step never finished.
 *   - user_already_registered   Signup attempted for an existing account.
 *   - rate_limited              Supabase 429 / Resend 429 / "rate limit".
 *   - network                   Fetch failed before the server responded.
 *   - otp_expired               Code expired or invalid (verifyOtp errors).
 *   - unknown                   Fallback.
 */

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "user_already_registered"
  | "rate_limited"
  | "network"
  | "otp_expired"
  | "unknown";

export interface MappedAuthError {
  code: AuthErrorCode;
  message: string;
  suggestion?: string;
}

interface RawErrorShape {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  name?: unknown;
}

function readRaw(err: unknown): { message: string; code: string; status: number } {
  const e = (err ?? {}) as RawErrorShape;
  const message = typeof e.message === "string" ? e.message : "";
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.status === "number" ? e.status : 0;
  return { message, code, status };
}

export function mapAuthError(err: unknown): MappedAuthError {
  const { message, code, status } = readRaw(err);
  const lc = message.toLowerCase();

  if (code === "invalid_credentials" || lc.includes("invalid login credentials")) {
    return {
      code: "invalid_credentials",
      message: "That email and password don't match.",
      suggestion: "Try again, or use an email code instead.",
    };
  }

  if (code === "email_not_confirmed" || lc.includes("email not confirmed")) {
    return {
      code: "email_not_confirmed",
      message: "Verify your email to continue.",
      suggestion: "We just sent you a fresh 6-digit code.",
    };
  }

  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    lc.includes("user already registered") ||
    lc.includes("already registered") ||
    lc.includes("already been registered")
  ) {
    return {
      code: "user_already_registered",
      message: "An account with that email already exists.",
      suggestion: "Sign in instead, or reset via an email code.",
    };
  }

  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    status === 429 ||
    lc.includes("rate limit") ||
    lc.includes("too many requests")
  ) {
    return {
      code: "rate_limited",
      message: "Too many attempts.",
      suggestion: "Please wait a minute before trying again.",
    };
  }

  if (
    code === "otp_expired" ||
    lc.includes("token has expired") ||
    lc.includes("otp expired") ||
    lc.includes("invalid otp") ||
    lc.includes("invalid token") ||
    lc.includes("expired or invalid")
  ) {
    return {
      code: "otp_expired",
      message: "That code expired or is invalid.",
      suggestion: "Tap Resend to get a new one.",
    };
  }

  if (
    lc.includes("failed to fetch") ||
    lc.includes("networkerror") ||
    lc.includes("network request failed")
  ) {
    return {
      code: "network",
      message: "Network problem.",
      suggestion: "Check your connection and try again.",
    };
  }

  return {
    code: "unknown",
    message: message || "Something went wrong.",
    suggestion: "Please try again.",
  };
}
