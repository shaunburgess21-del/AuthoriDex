import { Capacitor } from '@capacitor/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Persisted session key. PKCE verifier is `${key}-code-verifier`. */
export const SUPABASE_AUTH_STORAGE_KEY = 'authoridex-auth';

let supabasePromise: Promise<SupabaseClient> | null = null;

async function createSupabaseClient(): Promise<SupabaseClient> {
  const response = await fetch('/api/config/supabase');
  const { url, anonKey } = await response.json();
  
  if (!url || !anonKey) {
    throw new Error('Failed to load Supabase configuration from server');
  }

  // Web stays on the library default (implicit + detectSessionInUrl) so
  // https://voxdex.com/login#access_token continues to create a session.
  // Native Google OAuth must be PKCE: Custom Tabs drop URL fragments, and
  // the return is com.voxdex.app://login?code= rather than the WebView URL.
  const native = Capacitor.isNativePlatform();
  
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
      ...(native ? { flowType: 'pkce' as const, detectSessionInUrl: false } : {}),
    }
  });
}

export async function getSupabase(): Promise<SupabaseClient> {
  if (!supabasePromise) {
    supabasePromise = createSupabaseClient();
  }
  return supabasePromise;
}

// For backwards compatibility, export a promise-based client
export const supabase = getSupabase();
