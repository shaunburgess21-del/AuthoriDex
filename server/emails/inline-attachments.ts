/**
 * Inline MIME attachments for branded email images.
 *
 * Gmail (web + Android) strips data: URI images from HTML. Outlook
 * desktop often allows them — hence the split the team saw in testing.
 * CID attachments travel with the message and render in both clients.
 *
 * Layout.tsx references VOXDEX_LOGO_EMAIL_SRC; send.ts must attach
 * voxDexLogoInlineAttachment() on every branded send.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** Content-ID referenced by Layout header <Img src="cid:…">. */
export const VOXDEX_LOGO_CID = "voxdex-logo";

/** Img src for the header logo — paired with voxDexLogoInlineAttachment(). */
export const VOXDEX_LOGO_EMAIL_SRC = `cid:${VOXDEX_LOGO_CID}`;

const LOGO_FILENAME = "voxdex-logo-email.png";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Search order mirrors server/services/og-fonts.ts — bundled dist vs dev. */
const LOGO_SEARCH_PATHS = [
  path.join(process.cwd(), "dist", "email-assets", LOGO_FILENAME),
  path.join(process.cwd(), "dist", "public", LOGO_FILENAME),
  path.join(process.cwd(), "public", LOGO_FILENAME),
  path.resolve(__dirname, "../../public", LOGO_FILENAME),
];

let cachedLogoBase64: string | undefined;

function resolveLogoPath(): string {
  for (const candidate of LOGO_SEARCH_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `[emails] Logo not found (${LOGO_FILENAME}). Checked: ${LOGO_SEARCH_PATHS.join(", ")}`,
  );
}

function getLogoBase64(): string {
  if (!cachedLogoBase64) {
    cachedLogoBase64 = readFileSync(resolveLogoPath()).toString("base64");
  }
  return cachedLogoBase64;
}

/** Resend inline attachment for the VoxDex header logo. */
export function voxDexLogoInlineAttachment() {
  return {
    filename: LOGO_FILENAME,
    content: getLogoBase64(),
    contentId: VOXDEX_LOGO_CID,
  };
}
