import { forwardRef } from "react";
import { TrendingUp, TrendingDown, Trophy, Target, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Aspect presets used by the share pipeline. Sizes are the target PNG output
 * in pixels — the same React tree is re-used for both, we just swap the
 * container dimensions + font scale.
 */
export type ShareAspect = "square" | "landscape";

export const SHARE_DIMENSIONS: Record<ShareAspect, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  landscape: { width: 1200, height: 630 },
};

export interface ShareCardWinData {
  variant: "win";
  personName: string | null;
  personAvatar: string | null;
  marketTitle: string;
  direction: "up" | "down" | "other";
  entryLabel: string;
  stakeAmount: number;
  payout: number;
  baselineScore?: number;
  currentScore?: number;
  category?: string | null;
}

export interface ShareCardPortfolioData {
  variant: "portfolio";
  username: string;
  rankName?: string | null;
  rankColor?: string | null;
  winRate: number;
  netCredits: number;
  totalPredictions: number;
  currentStreak?: number;
  bestCategory?: string | null;
}

export type ShareCardData = ShareCardWinData | ShareCardPortfolioData;

interface ShareCardProps {
  data: ShareCardData;
  aspect: ShareAspect;
}

const SITE_URL = "voxdex.app";

function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Visual-only card used as the source for PNG snapshots. Rendered in a
 * hidden fixed-size container that `html-to-image` reads from. Styling is
 * inline / Tailwind so it renders identically when snapshot.
 *
 * The component avoids any runtime data fetches, images that require auth,
 * or CSS that depends on parent containers — all visuals are self-contained
 * so the snapshot output looks the same as the preview.
 */
export const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(function ShareCard(
  { data, aspect },
  ref,
) {
  const dims = SHARE_DIMENSIONS[aspect];
  const isLandscape = aspect === "landscape";

  return (
    <div
      ref={ref}
      style={{
        width: `${dims.width}px`,
        height: `${dims.height}px`,
      }}
      className={cn(
        "relative overflow-hidden",
        "font-sans text-white",
        // Deep indigo -> violet gradient to match VoxDex brand; this also
        // reads well on X/IG timelines where most cards are flat.
        "bg-[#0B0B1B]",
      )}
      data-share-card
      data-variant={data.variant}
      data-aspect={aspect}
    >
      {/* Ambient gradient wash */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at top left, rgba(139,92,246,0.35) 0%, transparent 55%), radial-gradient(ellipse at bottom right, rgba(59,130,246,0.28) 0%, transparent 60%)",
        }}
      />

      {/* Subtle grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />

      {data.variant === "win" ? (
        <WinLayout data={data} isLandscape={isLandscape} />
      ) : (
        <PortfolioLayout data={data} isLandscape={isLandscape} />
      )}
    </div>
  );
});

// ---------------- Win variant ----------------

function WinLayout({
  data,
  isLandscape,
}: {
  data: ShareCardWinData;
  isLandscape: boolean;
}) {
  const pnl = data.payout - data.stakeAmount;
  const directionAccent =
    data.direction === "up"
      ? "#10B981"
      : data.direction === "down"
        ? "#F43F5E"
        : "#A855F7";
  const directionLabel =
    data.direction === "up" ? "UP" : data.direction === "down" ? "DOWN" : "PICKED";
  const DirectionIcon =
    data.direction === "up"
      ? TrendingUp
      : data.direction === "down"
        ? TrendingDown
        : Target;

  // Shared content: header (brand) + hero (avatar + title) + result + footer
  return (
    <div
      className={cn(
        "relative flex flex-col h-full w-full",
        isLandscape ? "px-14 py-12" : "px-20 py-20",
      )}
    >
      <Header />

      <div
        className={cn(
          "flex flex-1 gap-10 mt-10",
          isLandscape ? "flex-row items-center" : "flex-col items-stretch justify-center",
        )}
      >
        {/* Avatar + person */}
        <div
          className={cn(
            "flex items-center gap-6 shrink-0",
            isLandscape ? "w-[42%]" : "w-full",
          )}
        >
          <AvatarSquare
            name={data.personName || "Unknown"}
            avatar={data.personAvatar}
            size={isLandscape ? 160 : 200}
          />
          <div className="flex flex-col gap-2 min-w-0">
            <p
              className={cn(
                "uppercase tracking-[0.25em] text-white/60 font-medium",
                isLandscape ? "text-[16px]" : "text-[18px]",
              )}
            >
              Called {directionLabel}
            </p>
            <p
              className={cn(
                "font-bold leading-tight truncate",
                isLandscape ? "text-[44px]" : "text-[56px]",
              )}
              style={{ fontFamily: "'Space Grotesk', ui-sans-serif, system-ui" }}
            >
              {data.personName || "—"}
            </p>
          </div>
        </div>

        {/* Result block */}
        <div
          className={cn(
            "flex flex-col gap-6",
            isLandscape ? "flex-1" : "w-full",
          )}
        >
          <div
            className="rounded-3xl border p-8"
            style={{
              borderColor: `${directionAccent}55`,
              background: `linear-gradient(135deg, ${directionAccent}20 0%, rgba(255,255,255,0.03) 100%)`,
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="flex items-center justify-center rounded-xl"
                style={{
                  background: `${directionAccent}22`,
                  color: directionAccent,
                  width: isLandscape ? 48 : 56,
                  height: isLandscape ? 48 : 56,
                }}
              >
                <DirectionIcon
                  style={{ width: isLandscape ? 28 : 32, height: isLandscape ? 28 : 32 }}
                />
              </div>
              <p
                className={cn(
                  "uppercase tracking-[0.2em] font-semibold",
                  isLandscape ? "text-[15px]" : "text-[17px]",
                )}
                style={{ color: directionAccent }}
              >
                Prediction Won
              </p>
            </div>
            <p
              className={cn(
                "font-bold leading-tight",
                isLandscape ? "text-[72px]" : "text-[96px]",
              )}
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                color: "#34D399",
                lineHeight: 1,
              }}
            >
              +{pnl.toLocaleString()}
            </p>
            <p
              className={cn(
                "text-white/70 mt-1",
                isLandscape ? "text-[18px]" : "text-[22px]",
              )}
            >
              credits on a {data.stakeAmount.toLocaleString()} stake
            </p>
          </div>

          <p
            className={cn(
              "text-white/80 leading-snug line-clamp-2",
              isLandscape ? "text-[20px]" : "text-[26px]",
            )}
          >
            “{data.marketTitle}”
          </p>

          {data.baselineScore && data.currentScore && data.baselineScore > 0 && (
            <div
              className={cn(
                "flex items-center gap-6 text-white/60",
                isLandscape ? "text-[16px]" : "text-[20px]",
              )}
              style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
            >
              <span>
                Baseline{" "}
                <span className="text-white font-semibold">
                  {formatScore(data.baselineScore)}
                </span>
              </span>
              <span>→</span>
              <span>
                Close{" "}
                <span className="text-white font-semibold">
                  {formatScore(data.currentScore)}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>

      <Footer entryLabel={data.entryLabel} category={data.category} />
    </div>
  );
}

// ---------------- Portfolio variant ----------------

function PortfolioLayout({
  data,
  isLandscape,
}: {
  data: ShareCardPortfolioData;
  isLandscape: boolean;
}) {
  const netPositive = data.netCredits >= 0;
  const netColor = netPositive ? "#34D399" : "#F87171";

  // Three headline stats. We keep typography large and monospaced so they
  // read at thumbnail size on feeds.
  const stats: { label: string; value: string; accent?: string; icon?: typeof Trophy }[] = [
    {
      label: "Win Rate",
      value: `${data.winRate}%`,
      accent: "#A78BFA",
      icon: Trophy,
    },
    {
      label: "Net Credits",
      value: `${netPositive ? "+" : ""}${data.netCredits.toLocaleString()}`,
      accent: netColor,
      icon: TrendingUp,
    },
    {
      label: "Predictions",
      value: data.totalPredictions.toLocaleString(),
      accent: "#60A5FA",
      icon: Target,
    },
  ];

  return (
    <div
      className={cn(
        "relative flex flex-col h-full w-full",
        isLandscape ? "px-14 py-12" : "px-20 py-20",
      )}
    >
      <Header />

      <div
        className={cn(
          "flex flex-1 flex-col justify-center gap-10",
          isLandscape ? "mt-6" : "mt-12",
        )}
      >
        <div>
          <p
            className={cn(
              "uppercase tracking-[0.25em] text-white/60 font-medium",
              isLandscape ? "text-[16px]" : "text-[20px]",
            )}
          >
            Prediction Portfolio
          </p>
          <p
            className={cn(
              "font-bold leading-tight mt-2",
              isLandscape ? "text-[56px]" : "text-[72px]",
            )}
            style={{ fontFamily: "'Space Grotesk', ui-sans-serif, system-ui" }}
          >
            @{data.username}
          </p>
          {data.rankName && (
            <div
              className="inline-flex items-center gap-3 rounded-full border px-5 py-2 mt-4"
              style={{
                borderColor: `${data.rankColor || "#8B5CF6"}55`,
                background: `${data.rankColor || "#8B5CF6"}1A`,
                color: data.rankColor || "#C4B5FD",
              }}
            >
              <Trophy style={{ width: isLandscape ? 20 : 24, height: isLandscape ? 20 : 24 }} />
              <span
                className={cn(
                  "font-semibold uppercase tracking-[0.15em]",
                  isLandscape ? "text-[16px]" : "text-[20px]",
                )}
              >
                {data.rankName}
              </span>
            </div>
          )}
        </div>

        <div
          className={cn(
            "grid gap-6",
            isLandscape ? "grid-cols-3" : "grid-cols-3",
          )}
        >
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className="rounded-3xl border border-white/10 p-6 flex flex-col gap-3"
                style={{
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                <div className="flex items-center gap-2 text-white/60">
                  {Icon && (
                    <Icon
                      style={{
                        width: isLandscape ? 22 : 26,
                        height: isLandscape ? 22 : 26,
                        color: s.accent,
                      }}
                    />
                  )}
                  <span
                    className={cn(
                      "uppercase tracking-[0.18em] font-medium",
                      isLandscape ? "text-[13px]" : "text-[15px]",
                    )}
                  >
                    {s.label}
                  </span>
                </div>
                <p
                  className={cn("font-bold leading-none")}
                  style={{
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    color: s.accent,
                    fontSize: isLandscape ? 56 : 76,
                  }}
                >
                  {s.value}
                </p>
              </div>
            );
          })}
        </div>

        {(data.currentStreak || data.bestCategory) && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-4 text-white/70",
              isLandscape ? "text-[18px]" : "text-[22px]",
            )}
          >
            {data.currentStreak !== undefined && data.currentStreak > 0 && (
              <span className="inline-flex items-center gap-2">
                <Flame
                  style={{
                    width: isLandscape ? 22 : 26,
                    height: isLandscape ? 22 : 26,
                    color: "#FB923C",
                  }}
                />
                <span className="text-white font-semibold">
                  {data.currentStreak} streak
                </span>
              </span>
            )}
            {data.bestCategory && (
              <span className="inline-flex items-center gap-2">
                <Trophy
                  style={{
                    width: isLandscape ? 22 : 26,
                    height: isLandscape ? 22 : 26,
                    color: "#FBBF24",
                  }}
                />
                <span>
                  Strongest in{" "}
                  <span className="text-white font-semibold capitalize">
                    {data.bestCategory.replace(/_/g, " ")}
                  </span>
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}

// ---------------- Shared bits ----------------

function Header() {
  return (
    <div className="relative flex items-center gap-4">
      <div
        className="rounded-2xl flex items-center justify-center"
        style={{
          width: 64,
          height: 64,
          background:
            "linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%)",
          boxShadow: "0 10px 30px -10px rgba(139,92,246,0.6)",
        }}
      >
        <span
          className="font-bold text-white"
          style={{
            fontSize: 28,
            fontFamily: "'Space Grotesk', ui-sans-serif, system-ui",
            letterSpacing: "-0.02em",
          }}
        >
          Vx
        </span>
      </div>
      <div>
        <p
          className="font-bold leading-none"
          style={{
            fontSize: 36,
            fontFamily: "'Space Grotesk', ui-sans-serif, system-ui",
            letterSpacing: "-0.02em",
          }}
        >
          VoxDex
        </p>
        <p
          className="text-white/60 leading-none mt-1"
          style={{ fontSize: 16, letterSpacing: "0.12em" }}
        >
          LIVE INFLUENCE INDEX
        </p>
      </div>
    </div>
  );
}

function Footer({
  entryLabel,
  category,
}: {
  entryLabel?: string;
  category?: string | null;
}) {
  return (
    <div className="relative flex items-end justify-between mt-auto pt-8">
      <div className="flex flex-wrap items-center gap-3">
        {entryLabel && (
          <span
            className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-white/80"
            style={{ fontSize: 16 }}
          >
            {entryLabel}
          </span>
        )}
        {category && (
          <span
            className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-white/80 capitalize"
            style={{ fontSize: 16 }}
          >
            {category.replace(/_/g, " ")}
          </span>
        )}
      </div>
      <p
        className="text-white/60"
        style={{
          fontSize: 20,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          letterSpacing: "0.08em",
        }}
      >
        {SITE_URL}
      </p>
    </div>
  );
}

function AvatarSquare({
  name,
  avatar,
  size,
}: {
  name: string;
  avatar: string | null;
  size: number;
}) {
  const initials = getInitials(name || "?");
  const hasAvatar =
    avatar && typeof avatar === "string" && /^https?:\/\//i.test(avatar.trim());

  return (
    <div
      className="rounded-2xl overflow-hidden shrink-0 relative"
      style={{
        width: size,
        height: size,
        background:
          "linear-gradient(135deg, rgba(139,92,246,0.35) 0%, rgba(59,130,246,0.35) 100%)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {hasAvatar ? (
        // Intentionally using a raw <img> so html-to-image can inline it.
        // crossOrigin anonymous lets us snapshot cross-origin avatars when the
        // server sets permissive CORS headers; if it fails, initials fallback
        // keeps the card usable.
        <img
          src={avatar!}
          alt={name}
          width={size}
          height={size}
          crossOrigin="anonymous"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div
          className="flex items-center justify-center w-full h-full text-white font-bold"
          style={{
            fontFamily: "'Space Grotesk', ui-sans-serif, system-ui",
            fontSize: size * 0.38,
          }}
        >
          {initials}
        </div>
      )}
    </div>
  );
}
