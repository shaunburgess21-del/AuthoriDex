import { Capacitor } from '@capacitor/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  SUPABASE_AUTH_STORAGE_KEY,
  createGuardedAuthStorage,
  releaseAuthSessionBlockOnSignIn,
} from "./authSession";

/** Persisted session key. PKCE verifier is `${key}-code-verifier`. */
export {
  SUPABASE_AUTH_STORAGE_KEY,
  hasPersistedAuthSession,
  sessionJsonHasAccessToken,
} from "./authSession";

let supabasePromise: Promise<SupabaseClient> | null = null;

async function createSupabaseClient(): Promise<SupabaseClient> {
  const response = await fetch('/api/config/supabase');
  const { url, anonKey } = await response.json();
  
  if (!url || !anonKey) {
    throw new Error('Failed to load Supabase configuration from server');
  }

  // Web stays on the library default (implicit + detectSessionInUrl) so
  // https://voxdex.com/login#access_token continues to create a session.
  // Native Google OAuth must be PKCE. Android Custom Tabs and the iOS
  // auth session return com.voxdex.app://login?code= rather than the WebView
  // URL, and custom-scheme redirects drop URL fragments.
  const native = Capacitor.isNativePlatform();
  
  // Guarded storage drops auth-key writes once logout starts, so an in-flight
  // refresh cannot put the session back. Sign-in methods release that block.
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
      ...(typeof window !== "undefined"
        ? { storage: createGuardedAuthStorage(window.localStorage) }
        : {}),
      ...(native ? { flowType: 'pkce' as const, detectSessionInUrl: false } : {}),
    }
  });
  releaseAuthSessionBlockOnSignIn(client.auth);
  return client;
}

export async function getSupabase(): Promise<SupabaseClient> {
  if (!supabasePromise) {
    supabasePromise = createSupabaseClient();
  }
  return supabasePromise;
}

// For backwards compatibility, export a promise-based client
export const supabase = getSupabase();
