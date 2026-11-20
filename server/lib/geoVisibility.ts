import { eq, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";
import { isCardVisibleToUser, isGloballyVisible } from "@shared/geoVisibility";
import {
  normalizeStoredResidence,
  pickViewerCountry,
  readIpCountry,
} from "@shared/viewerCountry";
import type { AuthRequest } from "../auth-middleware";
import { isStaffRole } from "../utils/authz";

export interface UserGeoContext {
  residence: string | null;
  bypass: boolean;
}

/**
 * Vote cards (matchups, sentiment polls, opinion polls) pass this so an
 * anonymous viewer, or a signed-in user with no residence, is filtered by
 * the request IP country. Prediction markets stay residence-only.
 */
export const VOTE_CARD_GEO = { ipFallback: true } as const;

export function shouldBypassGeoFilter(req: AuthRequest): boolean {
  return isStaffRole(req.userRole);
}

type GeoCacheBag = AuthRequest & {
  __geoContext?: UserGeoContext;
  __geoContextIp?: UserGeoContext;
};

export class GeoNotEligibleError extends Error {
  readonly code = "geo_not_eligible" as const;
  constructor() {
    super("geo_not_eligible");
    this.name = "GeoNotEligibleError";
  }
}

export class GeoNotFoundError extends Error {
  readonly code = "geo_not_found" as const;
  constructor() {
    super("geo_not_found");
    this.name = "GeoNotFoundError";
  }
}

/**
 * Resolve the viewer's country for the current request.
 * Memoised on the request object (same pattern as resolveBlendState).
 *
 * Residence is the signed-in `countryOfResidence` when it is set. With
 * `ipFallback`, an anonymous viewer or an account with no residence uses
 * the hosting geo header instead. Staff bypass is unchanged: callers skip
 * the filter when `bypass` is true.
 */
export async function resolveUserGeoContext(
  req: AuthRequest,
  options?: { ipFallback?: boolean },
): Promise<UserGeoContext> {
  const bag = req as GeoCacheBag;
  const ipFallback = options?.ipFallback === true;
  const cached = ipFallback ? bag.__geoContextIp : bag.__geoContext;
  if (cached) return cached;

  const bypass = shouldBypassGeoFilter(req);
  let residence: string | null = null;
  const userId = req.userId;
  if (userId) {
    const [row] = await db
      .select({ countryOfResidence: profiles.countryOfResidence })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    residence = normalizeStoredResidence(row?.countryOfResidence);
  }

  if (ipFallback) {
    residence = pickViewerCountry(residence, readIpCountry(req.headers));
  }

  const ctx: UserGeoContext = { residence, bypass };
  if (ipFallback) bag.__geoContextIp = ctx;
  else bag.__geoContext = ctx;
  return ctx;
}

/**
 * SQL WHERE fragment: card is global OR user's residence is in the allowlist.
 * When residence is null, only global (empty allowlist) cards match.
 */
export function geoVisibilitySql(
  countriesCol: AnyColumn | SQL,
  residence: string | null,
): SQL {
  if (residence) {
    return sql`(
      cardinality(${countriesCol}) = 0
      OR ${countriesCol} @> ARRAY[${residence}]::text[]
    )`;
  }
  return sql`cardinality(${countriesCol}) = 0`;
}

export function assertCardVisibleForRead(
  visibleCountries: string[] | null | undefined,
  residence: string | null,
): void {
  if (!isCardVisibleToUser(visibleCountries, residence)) {
    throw new GeoNotFoundError();
  }
}

export function assertCardVisibleForAction(
  visibleCountries: string[] | null | undefined,
  residence: string | null,
): void {
  if (!isCardVisibleToUser(visibleCountries, residence)) {
    throw new GeoNotEligibleError();
  }
}

/**
 * Geo guard for the by-id market routes (`/api/markets/:id*`), which are
 * reached by UUID rather than slug and therefore can't rely on the
 * `geoVisibilitySql` filter applied to the `/api/open-markets` list.
 *
 * Returns true when the caller must NOT see this market. Callers choose the
 * response themselves: 404 on reads (don't confirm the market exists), 403
 * `geo_not_eligible` on trades (parity with `/api/open-markets/:slug/bet`).
 *
 * Short-circuits before `resolveUserGeoContext` for globally-visible cards so
 * the overwhelmingly common case costs nothing — important on hot read paths
 * like price-history and recent-trades.
 */
export async function isMarketGeoHidden(
  req: AuthRequest,
  visibleCountries: string[] | null | undefined,
): Promise<boolean> {
  if (isGloballyVisible(visibleCountries)) return false;
  const geo = await resolveUserGeoContext(req);
  if (geo.bypass) return false;
  return !isCardVisibleToUser(visibleCountries, geo.residence);
}
