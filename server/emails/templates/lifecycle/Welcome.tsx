/**
 * Welcome email.
 *
 * Sent after a user verifies their email and their VoxDex account
 * is provisioned. First full-voice email the user receives — sets
 * the tone for the product and nudges them into the core loop
 * (predictions + votes).
 *
 * Voice: trend-first. VoxDex is a live trend index, not a fame
 * ranker. Framing: "people and events shaping the world" covers
 * both the celebrity leaderboard and the world-events markets.
 *
 * Props:
 *   firstName — optional; personalises the greeting if known.
 *               Falls back to a generic "You're in." greeting.
 *   baseUrl   — app base URL for CTA links. Defaults to
 *               https://voxdex.com for prod-safe defaults; caller
 *               should pass the per-env URL when actually sending.
 */

import * as React from "react";
import { Heading, Section, Text } from "react-email";
import { Layout } from "../components/Layout";
import { colors, radius, spacing, typography } from "../theme";

interface WelcomeEmailProps {
  firstName?: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://voxdex.com";

export const WELCOME_SUBJECT = "Welcome to VoxDex — you've got 10,000 credits";

export function WelcomeEmail({
  firstName,
  baseUrl = DEFAULT_BASE_URL,
}: WelcomeEmailProps) {
  const greeting = firstName ? `You're in, ${firstName}.` : "You're in.";

  return (
    <Layout
      preview="You're in. 10,000 credits are waiting — go back your first prediction."
      footerContext="You're receiving this because you just created a VoxDex account."
    >
      <Heading style={typography.h1}>{greeting}</Heading>

      <Text style={typography.body}>
        VoxDex is a live trend index for the people and events shaping
        the world — powered by real-time signals, public votes, and
        prediction markets.
      </Text>

      {/* Credits callout — mirrors the VerifyEmail codeBox pattern
          so users get a visual anchor on the 10,000 number. */}
      <Section style={creditsBoxStyle}>
        <Text style={creditsLabelStyle}>Your starting balance</Text>
        <Text style={creditsAmountStyle}>10,000 credits</Text>
        <Text style={{ ...typography.small, margin: 0 }}>
          Use them to make predictions, enter weekly markets, and
          build your track record.
        </Text>
      </Section>

      {/* Primary CTA. Plain <a> styled as a button — most reliable
          render path across Gmail / Outlook / Apple Mail. */}
      <Section style={ctaContainerStyle}>
        <a href={`${baseUrl}/predict`} style={ctaButtonStyle}>
          Place your first prediction
        </a>
      </Section>

      <Section style={dividerStyle} />

      {/* Secondary actions — optional paths for users who aren't
          ready to bet on turn one. */}
      <Text style={{ ...typography.small, fontWeight: 600, margin: `0 0 ${spacing.paragraph}` }}>
        Or start here:
      </Text>

      <Text style={{ ...typography.small, margin: `0 0 ${spacing.snug}` }}>
        <a href={`${baseUrl}/leaderboard`} style={linkStyle}>
          Browse the leaderboard
        </a>
        {" — see who's moving right now"}
      </Text>
      <Text style={{ ...typography.small, margin: `0 0 ${spacing.snug}` }}>
        <a href={`${baseUrl}/predict?tab=world`} style={linkStyle}>
          Check World Markets
        </a>
        {" — predict real-world outcomes"}
      </Text>
      <Text style={{ ...typography.small, margin: `0 0 ${spacing.snug}` }}>
        <a href={`${baseUrl}/vote`} style={linkStyle}>
          Cast your first votes
        </a>
        {" — have your say on the questions people are debating"}
      </Text>

      <Section style={dividerStyle} />

      {/* Founder sign-off. Intentionally personal — reinforces the
          "built by two people" positioning early. */}
      <Text style={{ ...typography.body, margin: 0 }}>
        See you inside,
      </Text>
      <Text style={{ ...typography.body, margin: 0 }}>
        — Andrew &amp; Shaun
      </Text>
      <Text style={{ ...typography.caption, marginTop: spacing.tight }}>
        Co-founders, VoxDex
      </Text>
    </Layout>
  );
}

export default WelcomeEmail;

// ---- Styles ---------------------------------------------------------------

const creditsBoxStyle: React.CSSProperties = {
  backgroundColor: colors.bgSubtle,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  margin: `${spacing.block} 0`,
  padding: `${spacing.block} ${spacing.paragraph}`,
};

const creditsLabelStyle: React.CSSProperties = {
  ...typography.caption,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  margin: `0 0 ${spacing.tight}`,
};

const creditsAmountStyle: React.CSSProperties = {
  ...typography.h1,
  margin: `0 0 ${spacing.snug}`,
};

const ctaContainerStyle: React.CSSProperties = {
  margin: `${spacing.block} 0`,
  textAlign: "center",
};

const ctaButtonStyle: React.CSSProperties = {
  backgroundColor: colors.brand,
  borderRadius: radius.md,
  color: "#ffffff",
  display: "inline-block",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, ' +
    'Ubuntu, Cantarell, "Helvetica Neue", Arial, sans-serif',
  fontSize: "16px",
  fontWeight: 600,
  padding: "14px 28px",
  textDecoration: "none",
};

const dividerStyle: React.CSSProperties = {
  borderTop: `1px solid ${colors.border}`,
  margin: `${spacing.block} 0`,
};

const linkStyle: React.CSSProperties = {
  color: colors.brand,
  fontWeight: 600,
  textDecoration: "none",
};