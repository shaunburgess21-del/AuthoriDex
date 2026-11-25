import type { AuthReason } from "@/lib/authReturn";

export const SIGNUP_GENERIC_TITLE = "Create your account";

export const SIGNUP_GENERIC_DESCRIPTION =
  "Make predictions, vote on what matters, build your track record.";

export const SIGNUP_SIGNIN_TITLE = "Welcome back";

export const SIGNUP_SIGNIN_DESCRIPTION =
  "Sign in to vote, predict, and track your favorites.";

export interface SignupFormCopy {
  title: string;
  description: string;
}

/**
 * Card heading and subtext on /login. A recognised `reason` replaces the
 * generic signup lines. Sign-in, and signup with no reason, stay generic.
 * Predict keeps the line the reason modal already uses ("You've got the instinct.").
 */
export function signupFormCopy(isLogin: boolean, reason: AuthReason | null): SignupFormCopy {
  if (isLogin) {
    return { title: SIGNUP_SIGNIN_TITLE, description: SIGNUP_SIGNIN_DESCRIPTION };
  }
  switch (reason) {
    case "predict_signup":
      return {
        title: "Create a free account to make predictions",
        description: "You've got the instinct.",
      };
    case "favorite_signup":
      return {
        title: "Create a free account to save your favourites",
        description: "Keep the ones you follow.",
      };
    case "vote_limit_reached":
      return {
        title: "Create a free account to keep voting",
        description: "You've made your voice heard.",
      };
    default:
      return { title: SIGNUP_GENERIC_TITLE, description: SIGNUP_GENERIC_DESCRIPTION };
  }
}

export function parseAuthReason(value: string | null): AuthReason | null {
  if (
    value === "vote_limit_reached" ||
    value === "predict_signup" ||
    value === "favorite_signup"
  ) {
    return value;
  }
  return null;
}
