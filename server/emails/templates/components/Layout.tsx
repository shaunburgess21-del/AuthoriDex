/**
 * VoxDex email layout shell.
 *
 * Wraps every VoxDex email with a consistent HTML document,
 * branded header (logo + VoxDex wordmark), and footer (unsubscribe +
 * address). Individual templates drop their body content in
 * as children.
 *
 * Usage:
 *   <Layout preview="Short inbox preview text">
 *     <Heading style={typography.h1}>Welcome to VoxDex</Heading>
 *     <Text style={typography.body}>…body copy…</Text>
 *   </Layout>
 */

import * as React from "react";
import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";

import {
  VOXDEX_LOGO_EMAIL_DISPLAY_PX,
} from "@shared/currency";
import { VOXDEX_LOGO_EMAIL_SRC } from "../../inline-attachments";
import {
  colors,
  fonts,
  layout,
  radius,
  spacing,
  typography,
} from "../theme";

interface LayoutProps {
  /**
   * Inbox preview text. Shown next to the subject line in Gmail,
   * Apple Mail, etc. Keep it under ~90 characters. This is a
   * marketing surface — craft it deliberately.
   */
  preview: string;

  /**
   * Optional footer context line. Defaults to a generic
   * "You're receiving this because you have a VoxDex account."
   * Override for specific flows (e.g. "...because you opted in
   * to the Weekly Wrap.")
   */
  footerContext?: string;
  baseUrl?: string;
  unsubscribeUrl?: string;

  children: React.ReactNode;
}

export function Layout({
  preview,
  footerContext = "You're receiving this because you have a VoxDex account.",
  baseUrl = "https://voxdex.com",
  unsubscribeUrl,
  children,
}: LayoutProps) {
  const canonicalBaseUrl = baseUrl.replace(/\/+$/, "");

  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="dark light" />
        <meta name="supported-color-schemes" content="dark light" />
      </Head>

      <Preview>{preview}</Preview>

      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* ---- Header: logo + VoxDex wordmark ---- */}
          <Section style={headerStyle}>
            <Row>
              <Column style={logoColumnStyle}>
                <Link href={canonicalBaseUrl} style={logoLinkStyle}>
                  <Img
                    src={VOXDEX_LOGO_EMAIL_SRC}
                    width={VOXDEX_LOGO_EMAIL_DISPLAY_PX}
                    height={VOXDEX_LOGO_EMAIL_DISPLAY_PX}
                    alt=""
                    style={logoImgStyle}
                  />
                </Link>
              </Column>
              <Column style={wordmarkColumnStyle}>
                <Text style={wordmarkStyle}>VoxDex</Text>
              </Column>
            </Row>
          </Section>

          {/* ---- Main content (from child template) ---- */}
          <Section style={contentStyle}>{children}</Section>

          {/* ---- Footer ---- */}
          <Section style={footerStyle}>
            <Text style={footerContextStyle}>{footerContext}</Text>

            <Text style={footerLinksStyle}>
              <Link href={canonicalBaseUrl} style={footerLinkStyle}>
                voxdex.com
              </Link>
              {unsubscribeUrl ? (
                <>
                  {"  ·  "}
                  <Link href={unsubscribeUrl} style={footerLinkStyle}>
                    Unsubscribe
                  </Link>
                </>
              ) : null}
            </Text>

            {/* Mailing address line removed pre-launch — required by
                CAN-SPAM in the US for marketing sends but optional for
                pure transactional flows. We'll add it back here when
                we have the registered VoxDex business address ready;
                until then we don't want the placeholder text leaking
                into real sends. */}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default Layout;

// ---- Styles ---------------------------------------------------------------
// Kept at the bottom so the JSX above reads cleanly.

const bodyStyle: React.CSSProperties = {
  backgroundColor: colors.bgPage,
  fontFamily: fonts.body,
  margin: 0,
  padding: 0,
  width: "100%",
};

const containerStyle: React.CSSProperties = {
  backgroundColor: colors.bgCard,
  borderRadius: radius.lg,
  margin: "0 auto",
  maxWidth: layout.containerMaxWidth,
  padding: spacing.page,
  width: "100%",
};

const headerStyle: React.CSSProperties = {
  paddingBottom: spacing.section,
  borderBottom: `1px solid ${colors.border}`,
  marginBottom: spacing.section,
};

const logoColumnStyle: React.CSSProperties = {
  width: `${VOXDEX_LOGO_EMAIL_DISPLAY_PX + 8}px`,
  verticalAlign: "middle",
};

const logoLinkStyle: React.CSSProperties = {
  textDecoration: "none",
};

const logoImgStyle: React.CSSProperties = {
  border: 0,
  display: "block",
  margin: 0,
};

const wordmarkColumnStyle: React.CSSProperties = {
  verticalAlign: "middle",
};

const wordmarkStyle: React.CSSProperties = {
  color: colors.brandBright,
  fontFamily: fonts.body,
  fontSize: "24px",
  fontWeight: "700",
  letterSpacing: "-0.5px",
  margin: 0,
};

const contentStyle: React.CSSProperties = {
  paddingBottom: spacing.section,
};

const footerStyle: React.CSSProperties = {
  borderTop: `1px solid ${colors.border}`,
  paddingTop: spacing.block,
  marginTop: spacing.section,
};

const footerContextStyle: React.CSSProperties = {
  ...typography.small,
  color: colors.textTertiary,
  margin: `0 0 ${spacing.snug} 0`,
};

const footerLinksStyle: React.CSSProperties = {
  ...typography.small,
  color: colors.textTertiary,
  margin: `0 0 ${spacing.snug} 0`,
};

const footerLinkStyle: React.CSSProperties = {
  color: colors.textSecondary,
  textDecoration: "underline",
};