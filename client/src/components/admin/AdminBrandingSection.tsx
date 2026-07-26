import { useEffect, useState } from "react";
import { Download, Link2, Megaphone, Palette, Share2, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminAvatarLabCard } from "@/components/admin/AdminAvatarLabCard";
import { AdminBrandAssetsCard } from "@/components/admin/AdminBrandAssetsCard";
import { AdminDesignTokensCard } from "@/components/admin/AdminDesignTokensCard";
import { AdminOgPreviewCard } from "@/components/admin/AdminOgPreviewCard";
import { AdminSiteBannerCard } from "@/components/admin/AdminSiteBannerCard";
import { AdminSocialTemplatesCard } from "@/components/admin/AdminSocialTemplatesCard";

export type BrandingSubTab = "assets" | "tokens" | "og" | "banner" | "social" | "avatars";

const TAB_ORDER: BrandingSubTab[] = [
  "assets",
  "tokens",
  "og",
  "banner",
  "social",
  "avatars",
];

export function AdminBrandingSection() {
  const [subTab, setSubTab] = useState<BrandingSubTab>(() => {
    const stored = sessionStorage.getItem("admin_branding_tab");
    if (stored && (TAB_ORDER as readonly string[]).includes(stored)) {
      return stored as BrandingSubTab;
    }
    return "assets";
  });

  useEffect(() => {
    sessionStorage.setItem("admin_branding_tab", subTab);
  }, [subTab]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Branding & Marketing</h2>
        <p className="text-muted-foreground">
          Logo downloads, design reference, link previews, site banner, social PNGs, and
          avatar design review
        </p>
      </div>

      <Tabs
        value={subTab}
        onValueChange={(v) => setSubTab(v as BrandingSubTab)}
        className="w-full"
      >
        <div className="-mx-1 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="inline-flex w-max">
            <TabsTrigger value="assets" data-testid="tab-branding-assets">
              <Download className="h-4 w-4 mr-2" />
              Brand assets
            </TabsTrigger>
            <TabsTrigger value="tokens" data-testid="tab-branding-tokens">
              <Palette className="h-4 w-4 mr-2" />
              Design tokens
            </TabsTrigger>
            <TabsTrigger value="og" data-testid="tab-branding-og">
              <Link2 className="h-4 w-4 mr-2" />
              Link previews
            </TabsTrigger>
            <TabsTrigger value="banner" data-testid="tab-branding-banner">
              <Megaphone className="h-4 w-4 mr-2" />
              Site banner
            </TabsTrigger>
            <TabsTrigger value="social" data-testid="tab-branding-social">
              <Share2 className="h-4 w-4 mr-2" />
              Social posts
            </TabsTrigger>
            <TabsTrigger value="avatars" data-testid="tab-branding-avatars">
              <Sparkles className="h-4 w-4 mr-2" />
              Avatar lab
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="assets" className="mt-4">
          <AdminBrandAssetsCard />
        </TabsContent>
        <TabsContent value="tokens" className="mt-4">
          <AdminDesignTokensCard />
        </TabsContent>
        <TabsContent value="og" className="mt-4">
          <AdminOgPreviewCard />
        </TabsContent>
        <TabsContent value="banner" className="mt-4">
          <AdminSiteBannerCard />
        </TabsContent>
        <TabsContent value="social" className="mt-4">
          <AdminSocialTemplatesCard />
        </TabsContent>
        <TabsContent value="avatars" className="mt-4">
          <AdminAvatarLabCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
