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

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** Content-ID referenced by Layout header <Img src="cid:…">. */
export const VOXDEX_LOGO_CID = "voxdex-logo";

/** Img src for the header logo — paired with voxDexLogoInlineAttachment(). */
export const VOXDEX_LOGO_EMAIL_SRC = `cid:${VOXDEX_LOGO_CID}`;

const logoPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/voxdex-logo-email.png",
);

let cachedLogoBase64: string | undefined;

function getLogoBase64(): string {
  if (!cachedLogoBase64) {
    cachedLogoBase64 = readFileSync(logoPath).toString("base64");
  }
  return cachedLogoBase64;
}

/** Resend inline attachment for the VoxDex header logo. */
export function voxDexLogoInlineAttachment() {
  return {
    filename: "voxdex-logo-email.png",
    content: getLogoBase64(),
    contentId: VOXDEX_LOGO_CID,
  };
}
