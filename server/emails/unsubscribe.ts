import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_BASE_URL = "https://voxdex.com";
const TOKEN_VERSION = "v1";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

type UnsubscribeTokenPayload = {
  userId: string;
  exp: number;
  v: typeof TOKEN_VERSION;
};

function getSigningSecret(): string | null {
  const secret =
    process.env.EMAIL_UNSUBSCRIBE_SECRET ||
    process.env.APP_SECRET ||
    process.env.SESSION_SECRET;
  return secret ?? null;
}

function signPayload(payloadBase64Url: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadBase64Url).digest("base64url");
}

function encodePayload(payload: UnsubscribeTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(raw: string): UnsubscribeTokenPayload | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<UnsubscribeTokenPayload>;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.v !== TOKEN_VERSION
    ) {
      return null;
    }
    return { userId: parsed.userId, exp: parsed.exp, v: TOKEN_VERSION };
  } catch {
    return null;
  }
}

export function createUnsubscribeToken(
  userId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string | null {
  const secret = getSigningSecret();
  if (!secret) return null;
  const payload = encodePayload({
    userId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    v: TOKEN_VERSION,
  });
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { valid: true; userId: string } | { valid: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "invalid_format" };
  }

  const [payloadRaw, signatureRaw] = parts;
  if (!payloadRaw || !signatureRaw) {
    return { valid: false, reason: "invalid_format" };
  }

  const payload = decodePayload(payloadRaw);
  if (!payload) {
    return { valid: false, reason: "invalid_payload" };
  }

  const secret = getSigningSecret();
  if (!secret) {
    return { valid: false, reason: "server_misconfigured" };
  }
  const expected = signPayload(payloadRaw, secret);
  const signature = Buffer.from(signatureRaw, "utf8");
  const expectedSig = Buffer.from(expected, "utf8");
  if (signature.length !== expectedSig.length) {
    return { valid: false, reason: "invalid_signature" };
  }
  if (!timingSafeEqual(signature, expectedSig)) {
    return { valid: false, reason: "invalid_signature" };
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, userId: payload.userId };
}

export function buildUnsubscribeUrl(userId: string, baseUrl?: string): string {
  const canonicalBase = (baseUrl || process.env.PUBLIC_APP_URL || process.env.APP_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const token = createUnsubscribeToken(userId);
  if (!token) {
    return `${canonicalBase}/unsubscribe`;
  }
  return `${canonicalBase}/unsubscribe?token=${encodeURIComponent(token)}`;
}
