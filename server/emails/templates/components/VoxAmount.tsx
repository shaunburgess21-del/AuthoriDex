/**
 * Vox amount with raster brand mark for email (iOS Mail, Outlook, etc.).
 * Uses hosted PNG instead of U+A75E, which triggers Apple Last Resort bars.
 */

import * as React from "react";
import { Img } from "react-email";
import {
  formatVoxAmountEmail,
  voxMarkEmailUrl,
  type VoxAmountEmailVariant,
} from "@shared/currency";

/** Matches public/fonts/vox-mark-email.png (Noto U+A75E @ 14px). */
export const VOX_MARK_EMAIL_WIDTH = 11;
export const VOX_MARK_EMAIL_HEIGHT = 13;

export interface VoxAmountProps {
  baseUrl: string;
  amount: number;
  variant: VoxAmountEmailVariant;
}

const markStyle: React.CSSProperties = {
  display: "inline",
  verticalAlign: "middle",
  margin: 0,
  border: 0,
};

export function VoxAmount({ baseUrl, amount, variant }: VoxAmountProps) {
  const amountText = formatVoxAmountEmail(amount, variant);
  const openParen = variant === "parens" ? "(" : "";
  const closeParen = variant === "parens" ? ")" : "";

  return (
    <>
      {openParen}
      <Img
        src={voxMarkEmailUrl(baseUrl)}
        width={VOX_MARK_EMAIL_WIDTH}
        height={VOX_MARK_EMAIL_HEIGHT}
        alt="Vox"
        style={markStyle}
      />
      {amountText}
      {closeParen}
    </>
  );
}

export default VoxAmount;
