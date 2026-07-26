import { useCallback, useMemo, useState } from "react";
import { Download, Image as ImageIcon, Shuffle, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { downloadBlob } from "@/lib/share";
import { buildFamilySampleSeeds } from "@/lib/avatar/generator";
import {
  buildVariantTiles,
  DEFAULT_TILE_OPTIONS,
  DUOTONES,
  GLASSES,
  LEVEL_RANKS,
  type DuotoneId,
  type GlassId,
  type VariantLevel,
  type VariantTile,
} from "@/lib/avatar/colorways";
import { renderVariantDataURL, renderVariantToBlob } from "@/lib/avatar/render";
import {
  buildFamilySheetBlob,
  buildVariantSheetBlob,
  PREVIEW_SIZES,
  seedSlug,
} from "@/lib/avatar/contactSheet";

/** Stand-ins for a feed row, so small sizes are judged in context. */
const MOCK_FEED_NAMES = [
  "Moonshot01",
  "SURFandTURF",
  "quietEdge",
  "ExactRally46",
  "maz26",
  "ndb1",
];

function randomSeed(): string {
  return `lab-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/**
 * Enough to stay crisp for a 96px tile on a 2x display without holding a
 * 300px PNG data URL per tile per configuration in the render cache.
 * Downloads render fresh at full size.
 */
const PREVIEW_SCALE = 20;
const DOWNLOAD_SCALE = 30;
/** The feed strip renders at 40px, so a 100px source is already 2x. */
const FEED_SCALE = 10;

function VariantPreview({ seed, tile }: { seed: string; tile: VariantTile }) {
  const dataUrl = useMemo(
    () => renderVariantDataURL(seed, tile, PREVIEW_SCALE),
    [seed, tile],
  );
  if (!dataUrl) return null;

  return (
    <div className="flex items-end gap-4">
      {PREVIEW_SIZES.map((size) => (
        <div key={size} className="flex flex-col items-center gap-1">
          <img
            src={dataUrl}
            alt={`${tile.label} at ${size}px`}
            width={size}
            height={size}
            draggable={false}
            className="rounded-full"
            style={{ width: size, height: size }}
          />
          <span className="text-[10px] text-muted-foreground">{size}</span>
        </div>
      ))}
    </div>
  );
}

export function AdminAvatarLabCard() {
  const { profile } = useAuth();
  const [seed, setSeed] = useState<string>(() => randomSeed());
  const [seedDraft, setSeedDraft] = useState<string>(seed);
  const [duotoneBase, setDuotoneBase] = useState<DuotoneId>(
    DEFAULT_TILE_OPTIONS.duotoneBase,
  );
  const [glassBase, setGlassBase] = useState<GlassId>(DEFAULT_TILE_OPTIONS.glassBase);
  const [busy, setBusy] = useState(false);

  const tiles = useMemo(
    () => buildVariantTiles({ duotoneBase, glassBase }),
    [duotoneBase, glassBase],
  );

  const familySamples = useMemo(() => buildFamilySampleSeeds(), []);

  const grouped = useMemo(() => {
    const map = new Map<VariantLevel, VariantTile[]>();
    for (const tile of tiles) {
      const list = map.get(tile.level) ?? [];
      list.push(tile);
      map.set(tile.level, list);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [tiles]);

  const runDownload = useCallback(
    async (label: string, build: () => Promise<Blob>, filename: string) => {
      setBusy(true);
      try {
        downloadBlob(await build(), filename);
      } catch (error) {
        console.error(`[AvatarLab] ${label} failed`, error);
        toast.error(`Could not build the ${label}`);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const downloadTile = useCallback(
    (tile: VariantTile) =>
      runDownload(
        "avatar PNG",
        () => renderVariantToBlob(seed, tile, DOWNLOAD_SCALE),
        `voxdex-avatar-${tile.id}-${seedSlug(seed)}.png`,
      ),
    [runDownload, seed],
  );

  const downloadVariantSheet = useCallback(
    () =>
      runDownload(
        "variant sheet",
        () => buildVariantSheetBlob(seed, tiles),
        `voxdex-avatar-variants-${seedSlug(seed)}.png`,
      ),
    [runDownload, seed, tiles],
  );

  const downloadFamilySheet = useCallback(
    (tile: VariantTile) =>
      runDownload(
        "family sheet",
        () => buildFamilySheetBlob(tile),
        `voxdex-avatar-families-${tile.id}.png`,
      ),
    [runDownload],
  );

  /** Keeps the input showing whatever is actually on screen. */
  const applySeed = useCallback((next: string) => {
    setSeed(next);
    setSeedDraft(next);
  }, []);

  const applySeedDraft = useCallback(() => {
    const next = seedDraft.trim();
    if (!next) {
      toast.error("Enter a seed first");
      return;
    }
    applySeed(next);
  }, [applySeed, seedDraft]);

  const useMySeed = useCallback(() => {
    if (!profile?.avatarSeed) {
      toast.error("Your profile has no generative seed saved");
      return;
    }
    applySeed(profile.avatarSeed);
  }, [applySeed, profile?.avatarSeed]);

  return (
    <div className="space-y-6">
      <Card data-testid="card-avatar-lab-controls">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" />
            Avatar Lab
          </CardTitle>
          <CardDescription>
            Candidate rank treatments for the generative avatars. Every variant repaints the
            same seed-derived layout, so an avatar keeps its shape and dominant hue as it
            climbs the ladder. Nothing here is live &mdash; it is a review tool.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="avatar-lab-seed">Seed</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="avatar-lab-seed"
                value={seedDraft}
                onChange={(e) => setSeedDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applySeedDraft();
                }}
                placeholder={seed}
                className="w-full sm:w-[340px]"
                data-testid="input-avatar-lab-seed"
              />
              <Button
                variant="secondary"
                onClick={applySeedDraft}
                data-testid="button-avatar-lab-apply-seed"
              >
                Use seed
              </Button>
              <Button
                variant="outline"
                onClick={() => applySeed(randomSeed())}
                data-testid="button-avatar-lab-random"
              >
                <Shuffle className="mr-2 h-4 w-4" />
                Random
              </Button>
              <Button
                variant="outline"
                onClick={useMySeed}
                data-testid="button-avatar-lab-my-seed"
              >
                <UserRound className="mr-2 h-4 w-4" />
                My avatar
              </Button>
            </div>
            <p className="font-mono text-xs text-muted-foreground">Rendering: {seed}</p>
          </div>

          <div className="space-y-2">
            <Label>Hue family presets</Label>
            <div className="flex flex-wrap gap-2">
              {familySamples.map((sample) => (
                <Button
                  key={sample.family}
                  size="sm"
                  variant={seed === sample.seed ? "default" : "outline"}
                  onClick={() => applySeed(sample.seed)}
                  data-testid={`button-avatar-lab-family-${sample.family}`}
                >
                  {sample.family}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Levels 3 and 4 inherit</Label>
              <Select
                value={duotoneBase}
                onValueChange={(v) => setDuotoneBase(v as DuotoneId)}
              >
                <SelectTrigger data-testid="select-avatar-lab-duotone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DUOTONES.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Level 4 stacks on</Label>
              <Select value={glassBase} onValueChange={(v) => setGlassBase(v as GlassId)}>
                <SelectTrigger data-testid="select-avatar-lab-glass">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GLASSES.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              onClick={downloadVariantSheet}
              disabled={busy}
              data-testid="button-avatar-lab-variant-sheet"
            >
              <ImageIcon className="mr-2 h-4 w-4" />
              Download variant sheet
            </Button>
            <p className="w-full text-xs text-muted-foreground sm:w-auto sm:self-center">
              One seed, all {tiles.length} candidates, at {PREVIEW_SIZES.join(" / ")}px.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-avatar-lab-feed">
        <CardHeader>
          <CardTitle className="text-base">In a feed</CardTitle>
          <CardDescription>
            Six different seeds at real comment-row size. Small-size legibility is the
            constraint most of these candidates live or die on.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {grouped.map(([level, levelTiles]) => (
            <div key={level} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                Level {level}
              </span>
              <div className="flex flex-wrap items-center gap-3">
                {MOCK_FEED_NAMES.map((name, i) => {
                  const tile = levelTiles[i % levelTiles.length];
                  return (
                    <div key={name} className="flex items-center gap-2">
                      <img
                        src={renderVariantDataURL(`${seed}:feed:${i}`, tile, FEED_SCALE)}
                        alt={name}
                        className="h-10 w-10 rounded-full"
                        draggable={false}
                      />
                      <span className="text-sm text-muted-foreground">{name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {grouped.map(([level, levelTiles]) => (
        <Card key={level} data-testid={`card-avatar-lab-level-${level}`}>
          <CardHeader>
            <CardTitle className="text-base">
              Level {level}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {LEVEL_RANKS[level]}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {levelTiles.map((tile) => (
              <div
                key={tile.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
                data-testid={`row-avatar-lab-${tile.id}`}
              >
                <div className="min-w-[220px] flex-1">
                  <p className="text-sm font-semibold">{tile.label}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{tile.id}</p>
                  <p className="mt-1 max-w-md text-xs text-muted-foreground">{tile.blurb}</p>
                </div>

                <VariantPreview seed={seed} tile={tile} />

                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => downloadTile(tile)}
                    data-testid={`button-avatar-lab-download-${tile.id}`}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    PNG
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => downloadFamilySheet(tile)}
                    data-testid={`button-avatar-lab-family-sheet-${tile.id}`}
                  >
                    <ImageIcon className="mr-2 h-4 w-4" />
                    All hues
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
