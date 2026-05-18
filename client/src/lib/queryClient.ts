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

/**
 * Parse the structured error envelope our API returns (e.g. 409s for the
 * no-hedging rule). `apiRequest` stringifies the response body into the
 * thrown error's message as `"<status>: <body>"`. This helper extracts a
 * `{ title, description }` pair we can hand straight to a toast — falling
 * back to the raw message for callers that haven't been migrated.
 *
 * Usage:
 *   onError: (err) => {
 *     const { title, description } = parseApiError(err, "Failed to place prediction");
 *     toast.error(title, { description });
 *   }
 */
/**
 * Map a server-side error code (e.g. `slippage_exceeded`) to a
 * user-facing title. Keeps toast copy friendly without leaking the
 * raw enum string into the UI. Codes that aren't in the map fall
 * back to the verbatim code (preserves the previous behaviour for
 * any error we haven't bothered to humanise yet).
 */
function humaniseErrorCode(code: string): string {
  const map: Record<string, string> = {
    slippage_exceeded: "Price moved against you",
    insufficient_credits: "Not enough credits",
    insufficient_shares: "Not enough shares",
    trade_too_small: "Trade too small",
    market_closed: "Market is closed",
    self_trade_denied: "Can't trade on your own market",
  };
  return map[code] ?? code;
}

export function parseApiError(
  err: unknown,
  fallbackTitle: string,
): { title: string; description?: string; status?: number } {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/^(\d{3}): (.+)$/s);
  if (m) {
    const status = parseInt(m[1], 10);
    try {
      const body = JSON.parse(m[2]);
      if (body && typeof body === "object" && body.error) {
        const rawCode = String(body.error);
        // Slippage gets a richer description so the user knows what
        // to do next ("try a smaller stake or relax tolerance"). The
        // server already builds that copy in result.message.
        const description = body.message
          ? String(body.message)
          : body.detail
            ? String(body.detail)
            : undefined;
        return {
          title: humaniseErrorCode(rawCode),
          description,
          status,
        };
      }
    } catch {
      // Body wasn't JSON — fall through to the fallback below.
    }
    return { title: fallbackTitle, description: m[2], status };
  }
  return { title: fallbackTitle, description: msg };
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

/**
 * Optional extra controls for `apiRequest`.
 *
 * `idempotencyKey`: forwarded as the `Idempotency-Key` HTTP header so
 * the server can short-circuit duplicate POSTs (per the IETF httpapi
 * draft). Currently honoured by the AMM trade routes — see
 * `server/services/amm-trades.ts`. Callers should generate the key
 * once per user intent (e.g. when a trade modal opens) so a retry
 * within the same intent reuses the key, while a fresh intent gets a
 * new one.
 */
export interface ApiRequestOptions {
  idempotencyKey?: string;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: ApiRequestOptions,
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const headers: Record<string, string> = {
    ...authHeaders,
    ...(data ? { "Content-Type": "application/json" } : {}),
    ...(options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : {}),
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
