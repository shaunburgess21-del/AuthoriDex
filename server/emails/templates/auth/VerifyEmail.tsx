/**
 * Email verification OTP.
 *
 * Sent for signup, magic link, password recovery, and email change.
 * Contains a 6-digit code the user types back into the VoxDex UI.
 *
 * Props:
 *   code — the 6 digits, unformatted (e.g. "428913")
 *   flow — adjusts heading, body, preview, and footer per auth action
 */

import * as React from "react";
import { Heading, Section, Text } from "react-email";

import { Layout } from "../components/Layout";
import { colors, radius, spacing, typography } from "../theme";

export type VerifyEmailFlow =
  | "signup"
  | "recovery"
  | "email_change"
  | "recovery_email";

interface VerifyEmailProps {
  code: string;
  flow?: VerifyEmailFlow;
}

// Preview / preheader text is intentionally long (~90+ chars) so Outlook
// for Windows desktop fills its inbox-preview slot from our content instead
// of appending a literal "<end>" marker after a short preheader.
const FLOW_COPY: Record<
  VerifyEmailFlow,
  {
    preview: (code: string) => string;
    heading: string;
    body: string;
    footerContext: string;
    ignoreLine: string;
  }
> = {
  signup: {
    preview: (code) =>
      `Your VoxDex code: ${code}. Enter it on the verification screen to finish creating your account. This code expires in 10 minutes.`,
    heading: "Verify your email",
    body: "Enter this code on VoxDex to finish signing in:",
    footerContext:
      "You're receiving this because someone tried to sign in to VoxDex with this email.",
    ignoreLine: "If you didn't try to sign in, you can ignore this email.",
  },
  recovery: {
    preview: (code) =>
      `Your VoxDex password reset code: ${code}. Enter it on the reset screen to choose a new password. This code expires in 10 minutes.`,
    heading: "Reset your password",
    body: "Enter this code on VoxDex to reset your password:",
    footerContext:
      "You're receiving this because someone requested a password reset for this VoxDex account.",
    ignoreLine:
      "If you didn't request a password reset, you can ignore this email.",
  },
  email_change: {
    preview: (code) =>
      `Confirm your new VoxDex email with code ${code}. Enter it on the confirmation screen to finish changing your address. This code expires in 10 minutes.`,
    heading: "Confirm email change",
    body: "Someone is trying to change your VoxDex email. Enter this code to confirm:",
    footerContext:
      "You're receiving this because a VoxDex email change was requested for this address.",
    ignoreLine:
      "If you didn't request this change, you can ignore this email.",
  },
  recovery_email: {
    preview: (code) =>
      `Your VoxDex recovery email code: ${code}. Enter it in Account settings to verify this address. This code expires in 10 minutes.`,
    heading: "Verify your recovery email",
    body: "Enter this code in VoxDex Account settings to verify this recovery address:",
    footerContext:
      "You're receiving this because someone added or updated a recovery email on a VoxDex account.",
    ignoreLine:
      "If you didn't request this, you can ignore this email.",
  },
};

export function VerifyEmail({ code, flow = "signup" }: VerifyEmailProps) {
  const copy = FLOW_COPY[flow];

  return (
    <Layout preview={copy.preview(code)} footerContext={copy.footerContext}>
      <Heading style={typography.h1}>{copy.heading}</Heading>

      <Text style={typography.body}>{copy.body}</Text>

      <Section style={codeBoxStyle}>
        <Text style={codeStyle}>{code}</Text>
      </Section>

      <Text style={typography.small}>This code expires in 10 minutes.</Text>

      <Text style={{ ...typography.small, marginTop: spacing.block }}>
        {copy.ignoreLine}
      </Text>
    </Layout>
  );
}

export default VerifyEmail;

const codeBoxStyle: React.CSSProperties = {
  backgroundColor: colors.bgSubtle,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  margin: `${spacing.block} 0`,
  padding: `${spacing.block} ${spacing.paragraph}`,
  textAlign: "center",
};

const codeStyle: React.CSSProperties = {
  ...typography.code,
  margin: 0,
  textAlign: "center",
  whiteSpace: "nowrap",
};
