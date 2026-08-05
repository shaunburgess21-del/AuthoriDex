import { eq, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";
import { isCardVisibleToUser, isGloballyVisible } from "@shared/geoVisibility";
import type { AuthRequest } from "../auth-middleware";
import { isStaffRole } from "../utils/authz";

export interface UserGeoContext {
  residence: string | null;
  bypass: boolean;
}

export function shouldBypassGeoFilter(req: AuthRequest): boolean {
  return isStaffRole(req.userRole);
}

type GeoCacheBag = AuthRequest & { __geoContext?: UserGeoContext };

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
 * Resolve viewer country of residence for the current request.
 * Memoised on the request object (same pattern as resolveBlendState).
 */
export async function resolveUserGeoContext(req: AuthRequest): Promise<UserGeoContext> {
  const bag = req as GeoCacheBag;
  if (bag.__geoContext) return bag.__geoContext;

  const bypass = shouldBypassGeoFilter(req);
  const userId = req.userId;
  if (!userId) {
    const ctx: UserGeoContext = { residence: null, bypass };
    bag.__geoContext = ctx;
    return ctx;
  }

  const [row] = await db
    .select({ countryOfResidence: profiles.countryOfResidence })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const residence =
    row?.countryOfResidence && typeof row.countryOfResidence === "string"
      ? row.countryOfResidence.trim().toUpperCase()
      : null;

  const ctx: UserGeoContext = { residence, bypass };
  bag.__geoContext = ctx;
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
