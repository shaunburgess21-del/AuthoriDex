import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getSupabase } from "./supabase";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

const MAX_QUERY_RETRIES = 3;

/**
 * Retry transient failures (network, 5xx, 408, 429). Skip retries for typical client errors (4xx except 408/429) and 401/403/404.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (!(error instanceof Error)) return true;
  const m = error.message;
  const statusMatch = /^(\d{3}):/.exec(m);
  if (statusMatch) {
    const code = parseInt(statusMatch[1], 10);
    if (code === 401 || code === 403 || code === 404) return false;
    if (code === 408 || code === 429) return true;
    if (code >= 400 && code < 500) return false;
  }
  return true;
}

export function queryRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 10_000);
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { "Authorization": `Bearer ${session.access_token}` };
    }
  } catch (error) {
    console.warn("Failed to get auth session:", error);
  }
  return {};
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const headers: Record<string, string> = {
    ...authHeaders,
    ...(data ? { "Content-Type": "application/json" } : {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        credentials: "include",
        headers: authHeaders,
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      if (!res.ok) {
        // #region agent log
        fetch("http://127.0.0.1:7335/ingest/5a3bb67c-8953-4d89-be3b-94579791ed8e", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6435e1" },
          body: JSON.stringify({
            sessionId: "6435e1",
            hypothesisId: "H4",
            location: "queryClient.ts:getQueryFn",
            message: "non-ok response",
            data: {
              url,
              origin: typeof window !== "undefined" ? window.location.origin : "",
              status: res.status,
              statusText: res.statusText,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (err) {
      // #region agent log
      fetch("http://127.0.0.1:7335/ingest/5a3bb67c-8953-4d89-be3b-94579791ed8e", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6435e1" },
        body: JSON.stringify({
          sessionId: "6435e1",
          hypothesisId: "H1-H2-H3",
          location: "queryClient.ts:getQueryFn",
          message: "queryFn catch",
          data: {
            url,
            origin: typeof window !== "undefined" ? window.location.origin : "",
            errMsg: err instanceof Error ? err.message : String(err),
            errName: err instanceof Error ? err.name : "",
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      throw err;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes for real-time feel
      refetchOnWindowFocus: true, // Refetch when user returns to tab
      staleTime: 2 * 60 * 1000, // Data considered stale after 2 minutes
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
    },
    mutations: {
      retry: false,
    },
  },
});
