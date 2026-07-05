import { supabaseServer } from "../supabase";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Find profile ids whose Supabase auth email contains `term`
 * (case-insensitive). Queries `auth.users` directly — the GoTrue admin
 * API has no email filter, and paginating listUsers() to scan for a
 * match would be O(all users) per keystroke. Raw SQL is required here
 * because the `auth` schema isn't part of our Drizzle schema.
 *
 * LIKE wildcards are stripped from the term so an admin typing `%` or
 * `_` can't broaden the match; the term itself is parameterized.
 */
export async function getSupabaseUserIdsByEmail(term: string, limit = 20): Promise<string[]> {
  const cleaned = term.trim().replace(/[%_\\]/g, "");
  if (!cleaned) return [];
  try {
    const result = await db.execute(
      sql`SELECT id FROM auth.users WHERE email ILIKE ${"%" + cleaned + "%"} LIMIT ${limit}`,
    );
    return (result.rows as Array<{ id: string }>).map((r) => String(r.id));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[auth-email] Email search failed for term: ${message}`);
    return [];
  }
}

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
