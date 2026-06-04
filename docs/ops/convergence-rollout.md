# Convergence rollout (ops)

Shipped in commit `05ed297a`. All behavior is **env-flag gated** (default OFF).

## Railway flags (order)

| Stage | Variables | Notes |
|-------|-----------|--------|
| 1 | `LOCKIN_FAIR_SHADOW=true` | Logs `[LockInFair][shadow]`; no bet changes |
| 2 | `LOCKIN_FAIR_ENABLED=true` | Keep shadow on; agents use fair floor |
| 3 | Seed arb + `ARB_COHORT_ENABLED=true` | `POST /api/admin/agents/seed` with `{ "archiveLegacy": false }` |
| Monday | `NATIVE_FRIDAY_CUTOFF_ENABLED=true` | Up/Down betting closes Friday 23:59 UTC; jackpot/updown roster uses anchored Monday selection |
| Optional | `EARLY_WEEK_SETTLEMENT_BONUS_ENABLED`, `SCORE_EMA_MORE_RAW_ENABLED` | EMA requires σ re-calibration |

### H2H (separate flags — does not affect up/down rollout)

| Stage | Variables | Notes |
|-------|-----------|--------|
| H1 | `LOCKIN_FAIR_H2H_SHADOW=true` | Logs `[LockInFairH2H][shadow]`; no bet changes |
| H2 | `LOCKIN_FAIR_H2H_ENABLED=true` | Confidence floor + decisive force-pick on H2H |
| H3 | (with H2) `ARB_COHORT_ENABLED=true` | Near-close H2H convergence sweep uses `computeArbPredictionH2H` |

Optional tuning: `LOCKIN_H2H_DECISIVE_FAIR` (default `0.58`), `LOCKIN_H2H_SIGMA_1D`, `LOCKIN_H2H_BETA`.

Pre-fix baseline (resolved H2H): winner avg final price **~0.538**; target post-fix **> 0.70** on clear favorites.

### Gainer (separate flags — does not affect up/down or H2H rollout)

| Stage | Variables | Notes |
|-------|-----------|--------|
| G1 | `LOCKIN_FAIR_GAINER_SHADOW=true` | Logs `[LockInFairGainer][shadow]`; no bet changes |
| G2 | `LOCKIN_FAIR_GAINER_ENABLED=true` | Confidence floor + decisive force-pick on gainer |
| G3 | (with G2) `ARB_COHORT_ENABLED=true` | Near-close gainer convergence sweep uses `computeArbPredictionGainer` |

Optional tuning: `LOCKIN_GAINER_DECISIVE_FAIR` (default `0.45`), `LOCKIN_GAINER_SIGMA_1D`, `LOCKIN_GAINER_BETA`.

Pre-fix baseline (resolved gainer): winner avg final price **~0.124** (near 1/N random baseline); target post-fix **well above 0.15** on clear leaders.

## CLI tools

```bash
npm run amm:convergence      # live up/down + H2H + gainer fair vs price
npm run amm:calibration      # resolved-market reliability (after Sunday)
npm run amm:validate-convergence
npm run amm:drain-headroom   # 24h house P&L vs breaker threshold
npm run amm:health
```

## Friday cutoff scope (confirmed)

When `NATIVE_FRIDAY_CUTOFF_ENABLED=true`:

- **Up/Down** — betting closes Friday 23:59 UTC (`getWeeklyBettingCutoff`).
- **H2H, gainer** — unchanged; still close at `endAt −` AMM pre-resolve cooldown (~5 min).
- **Jackpot** — parimutuel Friday cutoff (unchanged).

Code: [`NATIVE_FRIDAY_CUTOFF_MARKET_TYPES`](../server/native-markets/lifecycle.ts) = `["updown"]` only.

## This week's markets

Thick `b` (legacy `targetMaxLoss=5000`) markets are **left to grind** via lock-in + arb; lower `b` applies to **new** markets from next Monday generation.

## Rollback

Flip flags off; next agent sweep picks up. Positions settle normally.
