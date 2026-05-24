import { supabaseServer } from "../supabase";

/** Load the auth email for a profile id (Supabase Auth user). */
export async function getSupabaseAuthEmail(userId: string): Promise<string | null> {
  try {
    const result = await supabaseServer.auth.admin.getUserById(userId);
    if (result.error) {
      console.warn(
        `[auth-email] Failed to load email for ${userId}: ${result.error.message}`,
      );
      return null;
    }
    return result.data.user?.email ?? null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[auth-email] Error loading email for ${userId}: ${message}`);
    return null;
  }
}
