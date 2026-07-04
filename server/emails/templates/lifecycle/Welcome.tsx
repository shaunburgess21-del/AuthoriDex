/**
 * Welcome email.
 *
 * Sent after a user verifies their email and their VoxDex account
 * is provisioned. First full-voice email the user receives — sets
 * the tone for the product and nudges them into the core loop
 * (predictions + votes).
 *
 * Voice: trend-first. VoxDex is a global trend index, not a fame
 * ranker. Framing: "people and events shaping the world" covers
 * both the celebrity leaderboard and the world-events markets.
 *
 * No personal greeting. Polymarket's onboarding emails open with
 * the brand line ("Welcome to Polymarket") and skip "Hi <name>" —
 * because it (a) avoids awkward fallbacks when only the email is
 * known and (b) reads as transactional rather than marketing,
 * which helps Gmail Primary placement.
 *
 * Props:
 *   baseUrl       — app base URL for CTA links. Defaults to
 *                   https://voxdex.com for prod-safe defaults;
 *                   caller should pass the per-env URL when actually
 *                   sending.
 *   creditAmount  — actual starting Vox grant for this user. Defaults
 *                   to DEFAULT_CREDIT_AMOUNT for previews; senders MUST
 *                   pass the real value so the email matches the user's
 *                   on-screen balance. Keeping this dynamic also future-
 *                   proofs the template against grant-amount changes
 *                   (no template edit needed if we bump the grant
 *                   later). Internal `credit*` naming kept on the prop
 *                   to avoid a churn rename of every caller; user-
 *                   facing copy renders as "Vox".
 */

import * as React from "react";
import { Button, Heading, Section, Text } from "react-email";
import { Layout } from "../components/Layout";
import { CURRENCY } from "@shared/currency";
import { colors, radius, spacing, typography } from "../theme";

interface WelcomeEmailProps {
  baseUrl?: string;
  creditAmount?: number;
  unsubscribeUrl?: string;
}

const DEFAULT_BASE_URL = "https://voxdex.com";

// Used only as a fallback in previews / dev. Real sends pass the
// user's actual `predictCredits` (Vox) balance from the DB.
const DEFAULT_CREDIT_AMOUNT = 10000;

const formatCredits = (n: number) => n.toLocaleString("en-US");

/**
 * Build the subject line. Currently a fixed string — we used to
 * include the Vox amount ("...you've got 10,000 Vox") but
 * Gmail's tab classifier read the dollar-style number + reward
 * framing as marketing and routed first-touch sends to Promotions.
 * Stripping the number to plain "Welcome to VoxDex" is the first
 * deliverability lever we're testing toward Primary placement.
 *
 * Kept as a function (not a constant) so callers can keep passing
 * `creditAmount` without churn; the arg is intentionally ignored.
 */
export function welcomeSubject(_creditAmount?: number): string {
  return "Welcome to VoxDex";
}

/** Back-compat constant for any caller that already imports this. */
export const WELCOME_SUBJECT = welcomeSubject();

export function WelcomeEmail({
  baseUrl = DEFAULT_BASE_URL,
  creditAmount = DEFAULT_CREDIT_AMOUNT,
  unsubscribeUrl,
}: WelcomeEmailProps) {
  // Word form ("10,000 Vox") in the callout — reads better than
  // "Ꝟ10,000" in a sentence-shaped headline and avoids any glyph-
  // rendering risk in clients that haven't been QA'd yet. The
  // symbol still appears in supporting body copy below for brand
  // reinforcement.
  const voxLabel = `${formatCredits(creditAmount)} ${CURRENCY.name}`;

  // Long, descriptive preheader so Outlook for Windows desktop fills its
  // inbox preview from our copy instead of appending a literal "<end>".
  const preview = `Your VoxDex account is ready with ${voxLabel} to spend. Virtual play currency for predictions on the people and events shaping the world.`;

  return (
    <Layout
      preview={preview}
      footerContext="You're receiving this because you just created a VoxDex account."
      baseUrl={baseUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={typography.h1}>Welcome to VoxDex.</Heading>

      <Text style={typography.body}>
        VoxDex turns the voice of the people into a living, real-time index — a
        cultural barometer the world shapes by itself, one vote at a time.
      </Text>

      {/* Vox callout — mirrors the VerifyEmail codeBox pattern so
          users get a visual anchor on the balance. Word form here;
          the supporting line below introduces the Ꝟ symbol so the
          glyph gets a first appearance with context. */}
      <Section style={creditsBoxStyle}>
        <Text style={creditsLabelStyle}>Your starting balance</Text>
        <Text style={creditsAmountStyle}>{voxLabel}</Text>
        <Text style={{ ...typography.small, margin: 0 }}>
          {CURRENCY.name} is VoxDex's in-app virtual play currency — not real
          money. Spend your {CURRENCY.symbol}
          {formatCredits(creditAmount)} on predictions, weekly markets, and
          building your track record.
        </Text>
      </Section>

      {/* Primary CTA. Uses react-email's Button which renders a
          table-wrapped, bulletproof button across Outlook / Gmail /
          Apple Mail — preserves padding + background colour where
          a raw <a> would collapse to a styled-text link. */}
      <Section style={ctaContainerStyle}>
        <Button href={`${baseUrl}/predict`} style={ctaButtonStyle}>
          Place your first prediction
        </Button>
      </Section>

      <Section style={dividerStyle} />

      {/* Secondary actions — optional paths for users who aren't
          ready to bet on turn one. */}
      <Text style={{ ...typography.small, fontWeight: 600, margin: `0 0 ${spacing.paragraph}` }}>
        Or start here:
      </Text>

      <Text style={{ ...typography.small, margin: `0 0 ${spacing.snug}` }}>
        <a href={`${baseUrl}/`} style={linkStyle}>
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

      {/* Sign-off. Currently using the collective "VoxDex Team" voice
          while we test reception during early onboarding rounds; the
          previous variant was a personal "Andrew & Shaun, Co-founders"
          founder sign-off and may return based on test feedback. */}
      <Text style={{ ...typography.body, margin: 0 }}>
        See you inside,
      </Text>
      <Text style={{ ...typography.body, margin: 0 }}>
        — The VoxDex Team
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