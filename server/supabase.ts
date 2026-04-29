import { createClient } from '@supabase/supabase-js';

const isProduction = process.env.NODE_ENV === "production";
const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('Missing Supabase environment variable: SUPABASE_URL');
}

if (!serviceRoleKey && isProduction) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is required in production. Backend will not function correctly without it because RLS will block all anon-key queries.',
  );
}

if (!serviceRoleKey && !anonKey) {
  throw new Error('Missing Supabase environment variables: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');
}

if (!serviceRoleKey) {
  console.error(
    '[Supabase] SUPABASE_SERVICE_ROLE_KEY is not set in non-production. Falling back to SUPABASE_ANON_KEY. With RLS enabled, backend table queries may return empty results or fail authorization. Set SUPABASE_SERVICE_ROLE_KEY to mirror production behavior.',
  );
}

const supabaseKey = serviceRoleKey ?? anonKey!;

export const hasSupabaseServiceRole = Boolean(serviceRoleKey);

export const supabaseServer = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
