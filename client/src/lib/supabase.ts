import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;
let configPromise: Promise<{ url: string; anonKey: string }> | null = null;

async function getSupabaseConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/config/supabase').then(res => res.json());
  }
  return configPromise;
}

export async function getSupabase(): Promise<SupabaseClient> {
  if (!supabaseInstance) {
    const { url, anonKey } = await getSupabaseConfig();
    
    if (!url || !anonKey) {
      throw new Error('Failed to load Supabase configuration from server');
    }
    
    supabaseInstance = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      }
    });
  }
  
  return supabaseInstance;
}

// For backwards compatibility, export a promise-based client
export const supabase = getSupabase();
