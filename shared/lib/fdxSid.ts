/**
 * Anonymous voter id shared by the httpOnly `fdx_sid` cookie and, on the
 * native WebView only, the `X-Fdx-Sid` request/response header.
 *
 * Strict UUID (version nibble 1–8, RFC variant) so a client-supplied
 * header cannot carry header-injection characters or an arbitrary string.
 * `crypto.randomUUID()` output matches this.
 */
export const FDX_SID_HEADER = "X-Fdx-Sid";

const FDX_SID_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Lowercase UUID, or `""` when `value` is not a strict UUID. */
export function normalizeFdxSid(value: string | null | undefined): string {
  if (!value) return "";
  const sid = value.trim().toLowerCase();
  return FDX_SID_UUID.test(sid) ? sid : "";
}
