# Convergence rollout (ops)

**Jul 2026 Track 3 defaults:** lock-in fair (up/down + H2H + gainer), arb cohort,
mid-week convergence, and latch-revert are **ON by default**. Set any flag to
`false` / `0` / `off` to disable without a code change.

Settlement close (Track 2): `NATIVE_CLOSE_MEDIAN_HOURS` defaults to **6** (trailing
median of official hourly ingest closes). Set `=1` to restore single-snapshot close.

## Railway flags

| Flag | Default | Notes |
|------|---------|--------|
| `LOCKIN_FAIR_ENABLED` | **ON** | Agents use fair floor on up/down |
| `LOCKIN_FAIR_H2H_ENABLED` | **ON** | H2H confidence floor + force-pick |
| `LOCKIN_FAIR_GAINER_ENABLED` | **ON** | Gainer confidence floor + force-pick |
| `ARB_COHORT_ENABLED` | **ON** | Arb personaBand converges prices (8 agents seeded) |
| `MIDWEEK_CONVERGENCE_ENABLED` | **ON** | Mid-week arb sweeps |
| `LATCH_REVERT_ENABLED` | **ON** | Disarm sticky decisive latch on revert |
| `NATIVE_CLOSE_MEDIAN_HOURS` | **6** | Trailing median close for settlement |
| `WARM_START_PRIORS_ENABLED` | OFF unless set | House warm-starts up/down opens |
| `NATIVE_FRIDAY_CUTOFF_ENABLED` | OFF | Up/Down betting closes Friday 23:59 UTC |

Shadow-only flags (`*_SHADOW=true`) still log candidates without changing bets.

## Railway flags (legacy staged order — historical)

Shipped in commit `05ed297a`. Behavior was previously **env-flag gated** (default OFF).

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

## Union news saw-tooth stabilization

Reduces hourly fame flicker in `NEWS_AGGREGATION_MODE=union` when Serper dominates the URL union (Bad Bunny / Drake / Kohli class). Serper news cache TTL aligns with paid-provider refresh cadence on deploy (no flag). Smoothing is env-gated (default OFF).

| Stage | Variables | Notes |
|-------|-----------|--------|
| Deploy | (none required) | Serper news cache TTL → ~3h at default Mediastack/Currents cadence; behavior unchanged until smoothing flag is set |
| After Sunday resolve | `UNION_NEWS_SMOOTHING_ENABLED=true` | 3-tick mean on healthy union path for scoring only (`trend_snapshots.news_count` stays raw) |
| Default mode | omit or `UNION_NEWS_SMOOTHING_MODE=serper_dominant` | Smooth only when `mediastackTotal < unionCount × 0.2` |
| Escalation | `UNION_NEWS_SMOOTHING_MODE=all` | Blanket union smoothing if saw-tooth persists on Mediastack-heavy people |
| Optional tuning | `UNION_NEWS_SMOOTHING_MEDIASTACK_RATIO` | Default `0.2` |
| TTL rollback | `SERPER_NEWS_CACHE_TTL_HOURS=2` | Revert Serper news cache to 2h without redeploy |

**Do not change** `LOCKIN_SIGMA_1D`, fame EMA, or agent lock-in flags when enabling smoothing.

## Decisive latch revert + mid-week convergence (Jun 2026)

Fixes sticky ~99% up/down prices after a mid-week spike fully reverts (e.g. Curry +28% → +0.3%). All behavior is **env-flag gated** (default OFF). Ship shadow-first; enable live flags at a **Sunday resolve → Monday open** boundary.

### Phase 1 — Revert-aware latch

| Stage | Variables | Notes |
|-------|-----------|--------|
| 1 | `LATCH_REVERT_SHADOW=true` | Logs `[LatchRevert][shadow] market=… pct=… wouldDisarm=…` on latched markets; no bet changes |
| 2 | `LATCH_REVERT_ENABLED=true` | When `|pctChangeVsOpen| < DECISIVE_REVERT_PCT` (default 0.05), latched markets re-arm contrarianism / weighted-random even if `weeklyOpen.decisiveLatched` stays true in metadata |

Optional tuning: `DECISIVE_REVERT_PCT` (must stay &lt; `DECISIVE_WEEKLY_MOVE_PCT` 0.10), `LATCH_TRAILING_SAMPLE_COUNT` (default 3 hourly fame samples for latch trigger — ignores single-hour score glitches).

### Phase 2 — Mid-week convergence (requires arb cohort)

| Stage | Variables | Notes |
|-------|-----------|--------|
| 1 | `MIDWEEK_CONVERGENCE_SHADOW=true` | Logs `[MidweekConvergence][shadow] market=… gap=… wouldSchedule=… side=… pct=…` for markets outside the final-6h window |
| 2 | `MIDWEEK_CONVERGENCE_ENABLED=true` | Arb cohort buys the most underpriced side when its `fair − price ≥ ARB_MIDWEEK_MIN_EDGE_PP` (default 0.12); max `ARB_CONVERGENCE_MARKETS_PER_SWEEP` per sweep; one mid-week action per market per UTC day |

Requires `ARB_COHORT_ENABLED=true` (same as near-close convergence).

**Jul 2026 update** (first shadow week showed 100% `wouldSchedule=false` despite gaps of 0.13–0.35): the midweek sweep now (a) may buy the **unfavored** side when it is the underpriced one — corrects overpriced favorites (e.g. Up at 0.99 when fair is 0.65) that the favored-side-only near-close arb skips; and (b) uses its own decisive gate `ARB_MIDWEEK_DECISIVE_PCT` (default `0.02`) instead of `LOCKIN_DECISIVE_PCT` (0.10), so mispriced near-flat markets (score reverted after an early pile-on) are tradeable. The 12pp edge bar is the primary thrash control. The near-close arb sweep is unchanged.

Optional tuning: `ARB_MIDWEEK_MIN_EDGE_PP` (default `0.12`), `ARB_MIDWEEK_DECISIVE_PCT` (default `0.02`).

### Phase 2b — Mid-week gainer convergence (Jul 2026)

Same structural gap as Phase 2, but for category-race markets: agents pick gainer entries once, early in the week, and the near-close gainer arb (`runConvergenceSweepGainer`) only fires in the final 6h, so mid-week drift (e.g. actual leader priced 3% while an early pick sits at 88%) went uncorrected for days. `runMidweekGainerConvergenceSweep` runs the same `computeArbPredictionGainer` logic outside the final-6h window with `allowUnfavoredSide: true` and a higher edge bar. Same flags as updown midweek — no new env vars required to enable.

| Stage | Variables | Notes |
|-------|-----------|--------|
| 1 | `MIDWEEK_CONVERGENCE_SHADOW=true` (already on) | Logs `[MidweekGainerConvergence][shadow] market=… wouldSchedule=… side=…` |
| 2 | `MIDWEEK_CONVERGENCE_ENABLED=true` (already on) | Arb cohort buys the most underpriced entry when `fair − price ≥ ARB_MIDWEEK_GAINER_MIN_EDGE_PP` (default 0.15); max `ARB_CONVERGENCE_MARKETS_PER_SWEEP` per sweep; one mid-week action per market per UTC day |

Requires `ARB_COHORT_ENABLED=true` and `LOCKIN_FAIR_GAINER_ENABLED=true` (both already on).

Optional tuning: `ARB_MIDWEEK_GAINER_MIN_EDGE_PP` (default `0.15` — higher than updown's 0.12 because multi-outcome races carry more LMSR slippage per round-trip).

### Validation

1. Shadow logs — Curry/Messi-type markets should show `wouldDisarm=true` when `|pct| &lt; 0.05`.
2. `npm run amm:convergence` — mispriced count should drop after `MIDWEEK_CONVERGENCE_ENABLED` on genuinely decisive moves.
3. Post-enable (next Sunday): latched markets that reverted should sit near lock-in fair, not ~99%.

### Rollback

Flip `LATCH_REVERT_ENABLED` / `MIDWEEK_CONVERGENCE_ENABLED` off; next agent sweep picks up. Positions settle normally.

## Community (World Market) source-anchored convergence (Jul 2026)

Scouted World Markets (Market Scout imports from Polymarket) carry the source
market's consensus prices in `metadata.source` — `pricesAtImport` at import,
`livePrices` refreshed daily by the source watcher. The arb cohort converges
AMM prices toward that anchor. **Deterministic, zero LLM cost** — independent
of `WORLD_MARKETS_LLM_ENABLED` (the LLM switch governs regular agents'
belief-driven world bets, not convergence). Manual (non-scouted) world markets
have no anchor and are never touched.

| Stage | Variables | Notes |
|-------|-----------|--------|
| 1 | `COMMUNITY_CONVERGENCE_SHADOW=true` | Logs `[CommunityConvergence][shadow] market=… anchor=… wouldBuy=… edge=…`; no bet changes |
| 2 | `COMMUNITY_CONVERGENCE_ENABLED=true` | Arb cohort buys the most underpriced outcome vs the source anchor when `fair − price ≥ COMMUNITY_ARB_MIN_EDGE_PP` (default 0.06); max `COMMUNITY_CONVERGENCE_MARKETS_PER_SWEEP` (default 10) per sweep; one convergence action per market per UTC day (anchor refreshes daily) |
| 3 | `COMMUNITY_SELL_SWEEP_ENABLED=true` | Agent sell sweep includes community positions (price-band exits, no updown score-reversal) so simulated flow moves prices both ways |

Requires `ARB_COHORT_ENABLED=true` (same cohort as native convergence).

Design notes:

- Fair anchor prefers `metadata.source.livePrices` (daily watcher refresh),
  falls back to `pricesAtImport`. Anchor is label-matched to current entries —
  renamed/reordered entries beyond recognition reject the anchor (no trade)
  rather than risk converging to the wrong outcome.
- Once the source resolves upstream (`source.upstreamResolvedAt`), the anchor
  deactivates — the settlement queue takes over.
- N-way max-edge buy (works for binary and multi) with unfavored sides allowed,
  mirroring the mid-week sweep's overpriced-favorite correction.
- Edge bar is deliberately above the native 4pp because the anchor can be up
  to ~24h stale between watcher runs.

Optional tuning: `COMMUNITY_ARB_MIN_EDGE_PP` (default `0.06`),
`COMMUNITY_CONVERGENCE_MARKETS_PER_SWEEP` (default `10`).

### Validation

1. Shadow logs — scouted markets with a visible gap vs Polymarket should log
   `wouldBuy` with plausible edges.
2. `npm run amm:convergence` — new "Community (World Market) convergence"
   section; mispriced count should drop after enable.
3. AMM health check 9 now includes a community line (advisory only).

### Rollback

Flip `COMMUNITY_CONVERGENCE_ENABLED` / `COMMUNITY_SELL_SWEEP_ENABLED` off; the
action worker also drains already-queued convergence buys as `skipped` when
the enable flag is off. Positions settle normally.

### Validation (union news smoothing)

```bash
npx tsx server/diagnostics/audit-news-smoothing.ts 3a5bbf27-b9c2-4315-a4dc-7944d9878d0d
```

1. Bad Bunny — smoothed column closer to rolling mean; smaller hourly fame jumps.
2. Mediastack-heavy person — with `serper_dominant` mode, `newsSmoothingForScoring.applied` should be false (requires verbose diagnostics).
3. New Serper news cache rows — `api_cache.expires_at` ~3h ahead of fetch time after deploy.
