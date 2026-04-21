/**
 * Email verification OTP.
 *
 * Sent when a user signs up or signs in with email and needs to
 * prove they own the address. Contains a 6-digit code they type
 * back into the VoxDex UI.
 *
 * Deliberately code-only — no magic link. Keeps the email
 * independent of domain configuration and gives mobile users
 * iOS/Android's auto-fill-from-notifications experience.
 *
 * Props:
 *   code — the 6 digits, unformatted (e.g. "428913"). We'll
 *          format with a middle space for readability.
 */

import * as React from "react";
import { Heading, Section, Text } from "react-email";

import { Layout } from "../components/Layout";
import { colors, radius, spacing, typography } from "../theme";

interface VerifyEmailProps {
  code: string;
}

export function VerifyEmail({ code }: VerifyEmailProps) {
// Format "428913" -> "428 913" for readability.
  // Uses a regular space (not non-breaking); whiteSpace:nowrap on
  // the code style below prevents line breaks at the space.
  // If an unexpected length comes in, fall back to the raw value
  // so the email is never broken by upstream bugs.
  const formattedCode =
    code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

  return (
    <Layout
      preview={`Your VoxDex code: ${formattedCode}`}
      footerContext="You're receiving this because someone tried to sign in to VoxDex with this email."
    >
      <Heading style={typography.h1}>Verify your email</Heading>

      <Text style={typography.body}>
        Enter this code on VoxDex to finish signing in:
      </Text>

      <Section style={codeBoxStyle}>
        <Text style={codeStyle}>{formattedCode}</Text>
      </Section>

      <Text style={typography.small}>
        This code expires in 10 minutes.
      </Text>

      <Text style={{ ...typography.small, marginTop: spacing.block }}>
        If you didn't try to sign in, you can ignore this email.
      </Text>
    </Layout>
  );
}

export default VerifyEmail;

// ---- Styles ---------------------------------------------------------------

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
    // Belt-and-braces: even if typography.code's whiteSpace is
    // overridden somewhere, enforce it here too. Mobile clients
    // must NEVER wrap a verification code.
    whiteSpace: "nowrap",
  };