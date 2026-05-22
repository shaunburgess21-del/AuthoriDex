/**
 * Curated VoxDex brand reference for admin / external design tools.
 * Values mirror production theme — update when index.css or logo variants change.
 */

export type BrandLogoVariant = "default" | "vote" | "predict" | "circle";

export const BRAND_LOGO_GRADIENTS: Record<
  BrandLogoVariant,
  { label: string; from: string; to: string }
> = {
  default: { label: "Default (Blue)", from: "#06b6d4", to: "#2563eb" },
  vote: { label: "Vote (Cyan)", from: "#22d3ee", to: "#0d9488" },
  predict: { label: "Predict (Purple)", from: "#8b5cf6", to: "#6d28d9" },
  circle: { label: "Circle (Favicon)", from: "#06b6d4", to: "#2563eb" },
};

export interface ColorToken {
  name: string;
  hsl: string;
  usage: string;
}

/** Dark theme semantic colors (primary marketing surface). */
export const BRAND_COLORS_DARK: ColorToken[] = [
  { name: "Background", hsl: "220 20% 8%", usage: "Page background" },
  { name: "Foreground", hsl: "220 10% 98%", usage: "Primary text" },
  { name: "Primary", hsl: "217 91% 60%", usage: "Buttons, links, accents" },
  { name: "Card", hsl: "220 18% 12%", usage: "Cards, panels" },
  { name: "Muted foreground", hsl: "220 8% 65%", usage: "Secondary text" },
  { name: "Trend up", hsl: "142 76% 45%", usage: "Positive / up outcomes" },
  { name: "Trend down", hsl: "0 72% 51%", usage: "Negative / down outcomes" },
  { name: "Destructive", hsl: "0 72% 51%", usage: "Errors, bans" },
  { name: "Chart 1", hsl: "142 76% 36%", usage: "Charts" },
  { name: "Chart 2", hsl: "217 91% 50%", usage: "Charts" },
  { name: "Chart 3", hsl: "271 81% 56%", usage: "Charts / predict accent" },
];

export const BRAND_FONTS = [
  {
    role: "UI / body",
    family: "Inter",
    stack: "'VoxGlyph', 'Inter', system-ui, sans-serif",
    weights: "400, 500, 600, 700",
  },
  {
    role: "Display / headings",
    family: "Space Grotesk",
    stack: "'VoxGlyph', 'Space Grotesk', sans-serif",
    weights: "500, 600, 700",
  },
  {
    role: "Numbers / mono",
    family: "JetBrains Mono",
    stack: "'VoxGlyph', 'JetBrains Mono', monospace",
    weights: "400, 500, 600, 700",
  },
] as const;

export const BRAND_RADIUS = [
  { token: "--radius", value: "0.5rem", px: "8px", usage: "Base radius" },
  { token: "rounded-sm", value: "0.1875rem", px: "3px", usage: "Tailwind sm" },
  { token: "rounded-md", value: "0.375rem", px: "6px", usage: "Tailwind md" },
  { token: "rounded-lg", value: "0.5625rem", px: "9px", usage: "Tailwind lg" },
] as const;

export const OG_CARD_SIZE = { width: 1200, height: 630, label: "Link preview (Open Graph)" };

export function hslToCssVar(name: string, hsl: string): string {
  return `hsl(${hsl})`;
}

export function toBrandTokensJson(): string {
  return JSON.stringify(
    {
      logoGradients: BRAND_LOGO_GRADIENTS,
      colorsDark: BRAND_COLORS_DARK.map((c) => ({
        name: c.name,
        hsl: c.hsl,
        css: hslToCssVar(c.name, c.hsl),
      })),
      fonts: BRAND_FONTS,
      radius: BRAND_RADIUS,
      ogCard: OG_CARD_SIZE,
    },
    null,
    2,
  );
}

export function toBrandTokensCssBlock(): string {
  const lines = [
    "/* VoxDex brand tokens (dark theme) */",
    ...BRAND_COLORS_DARK.map((c) => `/* ${c.name}: ${c.usage} */`),
    ...BRAND_COLORS_DARK.map((c) => `--brand-${c.name.toLowerCase().replace(/\s+/g, "-")}: ${c.hsl};`),
    "",
    "/* Logo gradients */",
    ...Object.entries(BRAND_LOGO_GRADIENTS).map(
      ([k, v]) => `--logo-${k}-from: ${v.from}; --logo-${k}-to: ${v.to};`,
    ),
    "",
    "/* Fonts (load Inter, Space Grotesk, JetBrains Mono from Google Fonts) */",
    ...BRAND_FONTS.map((f) => `/* ${f.role}: ${f.family} */`),
  ];
  return lines.join("\n");
}
