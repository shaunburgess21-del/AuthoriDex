import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

type OgEntityType =
  | "site"
  | "community_market"
  | "native_predict"
  | "sentiment_poll"
  | "opinion_poll"
  | "matchup"
  | "person";

interface OgPreviewResult {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl: string;
  imageType?: string;
  entityType: string;
  entityLabel?: string;
  warnings: string[];
}

interface MarketRow {
  id: string;
  title: string;
  slug: string;
  marketType: string;
}

interface SlugRow {
  slug: string;
  title?: string;
  headline?: string;
}

interface PersonRow {
  id: string;
  name: string;
}

const PREDICT_TYPE_MAP: Record<string, "updown" | "h2h" | "race" | "jackpot"> = {
  updown: "updown",
  h2h: "h2h",
  gainer: "race",
  jackpot: "jackpot",
};

function buildPreviewQuery(
  mode: "url" | "picker",
  urlInput: string,
  entityType: OgEntityType,
  slug: string,
  marketId: string,
  predictType: string,
  personId: string,
): string {
  if (mode === "url") {
    const trimmed = urlInput.trim();
    if (trimmed.startsWith("http")) {
      return `/api/admin/og-preview?url=${encodeURIComponent(trimmed)}`;
    }
    const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return `/api/admin/og-preview?pathname=${encodeURIComponent(path)}`;
  }

  const params = new URLSearchParams({ entityType });
  if (entityType === "site") return `/api/admin/og-preview?${params}`;
  if (entityType === "community_market" && slug) {
    params.set("slug", slug);
    return `/api/admin/og-preview?${params}`;
  }
  if (entityType === "native_predict" && marketId && predictType) {
    params.set("marketId", marketId);
    params.set("predictType", predictType);
    return `/api/admin/og-preview?${params}`;
  }
  if (
    (entityType === "sentiment_poll" ||
      entityType === "opinion_poll" ||
      entityType === "matchup") &&
    slug
  ) {
    params.set("slug", slug);
    return `/api/admin/og-preview?${params}`;
  }
  if (entityType === "person" && personId) {
    params.set("personId", personId);
    return `/api/admin/og-preview?${params}`;
  }
  return "";
}

export function AdminOgPreviewCard() {
  const [mode, setMode] = useState<"url" | "picker">("picker");
  const [urlInput, setUrlInput] = useState("");
  const [entityType, setEntityType] = useState<OgEntityType>("community_market");
  const [slug, setSlug] = useState("");
  const [marketId, setMarketId] = useState("");
  const [predictType, setPredictType] = useState<"updown" | "h2h" | "race" | "jackpot">("updown");
  const [personId, setPersonId] = useState("");
  const [fetchToken, setFetchToken] = useState<string | null>(null);

  const previewPath = useMemo(
    () => buildPreviewQuery(mode, urlInput, entityType, slug, marketId, predictType, personId),
    [mode, urlInput, entityType, slug, marketId, predictType, personId],
  );

  const { data: preview, isLoading, isFetching, error } = useQuery({
    queryKey: ["/api/admin/og-preview", previewPath, fetchToken],
    queryFn: async () => {
      if (!previewPath) throw new Error("Complete the form before checking preview");
      const res = await apiRequest("GET", previewPath);
      return res.json() as Promise<OgPreviewResult>;
    },
    enabled: Boolean(fetchToken && previewPath),
    retry: false,
  });

  const { data: markets } = useQuery({
    queryKey: ["/api/admin/markets"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/markets");
      return res.json() as Promise<MarketRow[]>;
    },
  });

  const { data: sentimentPolls } = useQuery({
    queryKey: ["/api/admin/trending-polls"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/trending-polls");
      return res.json() as Promise<SlugRow[]>;
    },
    enabled: entityType === "sentiment_poll",
  });

  const { data: opinionPolls } = useQuery({
    queryKey: ["/api/admin/opinion-polls"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/opinion-polls");
      return res.json() as Promise<SlugRow[]>;
    },
    enabled: entityType === "opinion_poll",
  });

  const { data: matchups } = useQuery({
    queryKey: ["/api/admin/matchups"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/matchups");
      return res.json() as Promise<SlugRow[]>;
    },
    enabled: entityType === "matchup",
  });

  const { data: celebrities } = useQuery({
    queryKey: ["/api/admin/celebrities", "og-preview"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/celebrities");
      return res.json() as Promise<PersonRow[]>;
    },
    enabled: entityType === "person",
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

  const runPreview = () => {
    if (!previewPath) {
      toast.error("Fill in the required fields for this content type");
      return;
    }
    setFetchToken(String(Date.now()));
  };

  const downloadOgPng = async () => {
    if (!preview?.imageUrl) return;
    try {
      const res = await fetch(preview.imageUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = preview.imageType?.includes("jpeg") ? "jpg" : "png";
      const base =
        preview.entityLabel?.replace(/[^\w.-]+/g, "-").slice(0, 48) ||
        preview.entityType ||
        "voxdex-og";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${base}-og.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Image downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  };

  return (
    <Card data-testid="card-og-preview">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-violet-500" />
          Link preview checker
        </CardTitle>
        <CardDescription>
          See title, description, and image as Slack, Discord, and iMessage receive from the server
          (1200×630). Download the same PNG for social posts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Chat apps cache link previews aggressively. This shows what VoxDex serves now — not
            necessarily an older cached card.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={mode === "picker" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("picker")}
            data-testid="button-og-mode-picker"
          >
            CMS picker
          </Button>
          <Button
            variant={mode === "url" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("url")}
            data-testid="button-og-mode-url"
          >
            Paste URL
          </Button>
        </div>

        {mode === "url" ? (
          <div className="space-y-2">
            <Label htmlFor="og-url-input">Public URL or path</Label>
            <Input
              id="og-url-input"
              placeholder="https://voxdex.com/markets/my-slug or /polls/example"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              data-testid="input-og-preview-url"
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Content type</Label>
              <Select value={entityType} onValueChange={(v) => setEntityType(v as OgEntityType)}>
                <SelectTrigger data-testid="select-og-entity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="site">Site home</SelectItem>
                  <SelectItem value="community_market">Community market</SelectItem>
                  <SelectItem value="native_predict">Predict market (native)</SelectItem>
                  <SelectItem value="sentiment_poll">Sentiment poll</SelectItem>
                  <SelectItem value="opinion_poll">Opinion poll</SelectItem>
                  <SelectItem value="matchup">Matchup</SelectItem>
                  <SelectItem value="person">Person profile</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {entityType === "community_market" && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Market</Label>
                <Select value={slug} onValueChange={setSlug}>
                  <SelectTrigger data-testid="select-og-community-market">
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
                    <SelectTrigger data-testid="select-og-predict-type">
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
                    <SelectTrigger data-testid="select-og-native-market">
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

            {entityType === "sentiment_poll" && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Poll</Label>
                <Select value={slug} onValueChange={setSlug}>
                  <SelectTrigger data-testid="select-og-sentiment-poll">
                    <SelectValue placeholder="Select poll" />
                  </SelectTrigger>
                  <SelectContent>
                    {(sentimentPolls ?? [])
                      .filter((p) => p.slug)
                      .map((p) => (
                        <SelectItem key={p.slug} value={p.slug!}>
                          {p.headline ?? p.slug}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {entityType === "opinion_poll" && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Opinion poll</Label>
                <Select value={slug} onValueChange={setSlug}>
                  <SelectTrigger data-testid="select-og-opinion-poll">
                    <SelectValue placeholder="Select poll" />
                  </SelectTrigger>
                  <SelectContent>
                    {(opinionPolls ?? [])
                      .filter((p) => p.slug)
                      .map((p) => (
                        <SelectItem key={p.slug} value={p.slug!}>
                          {p.title ?? p.slug}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {entityType === "matchup" && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Matchup</Label>
                <Select value={slug} onValueChange={setSlug}>
                  <SelectTrigger data-testid="select-og-matchup">
                    <SelectValue placeholder="Select matchup" />
                  </SelectTrigger>
                  <SelectContent>
                    {(matchups ?? [])
                      .filter((m) => m.slug)
                      .map((m) => (
                        <SelectItem key={m.slug} value={m.slug!}>
                          {m.title ?? m.slug}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {entityType === "person" && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Person</Label>
                <Select value={personId} onValueChange={setPersonId}>
                  <SelectTrigger data-testid="select-og-person">
                    <SelectValue placeholder="Select person" />
                  </SelectTrigger>
                  <SelectContent>
                    {(celebrities ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <Button
          onClick={runPreview}
          disabled={isLoading || isFetching}
          data-testid="button-check-og-preview"
        >
          {isLoading || isFetching ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Check preview
        </Button>

        {error && (
          <p className="text-sm text-destructive" data-testid="text-og-preview-error">
            {error instanceof Error ? error.message : "Preview failed"}
          </p>
        )}

        {preview && (
          <div className="space-y-4 border rounded-lg p-4" data-testid="panel-og-preview-result">
            {preview.warnings.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {preview.warnings.map((w) => (
                  <Badge key={w} variant="outline" className="text-amber-600 dark:text-amber-400">
                    {w}
                  </Badge>
                ))}
              </div>
            )}

            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Title</dt>
                <dd className="font-medium break-words" data-testid="text-og-preview-title">
                  {preview.title}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Description</dt>
                <dd className="break-words" data-testid="text-og-preview-description">
                  {preview.description}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Canonical URL</dt>
                <dd className="break-all font-mono text-xs">{preview.canonicalUrl}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Image URL</dt>
                <dd className="break-all font-mono text-xs">{preview.imageUrl}</dd>
              </div>
            </dl>

            <div className="rounded-lg border overflow-hidden bg-muted/30 max-w-2xl">
              <img
                src={preview.imageUrl}
                alt="OG preview"
                className="w-full h-auto"
                data-testid="img-og-preview"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={downloadOgPng} data-testid="button-download-og-png">
                <Download className="h-4 w-4 mr-2" />
                Download PNG for social
              </Button>
              <Button variant="outline" asChild>
                <a
                  href={preview.canonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="link-og-canonical"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open page
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a
                  href={preview.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="link-og-image"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open image
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
