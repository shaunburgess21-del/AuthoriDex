/**
 * Insights Digest — weekly Friday recap (Phase 3).
 * Pulls headline from Today's Story + top Discover cuts.
 */

import * as React from "react";
import { Button, Heading, Section, Text } from "react-email";
import { Layout } from "../components/Layout";

export interface InsightsDigestEmailProps {
  headline: string;
  body: string;
  baseUrl?: string;
  unsubscribeUrl?: string;
}

const DEFAULT_BASE_URL = "https://voxdex.com";

export function insightsDigestSubject(headline: string): string {
  return headline.slice(0, 80) || "Your VoxDex Insights digest";
}

export function InsightsDigestEmail({
  headline,
  body,
  baseUrl = DEFAULT_BASE_URL,
  unsubscribeUrl,
}: InsightsDigestEmailProps) {
  return (
    <Layout preview={headline} unsubscribeUrl={unsubscribeUrl}>
      <Heading style={{ fontSize: 22, fontWeight: 700 }}>{headline}</Heading>
      <Text style={{ fontSize: 15, lineHeight: "24px", color: "#444" }}>{body}</Text>
      <Section style={{ marginTop: 24 }}>
        <Button
          href={`${baseUrl}/insights`}
          style={{
            backgroundColor: "#2563eb",
            color: "#fff",
            padding: "12px 24px",
            borderRadius: 8,
            fontWeight: 600,
          }}
        >
          Open Insights
        </Button>
      </Section>
    </Layout>
  );
}

export default InsightsDigestEmail;
