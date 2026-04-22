/**
 * VoxDex Welcome email.
 *
 * Sent after a user verifies their email and completes initial
 * onboarding. First non-auth email they receive - this is where
 * the brand voice gets to breathe. Short, confident, one clear
 * primary action (place a prediction) with three low-visual-weight
 * secondary options for users not ready to bet yet.
 *
 * Voice: fame-coded, not influence-coded. VoxDex is a live index
 * of the people the world is watching right now, and a market
 * where you predict who's next.
 *
 * Design:
 *   - Greeting headline
 *   - Fame-voice lead paragraph
 *   - Bordered credits callout (the visual flourish)
 *   - Primary CTA button -> /predict
 *   - hr
 *   - Three secondary text links with em-dash descriptions
 *   - hr
 *   - Founder sign-off (Andrew & Shaun)
 *
 * Props:
 *   firstName - optional. If present, greeting is personalised.
 *   baseUrl   - optional. Defaults to voxdex.com; callers can
 *               override for staging/dev environments.
 */

import * as React from "react";
import { Button, Heading, Hr, Link, Section, Text } from "react-email";

import { Layout } from "../components/Layout";
import { colors, radius, spacing, typography } from "../theme";

export interface WelcomeEmailProps {
  firstName?: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://voxdex.com";

export const WELCOME_SUBJECT =
  "Welcome to VoxDex - you've got 10,000 credits";

export function WelcomeEmail({
  firstName,
  baseUrl = DEFAULT_BASE_URL,
}: WelcomeEmailProps) {
  const greeting = firstName
    ? `Welcome, ${firstName}.`
    : "Welcome to VoxDex.";

  return (
    <Layout
      preview="You're in. 10,000 credits are waiting - go back your first prediction."
      footerContext="You're receiving this because you just signed up for VoxDex."
    >
      <Heading style={typography.h1}>{greeting}</Heading>

      <Text style={typography.body}>
        VoxDex is a live index of global fame - real-time rankings of the
        people the world can't stop talking about. Now you get to predict
        who's next.
      </Text>

      {/* Credits callout - the one visual flourish */}
      <Section style={creditsBoxStyle}>
        <Text style={creditsLabelStyle}>Your starting balance</Text>
        <Text style={creditsAmountStyle}>10,000 credits</Text>
        <Text style={creditsSubtextStyle}>
          Stake them on predictions across any market. Earn more by voting
          and climbing the XP ranks.
        </Text>
      </Section>

      {/* Primary CTA */}
      <Section style={ctaContainerStyle}>
        <Button href={`${baseUrl}/predict`} style={ctaButtonStyle}>
          Place your first prediction
        </Button>
      </Section>

      <Hr style={hrStyle} />

      {/* Secondary actions */}
      <Text style={secondaryHeadingStyle}>Or start here:</Text>

      <Text style={linkItemStyle}>
        <Link href={`${baseUrl}/`} style={linkStyle}>
          Browse the leaderboard
        </Link>
        {" - see who's trending right now"}
      </Text>

      <Text style={linkItemStyle}>
        <Link href={`${baseUrl}/predict`} style={linkStyle}>
          Check today's World Markets
        </Link>
        {" - predict real-world outcomes"}
      </Text>

      <Text style={linkItemStyle}>
        <Link href={`${baseUrl}/vote`} style={linkStyle}>
          Cast your first votes
        </Link>
        {" - weigh in on culture, politics, and everything in between"}
      </Text>

      <Hr style={{ ...hrStyle, marginTop: spacing.block }} />

      {/* Sign-off */}
      <Text style={signoffStyle}>- Andrew &amp; Shaun</Text>
      <Text style={signoffSubStyle}>Co-founders, VoxDex</Text>
    </Layout>
  );
}

export default WelcomeEmail;

// ---- Styles ---------------------------------------------------------------

const creditsBoxStyle: React.CSSProperties = {
  backgroundColor: colors.bgSubtle,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: `${spacing.block} ${spacing.block}`,
  margin: `${spacing.block} 0 ${spacing.section} 0`,
};

const creditsLabelStyle: React.CSSProperties = {
  color: colors.textTertiary,
  fontSize: "12px",
  fontWeight: "600",
  letterSpacing: "1.2px",
  textTransform: "uppercase",
  margin: "0 0 4px 0",
};

const creditsAmountStyle: React.CSSProperties = {
  color: colors.brandBright,
  fontSize: "32px",
  fontWeight: "700",
  lineHeight: "1.2",
  margin: "0 0 8px 0",
};

const creditsSubtextStyle: React.CSSProperties = {
  color: colors.textSecondary,
  fontSize: "14px",
  lineHeight: "1.5",
  margin: 0,
};

const ctaContainerStyle: React.CSSProperties = {
  margin: `0 0 ${spacing.section} 0`,
  textAlign: "center",
};

const ctaButtonStyle: React.CSSProperties = {
  backgroundColor: colors.brand,
  color: "#FFFFFF",
  fontSize: "16px",
  fontWeight: "600",
  padding: "16px 32px",
  borderRadius: radius.md,
  textDecoration: "none",
  display: "inline-block",
};

const hrStyle: React.CSSProperties = {
  borderColor: colors.border,
  borderStyle: "solid",
  borderWidth: "0 0 1px 0",
  margin: `0 0 ${spacing.block} 0`,
};

const secondaryHeadingStyle: React.CSSProperties = {
  ...typography.small,
  color: colors.textSecondary,
  fontWeight: "600",
  margin: `0 0 ${spacing.snug} 0`,
};

const linkItemStyle: React.CSSProperties = {
  color: colors.textSecondary,
  fontSize: "15px",
  lineHeight: "1.6",
  margin: `0 0 ${spacing.snug} 0`,
};

const linkStyle: React.CSSProperties = {
  color: colors.brandBright,
  textDecoration: "none",
  fontWeight: "600",
};

const signoffStyle: React.CSSProperties = {
  ...typography.body,
  margin: "0 0 2px 0",
};

const signoffSubStyle: React.CSSProperties = {
  ...typography.small,
  color: colors.textTertiary,
  margin: 0,
};
