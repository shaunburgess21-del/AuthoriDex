import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ImageIcon, Loader2, Share2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SocialEntityType = "community_market" | "native_predict";

interface MarketRow {
  id: string;
  title: string;
  slug: string;
  marketType: string;
}

const PREDICT_TYPE_MAP: Record<string, "updown" | "h2h" | "race" | "jackpot"> = {
  updown: "updown",
  h2h: "h2h",
  gainer: "race",
  jackpot: "jackpot",
};

async function fetchAdminPngBlob(url: string): Promise<{ blob: Blob; filename?: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(url, { headers, credentials: "include" });
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      const text = await res.text();
      if (text) message = text.slice(0, 200);
    }
    throw new Error(message);
  }
  if (!contentType.includes("image/png")) {
    throw new Error("Server did not return a PNG image");
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] };
}

function buildSocialTemplateUrl(
  template: "new_market" | "top_predictors_week",
  aspect: "square" | "landscape",
  entityType?: SocialEntityType,
  slug?: string,
  marketId?: string,
  predictType?: string,
): string {
  const params = new URLSearchParams({ template, aspect });
  if (template === "top_predictors_week") {
    return `/api/admin/social-template.png?${params}`;
  }
  if (entityType === "community_market" && slug) {
    params.set("entityType", entityType);
    params.set("slug", slug);
    return `/api/admin/social-template.png?${params}`;
  }
  if (entityType === "native_predict" && marketId && predictType) {
    params.set("entityType", entityType);
    params.set("marketId", marketId);
    params.set("predictType", predictType);
    return `/api/admin/social-template.png?${params}`;
  }
  return "";
}

export function AdminSocialTemplatesCard() {
  const [entityType, setEntityType] = useState<SocialEntityType>("community_market");
  const [slug, setSlug] = useState("");
  const [marketId, setMarketId] = useState("");
  const [predictType, setPredictType] = useState<"updown" | "h2h" | "race" | "jackpot">("updown");
  const [aspect, setAspect] = useState<"square" | "landscape">("square");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const { data: markets } = useQuery({
    queryKey: ["/api/admin/markets", "social-templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/markets");
      return res.json() as Promise<MarketRow[]>;
    },
  });

  const communityMarkets = useMemo(
    () => (markets ?? []).filter((m) => m.marketType === "community" && m.slug),
    [markets],
  );

  const nativeMarkets = useMemo(
    () =>
      (markets ?? []).filter(
        (m) =>
          m.marketType === "updown" ||
          m.marketType === "h2h" ||
          m.marketType === "gainer" ||
          m.marketType === "jackpot",
      ),
    [markets],
  );

  const newMarketUrl = useMemo(
    () =>
      buildSocialTemplateUrl(
        "new_market",
        aspect,
        entityType,
        slug,
        marketId,
        predictType,
      ),
    [aspect, entityType, slug, marketId, predictType],
  );

  const topWeekUrl = useMemo(
    () => buildSocialTemplateUrl("top_predictors_week", aspect),
    [aspect],
  );

  const clearPreview = () => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  useEffect(() => {
    clearPreview();
  }, [aspect, entityType, slug, marketId, predictType]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const loadPreview = async (url: string) => {
    if (!url) {
      toast.error("Select a market first");
      return;
    }
    setLoadingPreview(true);
    try {
      const { blob } = await fetchAdminPngBlob(url);
      clearPreview();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  };

  const downloadPng = async (url: string, fallbackFilename: string) => {
    if (!url) {
      toast.error("Complete the form before downloading");
      return;
    }
    try {
      const { blob, filename } = await fetchAdminPngBlob(url);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename ?? fallbackFilename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success("PNG downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  };

  const squareFilename = (base: string) => `${base}-square.png`;
  const landscapeFilename = (base: string) => `${base}-landscape.png`;

  return (
    <Card data-testid="card-social-templates">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="h-5 w-5 text-violet-500" />
          Social post templates
        </CardTitle>
        <CardDescription>
          Server-rendered PNGs for X and Discord. Square 1080×1080 is recommended for feeds;
          landscape 1200×630 works for link-style posts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="new_market" className="w-full">
          <TabsList>
            <TabsTrigger value="new_market" data-testid="tab-social-new-market">
              <ImageIcon className="h-4 w-4 mr-2" />
              New market
            </TabsTrigger>
            <TabsTrigger value="top_predictors_week" data-testid="tab-social-top-week">
              <Trophy className="h-4 w-4 mr-2" />
              Top predictors (week)
            </TabsTrigger>
          </TabsList>

          <div className="mt-4 flex flex-wrap gap-2 items-center">
            <Label className="sr-only">Aspect</Label>
            <Button
              size="sm"
              variant={aspect === "square" ? "default" : "outline"}
              onClick={() => setAspect("square")}
            >
              1080×1080
            </Button>
            <Button
              size="sm"
              variant={aspect === "landscape" ? "default" : "outline"}
              onClick={() => setAspect("landscape")}
            >
              1200×630
            </Button>
          </div>

          <TabsContent value="new_market" className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Market type</Label>
                <Select
                  value={entityType}
                  onValueChange={(v) => setEntityType(v as SocialEntityType)}
                >
                  <SelectTrigger data-testid="select-social-entity-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="community_market">Community market</SelectItem>
                    <SelectItem value="native_predict">Predict market (native)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {entityType === "community_market" && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Market</Label>
                  <Select value={slug} onValueChange={setSlug}>
                    <SelectTrigger data-testid="select-social-community-market">
                      <SelectValue placeholder="Select market" />
                    </SelectTrigger>
                    <SelectContent>
                      {communityMarkets.map((m) => (
                        <SelectItem key={m.id} value={m.slug}>
                          {m.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {entityType === "native_predict" && (
                <>
                  <div className="space-y-2">
                    <Label>Predict type</Label>
                    <Select
                      value={predictType}
                      onValueChange={(v) =>
                        setPredictType(v as "updown" | "h2h" | "race" | "jackpot")
                      }
                    >
                      <SelectTrigger data-testid="select-social-predict-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="updown">Up / Down</SelectItem>
                        <SelectItem value="h2h">Head to head</SelectItem>
                        <SelectItem value="race">Category race</SelectItem>
                        <SelectItem value="jackpot">Jackpot</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Market</Label>
                    <Select
                      value={marketId}
                      onValueChange={(id) => {
                        setMarketId(id);
                        const m = nativeMarkets.find((x) => x.id === id);
                        if (m?.marketType && PREDICT_TYPE_MAP[m.marketType]) {
                          setPredictType(PREDICT_TYPE_MAP[m.marketType]);
                        }
                      }}
                    >
                      <SelectTrigger data-testid="select-social-native-market">
                        <SelectValue placeholder="Select market" />
                      </SelectTrigger>
                      <SelectContent>
                        {nativeMarkets
                          .filter((m) => {
                            const t = PREDICT_TYPE_MAP[m.marketType];
                            return !t || t === predictType;
                          })
                          .map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.title} ({m.marketType})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={loadingPreview || !newMarketUrl}
                onClick={() => loadPreview(newMarketUrl)}
                data-testid="button-preview-social-new-market"
              >
                {loadingPreview ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Preview
              </Button>
              <Button
                disabled={!newMarketUrl}
                onClick={() =>
                  downloadPng(
                    newMarketUrl,
                    aspect === "square"
                      ? squareFilename("voxdex-new-market")
                      : landscapeFilename("voxdex-new-market"),
                  )
                }
                data-testid="button-download-social-template"
              >
                <Download className="h-4 w-4 mr-2" />
                Download PNG
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="top_predictors_week" className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Uses the current week&apos;s top 3 predictors by P&amp;L from the public leaderboard.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={loadingPreview}
                onClick={() => loadPreview(topWeekUrl)}
                data-testid="button-preview-social-top-week"
              >
                {loadingPreview ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Preview (this week)
              </Button>
              <Button
                onClick={() =>
                  downloadPng(
                    topWeekUrl,
                    aspect === "square"
                      ? squareFilename("voxdex-top-predictors-week")
                      : landscapeFilename("voxdex-top-predictors-week"),
                  )
                }
                data-testid="button-download-social-top-week"
              >
                <Download className="h-4 w-4 mr-2" />
                Generate &amp; download
              </Button>
            </div>
          </TabsContent>

          {previewUrl && (
            <div className="mt-6 rounded-lg border overflow-hidden bg-muted/30 max-w-lg">
              <img
                src={previewUrl}
                alt="Social template preview"
                className="w-full h-auto"
                data-testid="img-social-template-preview"
              />
            </div>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}
