import crypto from "crypto";

/**
 * Share-click credit decision for POST /api/share/track-click.
 *
 * The route resolves a profile id from either a referral code (new
 * links) or a legacy `sharerUserId` (links already in the wild), then
 * this function runs the referrer, dedup, insert, and
 * `adjustCredits("share_click")` path. Credit amount and the daily
 * cap stay inside `adjustCredits` / `credit_actions`.
 *
 * The referrer (body field, else the Referer header) is advisory.
 * A caller can put any string in the body, and the header is spoofable
 * too. It only decides whether this particular click is eligible.
 * The daily cap and the (sharer, ip hash, UTC day) dedup are the
 * controls that limit payouts.
 */

/**
 * Hosts that count as internal for share-click attribution.
 * Kept as its own list so a click from the product itself does not
 * pay. Adding a host here is a product decision, not a header tweak.
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
const MAX_REFERRER_LEN = 2048;
const REFERRAL_CODE_PATTERN = /^VX[A-Z0-9]{6}$/;

/**
 * Legacy `sharerUserId` links stop earning after this instant.
 * A request at exactly this time still resolves the id. One
 * millisecond later the field is accepted so old links do not 400,
 * but the response is the same credited:false shape as an unknown
 * code, with no profile lookup.
 */
export const LEGACY_SHARER_USER_ID_SUNSET_ISO = "2026-12-23T00:00:00.000Z";
const LEGACY_SHARER_USER_ID_SUNSET_MS = Date.parse(LEGACY_SHARER_USER_ID_SUNSET_ISO);

/** Request budget per resolved sharer. Stops share_clicks insert storms. */
export const SHARER_CLICK_LIMIT_PER_HOUR = 30;
export const SHARER_CLICK_WINDOW_MS = 60 * 60 * 1000;

export interface TrackShareClickBody {
  sharerUserId?: unknown;
  referralCode?: unknown;
  surface?: unknown;
  shareUrl?: unknown;
  /** document.referrer captured on the landing page. Advisory. */
  referrer?: unknown;
}

export interface TrackShareClickInput {
  body: TrackShareClickBody;
  /** Referer header. Used only when the body referrer is absent. */
  referer: string | null;
  /** req.ip passed through the IPv6-safe client key. Hashed for dedup. */
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

export type ShareClickPath = "legacy" | "code";

export type ShareClickOutcome =
  | "credited"
  | "internal"
  | "dedup"
  | "cap"
  | "self"
  | "unknown"
  | "sunset"
  | "limited";

export interface ShareClickDecision {
  path: ShareClickPath;
  sharerId: string | null;
  ipHash: string;
  referrerHost: string | null;
  outcome: ShareClickOutcome;
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
  ): Promise<{ awarded: boolean; amount: number; reason?: string }>;
  awardShareMaster(userId: string): Promise<void>;
  log?: (decision: ShareClickDecision) => void;
}

export type TrackShareClickResult =
  | { status: 400; body: { error: string } }
  | { status: 200; body: { credited: boolean; creditsAwarded: number } };

interface SharerBucket {
  count: number;
  resetAt: number;
}

const sharerBuckets = new Map<string, SharerBucket>();

/** Test isolation. The production limiter is per process, like the IP limiter. */
export function resetSharerClickLimiterForTests(): void {
  sharerBuckets.clear();
}

function allowSharerRequest(sharerId: string, nowMs: number): boolean {
  if (sharerBuckets.size > 4096) {
    for (const [key, bucket] of sharerBuckets) {
      if (nowMs >= bucket.resetAt) sharerBuckets.delete(key);
    }
  }
  const existing = sharerBuckets.get(sharerId);
  if (!existing || nowMs >= existing.resetAt) {
    sharerBuckets.set(sharerId, { count: 1, resetAt: nowMs + SHARER_CLICK_WINDOW_MS });
    return true;
  }
  if (existing.count >= SHARER_CLICK_LIMIT_PER_HOUR) return false;
  existing.count += 1;
  return true;
}

function isExternalReferrer(referer: string | null | undefined): boolean {
  return referrerHost(referer) !== null && !isInternalHost(referrerHost(referer)!);
}

function isInternalHost(host: string): boolean {
  return INTERNAL_HOSTS.some(
    (internal) => host === internal || host.endsWith(`.${internal}`),
  );
}

function referrerHost(referer: string | null | undefined): string | null {
  if (typeof referer !== "string" || referer.length === 0) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Body referrer wins when the client sent one short enough to store.
 * Otherwise the Referer header. Either way it is advisory — see the
 * file comment.
 */
function advisoryReferrer(bodyValue: unknown, header: string | null): string | null {
  if (typeof bodyValue === "string") {
    const trimmed = bodyValue.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_REFERRER_LEN) return trimmed;
  }
  if (typeof header === "string") {
    const trimmed = header.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_REFERRER_LEN) return trimmed;
  }
  return null;
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

function emit(deps: TrackShareClickDeps, decision: ShareClickDecision): void {
  if (deps.log) {
    deps.log(decision);
    return;
  }
  console.info(JSON.stringify({ source: "share-track-click", ...decision }));
}

function decline(
  deps: TrackShareClickDeps,
  decision: ShareClickDecision,
): TrackShareClickResult {
  emit(deps, decision);
  return { status: 200, body: { credited: false, creditsAwarded: 0 } };
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

  const path: ShareClickPath = referralRaw ? "code" : "legacy";
  const now = input.now ?? new Date();
  const ipHash = hashIp(input.ipKey || "unknown");
  const referrer = advisoryReferrer(input.body.referrer, input.referer);
  const host = referrerHost(referrer);

  const base = { path, ipHash, referrerHost: host };

  // Prefer the referral code when the new client sends one. A code
  // that doesn't match a profile is a silent no-op, same as an
  // unknown legacy user id — the link can outlive the account, and
  // the response shape stays useless for enumeration.
  let sharerUserId: string;
  if (referralRaw) {
    const normalised = referralRaw.toUpperCase();
    if (!REFERRAL_CODE_PATTERN.test(normalised)) {
      return decline(deps, { ...base, sharerId: null, outcome: "unknown" });
    }
    const sharer = await deps.findProfileByReferralCode(normalised);
    if (!sharer) {
      return decline(deps, { ...base, sharerId: null, outcome: "unknown" });
    }
    sharerUserId = sharer.id;
  } else if (now.getTime() > LEGACY_SHARER_USER_ID_SUNSET_MS) {
    // Accept the field, do not look the id up, do not say why.
    return decline(deps, { ...base, sharerId: null, outcome: "sunset" });
  } else {
    const sharer = await deps.findProfileById(legacyRaw);
    if (!sharer) {
      return decline(deps, { ...base, sharerId: null, outcome: "unknown" });
    }
    sharerUserId = sharer.id;
  }

  // Authenticated viewer clicking their own link does not earn
  // share_click credits. No analytics row, so the dedup slot and
  // the daily cap stay available for a real external click.
  if (input.callerUserId && input.callerUserId === sharerUserId) {
    return decline(deps, { ...base, sharerId: sharerUserId, outcome: "self" });
  }

  const utcToday = utcDateString(now);
  const utcStart = new Date(`${utcToday}T00:00:00.000Z`);

  const existingToday = await deps.findExistingToday(sharerUserId, ipHash, utcStart);
  if (existingToday) {
    return decline(deps, { ...base, sharerId: sharerUserId, outcome: "dedup" });
  }

  // After dedup so a refresh does not burn the insert budget, and
  // before insert so a burst cannot bloat share_clicks. Same 200
  // shape as every other non-credit so the response is not a probe.
  if (!allowSharerRequest(sharerUserId, now.getTime())) {
    return decline(deps, { ...base, sharerId: sharerUserId, outcome: "limited" });
  }

  const priorCount = await deps.countToday(sharerUserId, utcStart);
  const slotIndex = Number(priorCount) + 1;
  const idempotencyKey = `share_click_${sharerUserId}_${utcToday}_${slotIndex}`;

  const inserted = await deps.insertClick({
    sharerUserId,
    shareSurface: surface,
    shareUrl,
    externalReferrer: referrer,
    ipHash,
    credited: false,
    creditIdempotencyKey: idempotencyKey,
  });
  if (inserted === "duplicate") {
    return decline(deps, { ...base, sharerId: sharerUserId, outcome: "dedup" });
  }

  // Missing, malformed, and internal referrers still record the click.
  // They do not move money. See the file comment.
  if (!isExternalReferrer(referrer)) {
    emit(deps, { ...base, sharerId: sharerUserId, outcome: "internal" });
    return { status: 200, body: { credited: false, creditsAwarded: 0 } };
  }

  let creditsAwarded = 0;
  let credited = false;
  let outcome: ShareClickOutcome = "cap";
  try {
    const result = await deps.adjustCredits(sharerUserId, "share_click", idempotencyKey, {
      surface,
      shareUrl,
      shareClickId: inserted.id,
    });
    if (result.awarded) {
      creditsAwarded = result.amount;
      credited = true;
      outcome = "credited";
      await deps.markCredited(inserted.id);
      try {
        await deps.awardShareMaster(sharerUserId);
      } catch (badgeErr) {
        console.warn("[share-track-click] share_master badge check failed", badgeErr);
      }
    } else if (result.reason === "duplicate") {
      outcome = "dedup";
    }
  } catch (err) {
    console.error("[share-track-click] credit award failed", err);
    outcome = "cap";
  }

  emit(deps, { ...base, sharerId: sharerUserId, outcome });
  return { status: 200, body: { credited, creditsAwarded } };
}
