import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { isTransportFailure, transportFailureDescription } from "./networkStatus";
import { queryRetryDelay, shouldRetryQuery } from "./queryRetry";
import { getSupabase } from "./supabase";
import { authSessionBlockActive, hasPersistedAuthSession } from "./authSession";

export { queryRetryDelay, shouldRetryQuery };

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
  if (isTransportFailure(err)) {
    return { title: fallbackTitle, description: transportFailureDescription() };
  }
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/^(\d{3}): (.+)$/s);
  if (m) {
    const status = parseInt(m[1], 10);
    try {
      const body = JSON.parse(m[2]);
      if (body && typeof body === "object" && body.error) {
        const rawCode = String(body.error);
        // Slippage (and other coded errors) surface body.message as the
        // toast description; title comes from humaniseErrorCode above.
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

export async function getAuthHeaders(): Promise<Record<string, string>> {
  // Once logout starts, refetches must not send the token a refresh just rotated.
  if (authSessionBlockActive()) return {};
  if (!hasPersistedAuthSession()) return {};
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
  async ({ queryKey, signal }) => {
    const url = queryKey.join("/") as string;
    const authHeaders = await getAuthHeaders();
    const res = await fetch(url, {
      credentials: "include",
      headers: authHeaders,
      signal,
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
      refetchOnWindowFocus: true, // Refetch when user returns to tab
      refetchIntervalInBackground: false, // Opt-in polling pauses on hidden tabs
      staleTime: 2 * 60 * 1000, // Data considered stale after 2 minutes
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
    },
    mutations: {
      retry: false,
    },
  },
});
