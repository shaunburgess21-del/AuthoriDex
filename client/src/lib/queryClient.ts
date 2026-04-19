import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getSupabase } from "./supabase";

export class ApiError extends Error {
  status: number;
  retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(`${status}: ${message}`);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let retryAfter: number | undefined;
    if (res.status === 429) {
      const ra = res.headers.get("retry-after");
      retryAfter = ra ? parseInt(ra, 10) || 60 : 60;
    }
    throw new ApiError(res.status, text, retryAfter);
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

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });
  } catch (err: any) {
    const authHeader = (headers as Record<string, string>).Authorization;
    console.error("[apiRequest] Fetch threw", {
      method,
      url,
      errorName: err?.name ?? "Unknown",
      errorMessage: err?.message ?? String(err),
      stack: err?.stack?.split("\n").slice(0, 5).join("\n"),
      hasAuthHeader: !!authHeader,
      authHeaderLength: authHeader?.length,
      timestamp: new Date().toISOString(),
    });
    throw err;
  }

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
    const authHeaders = await getAuthHeaders();
    const res = await fetch(url, {
      credentials: "include",
      headers: authHeaders,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
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
