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
 *   - email_send_failed         Send Email hook returned 500 (verification mail).
 *   - unknown                   Fallback.
 */

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "user_already_registered"
  | "weak_password"
  | "rate_limited"
  | "network"
  | "otp_expired"
  | "email_send_failed"
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
      message: "This email is already registered. Sign in to continue.",
      suggestion: "Sign in, or use an email code if you forgot your password.",
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
      message: "Too many requests right now.",
      suggestion: "Please wait about a minute, then try again.",
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

  // Supabase HIBP rejection (the "Prevent use of leaked passwords" toggle).
  // The error code on signUp is `weak_password`; the message reads
  // "Password is known to be weak and easy to guess, please choose a
  // different one." We match on either to stay resilient to copy
  // changes upstream.
  if (
    code === "weak_password" ||
    lc.includes("known to be weak") ||
    lc.includes("known to be easy") ||
    lc.includes("pwned") ||
    lc.includes("data breach")
  ) {
    return {
      code: "weak_password",
      message: "That password has appeared in a known data breach.",
      suggestion:
        "Try something more unique \u2014 a passphrase or random mix works best.",
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

  if (
    lc.includes("unexpected status code returned from hook") ||
    lc.includes("hook: 500") ||
    lc.includes("email send failed")
  ) {
    return {
      code: "email_send_failed",
      message: "We couldn't send your verification code.",
      suggestion: "Please try again in a moment, or continue with Google.",
    };
  }

  return {
    code: "unknown",
    message: message || "Something went wrong.",
    suggestion: "Please try again.",
  };
}
