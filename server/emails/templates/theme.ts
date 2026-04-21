/**
 * VoxDex email design tokens.
 *
 * Every template imports from this file. If you want to change
 * the brand blue, the footer text color, or any spacing value
 * across all VoxDex emails, change it here — not in individual
 * templates.
 *
 * Why plain JS objects instead of CSS/Tailwind: email clients
 * don't reliably honor stylesheets or @media queries. Inline
 * styles on every element are the only way to get consistent
 * rendering across Gmail, Outlook, Apple Mail, and the rest.
 */

// ---- Colors ---------------------------------------------------------------

export const colors = {
    // Brand
    brand: "#3B82F6",        // Primary — matches app's `primary` token
    brandBright: "#3C83F6",  // Trending accent — used for emphasis/highlights
    brandDim: "#1E3A8A",     // Darker blue for subtle backgrounds
  
    // Surfaces (dark theme, matches app)
    bgPage: "#0A0E14",       // Email client body background
    bgCard: "#111827",       // Inner content container
    bgSubtle: "#1F2937",     // Inset blocks (e.g., OTP code boxes)
    border: "#1F2937",       // Hairline dividers
  
    // Text
    textPrimary: "#F9FAFB",  // Body copy
    textSecondary: "#9CA3AF", // Supporting/muted copy
    textTertiary: "#6B7280", // Footer, legal, timestamps
  
    // Semantic (for future prediction-result emails etc.)
    success: "#10B981",      // "You won" / correct prediction
    danger:  "#EF4444",      // "You lost" / incorrect prediction
    warning: "#F59E0B",      // Streak-about-to-break / jackpot-closing-soon
  } as const;
  
  // ---- Typography -----------------------------------------------------------
  
  export const fonts = {
    // System font stack — reliable across every email client.
    // Matches what Stripe, Linear, and Notion ship.
    body:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, ' +
      'Ubuntu, Cantarell, "Helvetica Neue", Arial, sans-serif',
  
    // Monospace for codes (OTP digits, transaction IDs)
    mono:
      '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, ' +
      '"Courier New", monospace',
  } as const;
  
  // ---- Spacing --------------------------------------------------------------
  
  // Named after the semantic role, not the pixel value.
  // Keeps templates readable: spacing.section > spacing.paragraph.
  export const spacing = {
    hairline: "4px",
    tight:    "8px",
    snug:     "12px",
    paragraph: "16px",
    block:    "24px",
    section:  "32px",
    page:     "48px",
  } as const;
  
  // ---- Shape / layout -------------------------------------------------------
  
  export const radius = {
    sm: "6px",
    md: "10px",
    lg: "14px",
  } as const;
  
  export const layout = {
    // 600px is the email industry standard max-width. Wider breaks on
    // mobile clients; narrower wastes desktop real estate.
    containerMaxWidth: "600px",
  } as const;
  
  // ---- Type scale -----------------------------------------------------------
  
  // Styles as ready-to-spread objects. Usage:
  //   <Text style={typography.body}>…</Text>
  export const typography = {
    h1: {
      fontFamily: fonts.body,
      fontSize: "28px",
      fontWeight: "700",
      lineHeight: "1.25",
      color: colors.textPrimary,
      margin: "0 0 16px 0",
    },
    h2: {
      fontFamily: fonts.body,
      fontSize: "20px",
      fontWeight: "600",
      lineHeight: "1.3",
      color: colors.textPrimary,
      margin: "0 0 12px 0",
    },
    body: {
      fontFamily: fonts.body,
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "1.6",
      color: colors.textPrimary,
      margin: "0 0 16px 0",
    },
    bodyMuted: {
      fontFamily: fonts.body,
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "1.6",
      color: colors.textSecondary,
      margin: "0 0 16px 0",
    },
    small: {
      fontFamily: fonts.body,
      fontSize: "14px",
      fontWeight: "400",
      lineHeight: "1.5",
      color: colors.textSecondary,
      margin: "0 0 12px 0",
    },
    caption: {
      fontFamily: fonts.body,
      fontSize: "12px",
      fontWeight: "400",
      lineHeight: "1.5",
      color: colors.textTertiary,
      margin: "0",
    },
    code: {
      fontFamily: fonts.mono,
      fontSize: "28px",
      fontWeight: "600",
      letterSpacing: "4px",
      color: colors.brandBright,
      // Prevent mid-code line breaks on narrow mobile clients.
      // Gmail Android was wrapping a 6-digit code onto two lines
      // without these. Keeping the code atomic is non-negotiable
      // for usability — a wrapped code invites mistyping.
      whiteSpace: "nowrap",
      display: "inline-block",
    },
  } as const;