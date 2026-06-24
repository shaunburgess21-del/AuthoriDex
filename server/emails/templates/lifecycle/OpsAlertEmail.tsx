/**
 * Internal operations alert email.
 *
 * Sent to the admin ops recipients (Andrew + Shaun) for World Market
 * resolution reminders and the AI resolution scout. This is *not*
 * user-facing email — it's a triage notification for the operators,
 * so the layout prioritizes scannability over marketing polish.
 *
 * Channel-agnostic by design: the same OpsAlert payload that renders
 * this template also renders the plain-text body used by future
 * channels (Discord/Slack). See server/services/ops-alerts.ts.
 */

import * as React from "react";
import { Button, Heading, Section, Text } from "react-email";
import { Layout } from "../components/Layout";
import { colors, radius, spacing, typography } from "../theme";

export type OpsAlertSeverity = "info" | "warning" | "critical";

export interface OpsAlertItem {
  /** Primary line — usually the market title. */
  text: string;
  /** Secondary context, e.g. "Overdue by 2d · 45 bets · AI: YES 97%". */
  detail?: string;
  /** Deep link for this specific item. */
  url?: string;
}

export interface OpsAlertSection {
  /** Section heading, e.g. "Needs resolution". */
  heading: string;
  /** Emoji prefix shown before the heading (optional). */
  emoji?: string;
  items: OpsAlertItem[];
  /** Shown instead of items when the section is empty. */
  emptyText?: string;
}

interface OpsAlertEmailProps {
  title: string;
  severity?: OpsAlertSeverity;
  summary?: string;
  sections?: OpsAlertSection[];
  /** Primary CTA (e.g. the admin Settlement Center). */
  ctaUrl?: string;
  ctaLabel?: string;
  /** ISO timestamp rendered in the footer. */
  generatedAt?: string;
}

const SEVERITY_ACCENT: Record<OpsAlertSeverity, string> = {
  info: colors.brandBright,
  warning: colors.warning,
  critical: colors.danger,
};

export function OpsAlertEmail({
  title,
  severity = "info",
  summary,
  sections = [],
  ctaUrl,
  ctaLabel = "Open admin dashboard",
  generatedAt,
}: OpsAlertEmailProps) {
  const accent = SEVERITY_ACCENT[severity];

  return (
    <Layout
      preview={summary || title}
      footerContext="Internal VoxDex ops alert — sent to admins only."
    >
      <Section style={{ ...accentBarStyle, backgroundColor: accent }} />
      <Heading style={typography.h1}>{title}</Heading>

      {summary ? <Text style={typography.bodyMuted}>{summary}</Text> : null}

      {sections.map((section, sIdx) => (
        <Section key={`section-${sIdx}`} style={sectionStyle}>
          <Heading style={typography.h2}>
            {section.emoji ? `${section.emoji} ` : ""}
            {section.heading}
            {section.items.length > 0 ? ` (${section.items.length})` : ""}
          </Heading>

          {section.items.length === 0 ? (
            <Text style={typography.small}>
              {section.emptyText || "Nothing here right now."}
            </Text>
          ) : (
            section.items.map((item, iIdx) => (
              <Section key={`item-${sIdx}-${iIdx}`} style={itemBoxStyle}>
                <Text style={itemTextStyle}>
                  {item.url ? (
                    <a href={item.url} style={itemLinkStyle}>
                      {item.text}
                    </a>
                  ) : (
                    item.text
                  )}
                </Text>
                {item.detail ? (
                  <Text style={itemDetailStyle}>{item.detail}</Text>
                ) : null}
              </Section>
            ))
          )}
        </Section>
      ))}

      {ctaUrl ? (
        <Section style={ctaWrapStyle}>
          <Button href={ctaUrl} style={{ ...ctaButtonStyle, backgroundColor: accent }}>
            {ctaLabel}
          </Button>
        </Section>
      ) : null}

      <Section style={dividerStyle} />
      <Text style={typography.caption}>
        {generatedAt ? `Generated ${generatedAt}` : null}
      </Text>
    </Layout>
  );
}

export default OpsAlertEmail;

// ---- Styles ---------------------------------------------------------------

const accentBarStyle: React.CSSProperties = {
  borderRadius: radius.sm,
  height: "4px",
  margin: `0 0 ${spacing.block}`,
  width: "56px",
};

const sectionStyle: React.CSSProperties = {
  margin: `${spacing.block} 0 0`,
};

const itemBoxStyle: React.CSSProperties = {
  backgroundColor: colors.bgSubtle,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  margin: `0 0 ${spacing.tight}`,
  padding: `${spacing.snug} ${spacing.paragraph}`,
};

const itemTextStyle: React.CSSProperties = {
  ...typography.body,
  fontWeight: 600,
  margin: 0,
};

const itemLinkStyle: React.CSSProperties = {
  color: colors.brandBright,
  textDecoration: "none",
};

const itemDetailStyle: React.CSSProperties = {
  ...typography.small,
  margin: `${spacing.hairline} 0 0`,
};

const ctaWrapStyle: React.CSSProperties = {
  margin: `${spacing.section} 0 0`,
};

const ctaButtonStyle: React.CSSProperties = {
  borderRadius: radius.md,
  color: "#ffffff",
  display: "inline-block",
  fontFamily: typography.body.fontFamily,
  fontSize: "15px",
  fontWeight: 600,
  padding: "12px 22px",
  textDecoration: "none",
};

const dividerStyle: React.CSSProperties = {
  borderTop: `1px solid ${colors.border}`,
  margin: `${spacing.block} 0 ${spacing.snug}`,
};
