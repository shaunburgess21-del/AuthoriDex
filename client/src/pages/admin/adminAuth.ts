import { getSupabase } from "@/lib/supabase";

/**
 * Shared auth helpers for admin-only UI that needs to make authenticated
 * fetch() calls (distinct from the apiRequest queryClient helper, because
 * some admin flows need raw Response objects back — e.g. file uploads,
 * streaming responses, or endpoints that return non-JSON bodies).
 */

export async function getAuthHeaders(): Promise<HeadersInit> {
  const client = await getSupabase();
  const { data: { session } } = await client.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${session.access_token}`,
  };
}

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = await getAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
    credentials: "include",
  });
}
