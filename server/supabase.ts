import { createClient } from '@supabase/supabase-js';

const isProduction = process.env.NODE_ENV === "production";
const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('Missing Supabase environment variable: SUPABASE_URL');
}

if (!serviceRoleKey && isProduction) {
  throw new Error('Missing Supabase environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

if (!serviceRoleKey && !anonKey) {
  throw new Error('Missing Supabase environment variables: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');
}

if (!serviceRoleKey) {
  console.warn('[Supabase] SUPABASE_SERVICE_ROLE_KEY is not set. Falling back to anon key outside production; admin/storage operations may fail.');
}

const supabaseKey = serviceRoleKey || anonKey!;

export const hasSupabaseServiceRole = Boolean(serviceRoleKey);

export const supabaseServer = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
