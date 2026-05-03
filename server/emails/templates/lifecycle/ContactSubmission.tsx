/**
 * Internal contact-form notification email.
 *
 * Sent to team@voxdex.com whenever someone submits the public
 * /contact form. This is *not* user-facing email — it's a triage
 * notification for the team inbox, so the layout prioritizes
 * scannability over marketing polish.
 *
 * The send pipeline sets `replyTo` to the visitor's address, so
 * hitting Reply in the team inbox replies straight to them.
 */

import * as React from "react";
import { Heading, Section, Text } from "react-email";
import { Layout } from "../components/Layout";
import { colors, radius, spacing, typography } from "../theme";
import { CONTACT_TOPIC_LABELS, type ContactTopic } from "@shared/contact";

interface ContactSubmissionEmailProps {
  topic: ContactTopic;
  subject: string;
  message: string;
  fromEmail: string;
  fromName?: string;
  /** Best-effort context to help triage abuse / spam. */
  ipAddress?: string;
  userAgent?: string;
  /** Authenticated submitter's user id, if logged in. */
  userId?: string;
  /** ISO timestamp of submission, mainly for the rendered footer. */
  submittedAt?: string;
}

export function contactSubmissionSubject(
  topic: ContactTopic,
  subject: string,
): string {
  return `[Contact: ${CONTACT_TOPIC_LABELS[topic]}] ${subject}`;
}

export function ContactSubmissionEmail({
  topic,
  subject,
  message,
  fromEmail,
  fromName,
  ipAddress,
  userAgent,
  userId,
  submittedAt,
}: ContactSubmissionEmailProps) {
  const topicLabel = CONTACT_TOPIC_LABELS[topic];
  const displayName = fromName?.trim() || "(not provided)";

  return (
    <Layout
      preview={`New ${topicLabel.toLowerCase()} submission from ${fromEmail}`}
      footerContext="Internal notification — not sent to the visitor."
    >
      <Heading style={typography.h1}>New contact submission</Heading>

      <Text style={typography.bodyMuted}>
        Reply to this email to respond directly to the visitor.
      </Text>

      <Section style={metaBoxStyle}>
        <MetaRow label="Topic" value={topicLabel} />
        <MetaRow label="Subject" value={subject} />
        <MetaRow label="From" value={displayName} />
        <MetaRow label="Email" value={fromEmail} />
        {userId ? <MetaRow label="User ID" value={userId} /> : null}
      </Section>

      <Heading style={typography.h2}>Message</Heading>
      <Section style={messageBoxStyle}>
        {/* Preserve user-entered line breaks without enabling raw HTML. */}
        <Text style={messageTextStyle}>{message}</Text>
      </Section>

      <Section style={dividerStyle} />

      <Text style={typography.caption}>
        {submittedAt ? `Submitted ${submittedAt}` : null}
        {ipAddress ? ` · IP ${ipAddress}` : null}
      </Text>
      {userAgent ? (
        <Text style={typography.caption}>UA: {userAgent}</Text>
      ) : null}
    </Layout>
  );
}

export default ContactSubmissionEmail;

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <Text style={metaRowStyle}>
      <span style={metaLabelStyle}>{label}: </span>
      <span style={metaValueStyle}>{value}</span>
    </Text>
  );
}

// ---- Styles ---------------------------------------------------------------

const metaBoxStyle: React.CSSProperties = {
  backgroundColor: colors.bgSubtle,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  margin: `${spacing.block} 0`,
  padding: `${spacing.paragraph} ${spacing.block}`,
};

const metaRowStyle: React.CSSProperties = {
  ...typography.small,
  color: colors.textPrimary,
  margin: `0 0 ${spacing.tight}`,
};

const metaLabelStyle: React.CSSProperties = {
  color: colors.textSecondary,
  fontWeight: 600,
};

const metaValueStyle: React.CSSProperties = {
  color: colors.textPrimary,
};

const messageBoxStyle: React.CSSProperties = {
  backgroundColor: colors.bgSubtle,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  margin: `${spacing.snug} 0 ${spacing.block}`,
  padding: `${spacing.paragraph} ${spacing.block}`,
};

const messageTextStyle: React.CSSProperties = {
  ...typography.body,
  margin: 0,
  // Honors the user's newlines without rendering raw HTML.
  whiteSpace: "pre-wrap",
};

const dividerStyle: React.CSSProperties = {
  borderTop: `1px solid ${colors.border}`,
  margin: `${spacing.block} 0`,
};
