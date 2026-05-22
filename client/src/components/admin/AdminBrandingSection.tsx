import { useCallback, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type BrandAssetVariant = "default" | "vote" | "predict" | "circle";

const BRAND_ASSET_VARIANTS: Record<BrandAssetVariant, { from: string; to: string }> = {
  default: { from: "#06b6d4", to: "#2563eb" },
  vote: { from: "#22d3ee", to: "#0d9488" },
  predict: { from: "#8b5cf6", to: "#6d28d9" },
  circle: { from: "#06b6d4", to: "#2563eb" },
};

const BRAND_ASSET_PNG_SIZES = [256, 512, 1024, 2048] as const;

export function AdminBrandingSection() {
  const [brandAssetVariant, setBrandAssetVariant] = useState<BrandAssetVariant>("default");

  const buildBrandLogoSvgMarkup = useCallback((variant: BrandAssetVariant) => {
    const colors = BRAND_ASSET_VARIANTS[variant];
    const defs = `<defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.from}"/>
      <stop offset="100%" stop-color="${colors.to}"/>
    </linearGradient>
  </defs>`;
    if (variant === "circle") {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${defs}
  <circle cx="256" cy="256" r="256" fill="url(#bg-gradient)"/>
  <g transform="translate(6, 6) scale(5.0)">
    <path d="M50 12L82 40L50 58L18 40L50 12Z" fill="white" opacity="0.95"/>
    <path d="M50 58L82 40L82 62L50 80L18 62L18 40L50 58Z" fill="white" opacity="0.6"/>
    <rect x="22" y="82" width="56" height="6" rx="3" fill="white" opacity="0.85"/>
  </g>
</svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${defs}
  <rect width="512" height="512" rx="64" fill="url(#bg-gradient)"/>
  <g transform="translate(25.6, 25.6) scale(4.608)">
    <path d="M50 12L82 40L50 58L18 40L50 12Z" fill="white" opacity="0.95"/>
    <path d="M50 58L82 40L82 62L50 80L18 62L18 40L50 58Z" fill="white" opacity="0.6"/>
    <rect x="22" y="82" width="56" height="6" rx="3" fill="white" opacity="0.85"/>
  </g>
</svg>`;
  }, []);

  const getBrandAssetFilenameBase = useCallback((variant: BrandAssetVariant) => {
    if (variant === "default") return "voxdex-logo";
    if (variant === "circle") return "voxdex-favicon";
    return `voxdex-logo-${variant}`;
  }, []);

  const downloadBrandLogoSvg = useCallback(() => {
    const svgMarkup = buildBrandLogoSvgMarkup(brandAssetVariant);
    const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const svgObjectUrl = URL.createObjectURL(svgBlob);
    const link = document.createElement("a");
    link.href = svgObjectUrl;
    link.download = `${getBrandAssetFilenameBase(brandAssetVariant)}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(svgObjectUrl);
  }, [brandAssetVariant, buildBrandLogoSvgMarkup, getBrandAssetFilenameBase]);

  const downloadBrandLogoPng = useCallback(
    (size: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        toast.error("PNG export unavailable in this browser");
        return;
      }

      const svgMarkup = buildBrandLogoSvgMarkup(brandAssetVariant);
      const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
      const svgObjectUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = `${getBrandAssetFilenameBase(brandAssetVariant)}-${size}px.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(svgObjectUrl);
      };
      img.onerror = () => {
        toast.error("Failed to render logo for PNG download");
        URL.revokeObjectURL(svgObjectUrl);
      };
      img.src = svgObjectUrl;
    },
    [brandAssetVariant, buildBrandLogoSvgMarkup, getBrandAssetFilenameBase],
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Branding & Marketing</h2>
        <p className="text-muted-foreground">Logo downloads and brand resources</p>
      </div>

      <Card data-testid="card-brand-assets">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-cyan-500" />
            Brand Assets
          </CardTitle>
          <CardDescription>
            Download the current VoxDex logo in vector or high-resolution PNG formats.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Choose logo variant</p>
            <Select
              value={brandAssetVariant}
              onValueChange={(value) => setBrandAssetVariant(value as BrandAssetVariant)}
            >
              <SelectTrigger className="w-full sm:w-[260px]" data-testid="select-brand-asset-variant">
                <SelectValue placeholder="Select logo variant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default (Blue)</SelectItem>
                <SelectItem value="vote">Vote (Cyan)</SelectItem>
                <SelectItem value="predict">Predict (Purple)</SelectItem>
                <SelectItem value="circle">Circle (Favicon)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={downloadBrandLogoSvg} data-testid="button-download-logo-svg">
              <Download className="h-4 w-4 mr-2" />
              Download SVG
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open("/logo-download.html", "_blank", "noopener,noreferrer")}
              data-testid="button-open-logo-download-page"
              disabled={brandAssetVariant !== "default"}
              title={
                brandAssetVariant === "default"
                  ? "Open full default logo download page"
                  : "This page currently serves the default blue logo"
              }
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Default Download Page
            </Button>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-2">PNG quick downloads</p>
            <div className="flex flex-wrap gap-2">
              {BRAND_ASSET_PNG_SIZES.map((size) => (
                <Button
                  key={size}
                  variant="secondary"
                  onClick={() => downloadBrandLogoPng(size)}
                  data-testid={`button-download-logo-png-${size}`}
                >
                  <Download className="h-4 w-4 mr-2" />
                  PNG {size}px
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
