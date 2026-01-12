import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabasePromise: Promise<SupabaseClient> | null = null;

async function createSupabaseClient(): Promise<SupabaseClient> {
  const response = await fetch('/api/config/supabase');
  const { url, anonKey } = await response.json();
  
  if (!url || !anonKey) {
    throw new Error('Failed to load Supabase configuration from server');
  }
  
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'famedex-auth',
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
