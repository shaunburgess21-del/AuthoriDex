/**
 * Weekly Wrap — Sunday recap of the user's prediction week.
 */

import * as React from "react";
import { Button, Column, Heading, Link, Row, Section, Text } from "react-email";
import { voxWord } from "@shared/currency";
import { VoxAmount } from "../components/VoxAmount";
import type {
  FullWeeklyDigestStats,
  OpenPositionsSummary,
  WeeklyResultRow,
} from "../../../jobs/weekly-digest-utils";
import { Layout } from "../components/Layout";
import { colors, fonts, radius, spacing, typography } from "../theme";

export const HERO_NEUTRAL_THRESHOLD = 0;
/** |net| at or below this renders as "About even this week" — avoids
 *  a giant red "−2 Vox" hero for a basically-flat week. */
const HERO_SOFT_THRESHOLD = 25;
/** Show this many result rows before collapsing to "and N more". */
const RESULTS_VISIBLE_CAP = 5;

export interface WeeklyWrapEmailProps {
  stats: FullWeeklyDigestStats;
  baseUrl?: string;
  unsubscribeUrl?: string;
}

const DEFAULT_BASE_URL = "https://voxdex.com";

export function weeklyWrapSubject(
  stats: Pick<FullWeeklyDigestStats, "wins" | "losses">,
): string {
  const resolved = stats.wins + stats.losses;
  if (resolved <= 0) return "Your VoxDex week";
  const winsLabel = stats.wins === 1 ? "1 win" : `${stats.wins} wins`;
  const lossesLabel = stats.losses === 1 ? "1 loss" : `${stats.losses} losses`;
  return `Your VoxDex week: ${winsLabel}, ${lossesLabel}`;
}

/** Hero P&L uses word "Vox" — avoids Outlook tofu on the Ꝟ glyph.
 *  Best/worst pick amounts use VoxAmount (hosted PNG) for iOS Mail. */
export function formatHeroPnl(netCredits: number): string {
  const abs = Math.abs(netCredits);
  const word = voxWord(abs);
  if (netCredits > 0) return `+${word}`;
  if (netCredits < 0) return `\u2212${word}`;
  return word;
}

export function formatWinRatePercent(wins: number, losses: number): string {
  const total = wins + losses;
  if (total <= 0) return "0%";
  return `${Math.round((wins / total) * 100)}%`;
}

export function formatRankDeltaCopy(
  rankDelta: NonNullable<FullWeeklyDigestStats["rankDelta"]>,
): string {
  const { previous, current } = rankDelta;
  if (current < previous) {
    const n = previous - current;
    return `You moved up ${n} place${n === 1 ? "" : "s"} — now ranked #${current}.`;
  }
  if (current > previous) {
    const n = current - previous;
    return `You slipped ${n} place${n === 1 ? "" : "s"} — now ranked #${current}.`;
  }
  return `You held your ground at #${current}.`;
}

export function formatMoverLine(name: string, changePct: number): string {
  const sign = changePct >= 0 ? "+" : "";
  return `${name} ${sign}${changePct.toFixed(1)}%`;
}

/** One-line summary for the "Still in play" section. */
export function formatOpenPositionsLine(
  open: OpenPositionsSummary,
): string {
  const stakeWord = voxWord(open.totalStake);
  if (open.settlingNext7d > 0) {
    const settleLabel =
      open.settlingNext7d === 1
        ? "1 settles this week"
        : `${open.settlingNext7d} settle this week`;
    return `You have ${open.count} open position${open.count === 1 ? "" : "s"} (${stakeWord} at stake) — ${settleLabel}.`;
  }
  return `You have ${open.count} open position${open.count === 1 ? "" : "s"} — ${stakeWord} at stake.`;
}

export function WeeklyWrapEmail({
  stats,
  baseUrl = DEFAULT_BASE_URL,
  unsubscribeUrl,
}: WeeklyWrapEmailProps) {
  const {
    wins,
    losses,
    netCredits,
    bestPick,
    worstPick,
    rankDelta,
    jackpot,
    topWeeklyGainers,
    results,
    openPositions,
  } = stats;

  const absNet = Math.abs(netCredits);
  const resolved = wins + losses;
  // Three hero modes:
  //   1. resolved > 0, |net| > 25   → colored P&L hero (the punchy case)
  //   2. resolved > 0, |net| <= 25  → "About even this week" + inline net
  //   3. resolved === 0             → neutral "Your week on VoxDex" (the
  //      user has only open positions; "about even" would imply they
  //      broke even on bets that didn't settle)
  const isSoft = resolved > 0 && absNet <= HERO_SOFT_THRESHOLD;
  const isNeutral = resolved === 0;
  const heroPnl = formatHeroPnl(netCredits);
  const heroColor =
    netCredits > HERO_NEUTRAL_THRESHOLD
      ? colors.success
      : netCredits < -HERO_NEUTRAL_THRESHOLD
        ? colors.danger
        : colors.textPrimary;
  const winRate = formatWinRatePercent(wins, losses);
  const statLine = resolved > 0
    ? `${wins}W · ${losses}L · ${winRate} win rate`
    : null;

  const visibleResults = results.slice(0, RESULTS_VISIBLE_CAP);
  const hiddenResultCount = Math.max(0, results.length - RESULTS_VISIBLE_CAP);
  // Best/worst callouts are redundant when we show every result.
  const showCallouts = results.length > RESULTS_VISIBLE_CAP;

  const preview = `This week's recap on VoxDex. Your prediction week in one glance: results, best calls, and what to watch next on the trend index.`;

  return (
    <Layout
      preview={preview}
      footerContext="You're receiving this because you opted in to prediction emails on VoxDex."
      baseUrl={baseUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={{ ...typography.caption, margin: `0 0 ${spacing.snug}` }}>
        This week&apos;s recap
      </Text>

      {isNeutral ? (
        <Heading
          style={{
            ...typography.h1,
            color: colors.textPrimary,
            margin: `0 0 ${spacing.snug}`,
          }}
        >
          Your week on VoxDex
        </Heading>
      ) : isSoft ? (
        <Heading
          style={{
            ...typography.h1,
            color: colors.textPrimary,
            margin: `0 0 ${spacing.snug}`,
          }}
        >
          About even this week
        </Heading>
      ) : (
        <Heading
          style={{
            ...typography.h1,
            color: heroColor,
            margin: `0 0 ${spacing.snug}`,
          }}
        >
          {heroPnl}
        </Heading>
      )}

      {statLine ? (
        <Text style={statLineStyle}>
          {statLine}
          {isSoft ? (
            <>
              {"  ·  "}
              <span style={{ color: heroColor }}>{heroPnl}</span>
            </>
          ) : null}
        </Text>
      ) : null}

      {visibleResults.length > 0 ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Your results this week</Text>
          {visibleResults.map((row, idx) => (
            <ResultRow
              key={`${row.marketId}|${row.entryId}|${idx}`}
              row={row}
              baseUrl={baseUrl}
            />
          ))}
          {hiddenResultCount > 0 ? (
            <Text
              style={{
                ...typography.small,
                margin: `${spacing.snug} 0 0 0`,
              }}
            >
              <Link
                href={`${baseUrl}/me/predictions`}
                style={inlineLinkStyle}
              >
                And {hiddenResultCount} more
              </Link>{" "}
              on your predictions page.
            </Text>
          ) : null}
        </Section>
      ) : null}

      {showCallouts && bestPick ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Your best call</Text>
          <Text style={typography.body}>
            You called {bestPick.label} — netted you{" "}
            <VoxAmount baseUrl={baseUrl} amount={bestPick.profit} variant="positive" />.
          </Text>
        </Section>
      ) : null}

      {showCallouts && worstPick ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Toughest call this week</Text>
          <Text style={typography.body}>
            {worstPick.label} closed against you{" "}
            <VoxAmount baseUrl={baseUrl} amount={worstPick.profit} variant="parens" />.
          </Text>
        </Section>
      ) : null}

      {openPositions && openPositions.count > 0 ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Still in play</Text>
          <Text style={typography.body}>
            {formatOpenPositionsLine(openPositions)}{" "}
            <Link href={`${baseUrl}/me/predictions`} style={inlineLinkStyle}>
              Check your positions
            </Link>
            .
          </Text>
        </Section>
      ) : null}

      {rankDelta ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Leaderboard</Text>
          <Text style={typography.body}>{formatRankDeltaCopy(rankDelta)}</Text>
        </Section>
      ) : null}

      {jackpot ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Weekly Jackpot</Text>
          <Text style={typography.body}>
            {jackpot.won && jackpot.profit > 0
              ? `Your Jackpot ticket paid out +${voxWord(jackpot.profit)} this week.`
              : `Your ${voxWord(Math.abs(jackpot.profit))} Jackpot ticket didn't hit this week. Better luck next week.`}
          </Text>
        </Section>
      ) : null}

      {topWeeklyGainers.length > 0 ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Watch this week</Text>
          <Text
            style={{
              ...typography.small,
              color: colors.textTertiary,
              margin: `0 0 ${spacing.snug} 0`,
            }}
          >
            Biggest 7-day fame-index movers — prime prediction territory.
          </Text>
          {topWeeklyGainers.map((gainer) => (
            <Text
              key={gainer.id}
              style={{ ...typography.small, margin: `0 0 ${spacing.tight}` }}
            >
              <Link
                href={`${baseUrl}/person/${gainer.id}`}
                style={inlineLinkStyle}
              >
                {gainer.name}
              </Link>{" "}
              {gainer.change7d >= 0 ? "+" : ""}
              {gainer.change7d.toFixed(1)}%
            </Text>
          ))}
        </Section>
      ) : null}

      <Section style={ctaContainerStyle}>
        <Button href={`${baseUrl}/predict`} style={ctaButtonStyle}>
          Predict this week&apos;s markets
        </Button>
      </Section>

      <Text style={{ ...typography.body, margin: 0 }}>See you inside,</Text>
      <Text style={{ ...typography.body, margin: 0 }}>— The VoxDex Team</Text>
    </Layout>
  );
}

function ResultRow({
  row,
  baseUrl,
}: {
  row: WeeklyResultRow;
  baseUrl: string;
}) {
  const won = row.outcome === "won";
  const marketUrl = row.marketSlug
    ? `${baseUrl}/markets/${row.marketSlug}`
    : `${baseUrl}/me/predictions`;

  return (
    <Row style={resultRowStyle}>
      <Column style={resultBadgeColumnStyle} valign="middle">
        <Text style={resultBadgeStyle(won)}>{won ? "WON" : "LOST"}</Text>
      </Column>
      <Column style={resultTitleColumnStyle} valign="middle">
        <Text style={resultTitleTextStyle}>
          <Link href={marketUrl} style={resultTitleLinkStyle}>
            {row.marketTitle}
          </Link>
        </Text>
        <Text style={resultCallTextStyle}>Your call: {row.pickLabel}</Text>
      </Column>
      <Column style={resultPnlColumnStyle} valign="middle">
        <Text style={resultPnlTextStyle(won)}>
          <VoxAmount
            baseUrl={baseUrl}
            amount={Math.abs(row.net)}
            variant={won ? "positive" : "negative"}
          />
        </Text>
      </Column>
    </Row>
  );
}

export default WeeklyWrapEmail;

const statLineStyle: React.CSSProperties = {
  ...typography.body,
  color: colors.textSecondary,
  fontWeight: 600,
  letterSpacing: "0.04em",
  margin: `0 0 ${spacing.block}`,
};

const blockStyle: React.CSSProperties = {
  backgroundColor: colors.bgSubtle,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  margin: `${spacing.block} 0`,
  padding: `${spacing.block} ${spacing.paragraph}`,
};

const blockHeadingStyle: React.CSSProperties = {
  ...typography.caption,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  margin: `0 0 ${spacing.tight}`,
};

const inlineLinkStyle: React.CSSProperties = {
  color: colors.brandBright,
  textDecoration: "underline",
};

const ctaContainerStyle: React.CSSProperties = {
  margin: `${spacing.block} 0`,
  textAlign: "center",
};

const ctaButtonStyle: React.CSSProperties = {
  backgroundColor: colors.brand,
  borderRadius: radius.md,
  color: "#ffffff",
  display: "inline-block",
  fontFamily: fonts.body,
  fontSize: "16px",
  fontWeight: 600,
  padding: "14px 28px",
  textDecoration: "none",
};

const resultRowStyle: React.CSSProperties = {
  borderBottom: `1px solid ${colors.border}`,
  // No padding on the row itself — react-email wraps it in a table; the
  // inner Column padding handles spacing. Last row's border is masked
  // by the block's padding so we don't get a stray hairline.
  paddingBottom: spacing.tight,
  paddingTop: spacing.tight,
};

const resultBadgeColumnStyle: React.CSSProperties = {
  width: "64px",
  verticalAlign: "middle",
};

const resultTitleColumnStyle: React.CSSProperties = {
  verticalAlign: "middle",
  paddingLeft: spacing.tight,
  paddingRight: spacing.tight,
};

const resultPnlColumnStyle: React.CSSProperties = {
  width: "96px",
  verticalAlign: "middle",
  textAlign: "right" as const,
};

const resultBadgeStyle = (won: boolean): React.CSSProperties => ({
  ...typography.caption,
  color: won ? colors.success : colors.danger,
  fontWeight: 700,
  letterSpacing: "0.08em",
  margin: 0,
});

const resultTitleTextStyle: React.CSSProperties = {
  ...typography.body,
  margin: `0 0 ${spacing.hairline}`,
  fontWeight: 600,
};

const resultTitleLinkStyle: React.CSSProperties = {
  color: colors.textPrimary,
  textDecoration: "underline",
};

const resultCallTextStyle: React.CSSProperties = {
  ...typography.small,
  color: colors.textSecondary,
  margin: 0,
};

const resultPnlTextStyle = (won: boolean): React.CSSProperties => ({
  ...typography.body,
  color: won ? colors.success : colors.danger,
  fontWeight: 700,
  margin: 0,
  textAlign: "right" as const,
});
