import crypto from "crypto";

/**
 * Share-click credit decision for POST /api/share/track-click.
 *
 * The route resolves a profile id from either a referral code (new
 * links) or a legacy `sharerUserId` (links already in the wild), then
 * this function runs the same referer, dedup, insert, and
 * `adjustCredits("share_click")` path as before. Credit amount and
 * the daily cap stay inside `adjustCredits` / `credit_actions`.
 */

/**
 * Hosts that count as internal for share-click attribution.
 * Stays in lockstep with INTERNAL_REFERRER_HOSTS in routes.ts.
 * Adding a host here without adding it there lets the click land
 * and still shows that domain in the admin top-domains aggregator.
 */
const INTERNAL_HOSTS = [
  "voxdex.com",
  "www.voxdex.com",
  "staging.voxdex.com",
  "dev.voxdex.com",
  "localhost",
  "127.0.0.1",
];

const MAX_SURFACE_LEN = 50;
const MAX_SHARE_URL_LEN = 2048;
const REFERRAL_CODE_PATTERN = /^VX[A-Z0-9]{6}$/;

export interface TrackShareClickBody {
  sharerUserId?: unknown;
  referralCode?: unknown;
  surface?: unknown;
  shareUrl?: unknown;
}

export interface TrackShareClickInput {
  body: TrackShareClickBody;
  referer: string | null;
  /** Already passed through the IPv6-safe client key. Hashed for dedup. */
  ipKey: string;
  /** Set when the request carried a resolved Bearer user. */
  callerUserId: string | null;
  now?: Date;
}

export interface ShareClickInsert {
  sharerUserId: string;
  shareSurface: string;
  shareUrl: string;
  externalReferrer: string | null;
  ipHash: string;
  credited: false;
  creditIdempotencyKey: string;
}

export interface ShareClickCreditMetadata {
  surface: string;
  shareUrl: string;
  shareClickId: number | undefined;
}

export interface TrackShareClickDeps {
  findProfileById(id: string): Promise<{ id: string } | null>;
  findProfileByReferralCode(code: string): Promise<{ id: string } | null>;
  findExistingToday(sharerUserId: string, ipHash: string, utcStart: Date): Promise<boolean>;
  countToday(sharerUserId: string, utcStart: Date): Promise<number>;
  insertClick(row: ShareClickInsert): Promise<{ id: number } | "duplicate">;
  markCredited(id: number): Promise<void>;
  adjustCredits(
    userId: string,
    actionKey: string,
    idempotencyKey: string,
    metadata: ShareClickCreditMetadata,
  ): Promise<{ awarded: boolean; amount: number }>;
  awardShareMaster(userId: string): Promise<void>;
}

export type TrackShareClickResult =
  | { status: 400; body: { error: string } }
  | { status: 200; body: { credited: boolean; creditsAwarded: number } };

function isExternalReferrer(referer: string | null | undefined): boolean {
  if (typeof referer !== "string" || referer.length === 0) return false;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  const isInternal = INTERNAL_HOSTS.some(
    (internal) => host === internal || host.endsWith(`.${internal}`),
  );
  return !isInternal;
}

function hashIp(rawIp: string): string {
  return crypto.createHash("sha256").update(rawIp).digest("hex");
}

function utcDateString(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

function readToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve the sharer, then record and maybe credit the click.
 * Returns the HTTP status and JSON body the route should send.
 * Unexpected dependency failures propagate to the route's 500 handler.
 */
export async function trackShareClick(
  input: TrackShareClickInput,
  deps: TrackShareClickDeps,
): Promise<TrackShareClickResult> {
  const referralRaw = readToken(input.body.referralCode);
  const legacyRaw = readToken(input.body.sharerUserId);
  const { surface, shareUrl } = input.body;

  if (
    (!referralRaw && !legacyRaw) ||
    typeof surface !== "string" ||
    !surface ||
    typeof shareUrl !== "string" ||
    !shareUrl
  ) {
    return { status: 400, body: { error: "Missing required fields" } };
  }

  if (surface.length > MAX_SURFACE_LEN) {
    return { status: 400, body: { error: "surface_too_long" } };
  }
  if (shareUrl.length > MAX_SHARE_URL_LEN) {
    return { status: 400, body: { error: "share_url_too_long" } };
  }

  // Prefer the referral code when the new client sends one. A code
  // that doesn't match a profile is a silent no-op, same as an
  // unknown legacy user id — the link can outlive the account, and
  // the response shape stays useless for enumeration.
  let sharerUserId: string;
  if (referralRaw) {
    const normalised = referralRaw.toUpperCase();
    if (!REFERRAL_CODE_PATTERN.test(normalised)) {
      return { status: 200, body: { credited: false, creditsAwarded: 0 } };
    }
    const sharer = await deps.findProfileByReferralCode(normalised);
    if (!sharer) {
      return { status: 200, body: { credited: false, creditsAwarded: 0 } };
    }
    sharerUserId = sharer.id;
  } else {
    const sharer = await deps.findProfileById(legacyRaw);
    if (!sharer) {
      return { status: 200, body: { credited: false, creditsAwarded: 0 } };
    }
    sharerUserId = sharer.id;
  }

  // Authenticated viewer clicking their own link does not earn
  // share_click credits. No analytics row, so the dedup slot and
  // the daily cap stay available for a real external click.
  if (input.callerUserId && input.callerUserId === sharerUserId) {
    return { status: 200, body: { credited: false, creditsAwarded: 0 } };
  }

  const refererHeader = input.referer;
  const creditEligible = isExternalReferrer(refererHeader);

  const ipHash = hashIp(input.ipKey);
  const now = input.now ?? new Date();
  const utcToday = utcDateString(now);
  const utcStart = new Date(`${utcToday}T00:00:00.000Z`);

  const existingToday = await deps.findExistingToday(sharerUserId, ipHash, utcStart);
  if (existingToday) {
    return { status: 200, body: { credited: false, creditsAwarded: 0 } };
  }

  const priorCount = await deps.countToday(sharerUserId, utcStart);
  const slotIndex = Number(priorCount) + 1;
  const idempotencyKey = `share_click_${sharerUserId}_${utcToday}_${slotIndex}`;

  const inserted = await deps.insertClick({
    sharerUserId,
    shareSurface: surface,
    shareUrl,
    externalReferrer: refererHeader,
    ipHash,
    credited: false,
    creditIdempotencyKey: idempotencyKey,
  });
  if (inserted === "duplicate") {
    return { status: 200, body: { credited: false, creditsAwarded: 0 } };
  }

  let creditsAwarded = 0;
  let credited = false;
  if (creditEligible) {
    try {
      const result = await deps.adjustCredits(sharerUserId, "share_click", idempotencyKey, {
        surface,
        shareUrl,
        shareClickId: inserted.id,
      });
      if (result.awarded) {
        creditsAwarded = result.amount;
        credited = true;
        await deps.markCredited(inserted.id);
        try {
          await deps.awardShareMaster(sharerUserId);
        } catch (badgeErr) {
          console.warn("[share-track-click] share_master badge check failed", badgeErr);
        }
      }
    } catch (err) {
      console.error("[share-track-click] credit award failed", err);
    }
  }

  return { status: 200, body: { credited, creditsAwarded } };
}
