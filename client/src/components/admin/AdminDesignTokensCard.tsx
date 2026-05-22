import { useState } from "react";
import { Copy, Check, Palette } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BRAND_LOGO_GRADIENTS,
  BRAND_COLORS_DARK,
  BRAND_FONTS,
  BRAND_RADIUS,
  OG_CARD_SIZE,
  hslToCssVar,
  toBrandTokensCssBlock,
  toBrandTokensJson,
} from "@shared/brand-tokens";

function CopyButton({ label, getText }: { label: string; getText: () => string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} data-testid={`button-copy-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
      {label}
    </Button>
  );
}

export function AdminDesignTokensCard() {
  return (
    <Card data-testid="card-design-tokens">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-violet-500" />
          Design tokens
        </CardTitle>
        <CardDescription>
          Reference colors, fonts, and radii for Canva, Figma, or partner decks (dark theme).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <CopyButton label="Copy JSON" getText={toBrandTokensJson} />
          <CopyButton label="Copy CSS" getText={toBrandTokensCssBlock} />
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Logo gradients</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(BRAND_LOGO_GRADIENTS).map(([key, g]) => (
              <div
                key={key}
                className="flex items-center gap-3 rounded-lg border p-3"
                data-testid={`token-logo-${key}`}
              >
                <div
                  className="h-10 w-10 rounded-md shrink-0"
                  style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}
                />
                <div className="text-sm min-w-0">
                  <p className="font-medium">{g.label}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {g.from} → {g.to}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Semantic colors (dark)</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {BRAND_COLORS_DARK.map((c) => (
              <div
                key={c.name}
                className="flex items-center gap-3 rounded-lg border p-2"
                data-testid={`token-color-${c.name.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div
                  className="h-8 w-8 rounded shrink-0 border border-border/50"
                  style={{ backgroundColor: hslToCssVar(c.name, c.hsl) }}
                />
                <div className="text-xs min-w-0">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-muted-foreground font-mono">{c.hsl}</p>
                  <p className="text-muted-foreground">{c.usage}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Typography</h3>
          <ul className="space-y-2 text-sm">
            {BRAND_FONTS.map((f) => (
              <li key={f.role} className="rounded-lg border p-3" data-testid={`token-font-${f.family.toLowerCase().replace(/\s+/g, "-")}`}>
                <p className="font-medium">{f.role}</p>
                <p className="text-muted-foreground">{f.family} — weights {f.weights}</p>
                <p className="font-mono text-xs text-muted-foreground mt-1 break-all">{f.stack}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Border radius</h3>
          <div className="flex flex-wrap gap-2">
            {BRAND_RADIUS.map((r) => (
              <span
                key={r.token}
                className="text-xs rounded-md border px-2 py-1 font-mono"
                data-testid={`token-radius-${r.token.replace(/[^a-z0-9]/gi, "-")}`}
              >
                {r.token}: {r.px}
              </span>
            ))}
          </div>
        </div>

        <div className="text-sm text-muted-foreground border-t pt-4">
          Link preview cards: {OG_CARD_SIZE.width}×{OG_CARD_SIZE.height}px ({OG_CARD_SIZE.label})
        </div>
      </CardContent>
    </Card>
  );
}
