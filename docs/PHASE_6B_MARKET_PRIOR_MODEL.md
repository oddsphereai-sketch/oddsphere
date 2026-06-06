# Phase 6B — Market-Prior MLB Auto-Model V2 (design doc)

**Status**: design only. No code written. Implementation pending tomorrow morning's cron validation + 5-7 nights of measured calibration data.

**Author**: R-19 Phase 6A.1 (calibration foundation phase)

**Audience**: operator + future implementer

---

## 1. Problem statement

R-19 Phase 6A Gate-1 audit (5-slate corpus, 2026-06-01 → 2026-06-05, 38 auto-rows) confirmed:

- **Per-team scores compressed**: 79% fall in 4.0–5.0 runs, std_dev = 0.76. Real-world MLB games span 0–15 runs/team; the model cannot reach the tails.
- **No Best Angles surfaced** across 5 slates × 38 games × 3 markets = 114 market slots.
- **Confidence floor**: 73% of O/U picks land in the 50–53% band; 91% of NRFI picks do. Model rarely has conviction.
- **Market data not used as a score prior**: `predicted_home_score` and `predicted_away_score` are computed independently of market total / ML / implied team totals. Market enters only at O/U pick-side selection.

The architectural conclusion is that the model is *isolated* from market priors — the opposite end of the spectrum from "anchored to the market". Both extremes are wrong. The Phase 6B target is the middle: market as **prior**, baseball signals as **edge**.

---

## 2. Architectural goals

Phase 6B V2 must satisfy all of the following:

1. **Market-implied team totals** form the starting baseline for run expectations.
2. **Independent baseball factors** (starter quality, lineup, bullpen, park, weather, sharp/public signals, line movement) move scores away from the baseline when evidence is strong.
3. **Adjustments are capped but meaningful** — caps prevent runaway moves on weak signal; magnitudes meaningfully shift score when signal is strong.
4. **Exact-score output** is preserved (`predicted_home_score`, `predicted_away_score`, `predicted_total`).
5. **Upset capability** preserved — when strong evidence supports the underdog, the model should call it.
6. **Confidence reflects** edge magnitude + data quality + historical calibration (not just rolled forward from score differential).
7. **Best Angles require true edge, data quality, line sanity, and signal agreement** — not just highest confidence on the slate.
8. **Fallback to V1 layered model** when market data is missing / stale / inconsistent. No blind anchoring to bad market data.
9. **Calibration is the judge** — V2 ships only when measured calibration beats V1.

---

## 3. Mathematical model

### 3.1 Market-implied team totals (the prior)

The market line publishes `listed_total` (e.g., 8.5 runs) and ML odds for each side. We derive:

```
market_implied_home_total = listed_total × home_implied_share
market_implied_away_total = listed_total × (1 - home_implied_share)
```

where `home_implied_share` is computed from:
- **Primary**: Pinnacle ML odds → no-vig home win prob → empirical mapping `prob → run-share`. The empirical mapping is derived from historical play (e.g., when home win prob = 0.55, home historically scores ~0.515 of total runs on average; this is calibration-set data).
- **Fallback A**: Multi-book consensus ML odds.
- **Fallback B**: Park-adjusted 0.51 home-share default (mild home edge in MLB).

The market_implied_*_total values are stored on the feature snapshot as a *prior*. They do **not** force the prediction.

### 3.2 V2 score computation

```
adjusted_home_total = market_implied_home_total
  + α₁ × pitching_residual(opponent_starter_xera_vs_market_implied_pitching)
  + α₂ × lineup_residual(home_top8_ops_vs_league)
  + α₃ × bullpen_residual(opponent_bullpen_quality)
  + α₄ × park_residual(park_factor_vs_market_pricing)
  + α₅ × weather_residual(weather_delta_vs_market_pricing)
  + α₆ × sharp_residual(sharp_signal_alignment)
  - injury_penalty(home_top3_hitters_injured)

clamped to [market_implied_home_total - cap, market_implied_home_total + cap]
  where cap = MAX_RESIDUAL_RUNS (default 2.5)
```

**Each `*_residual()` function returns an additive delta in runs**, anchored on the market's expectation:

- `pitching_residual`: when our independent xERA/FIP/K-BB estimate is meaningfully below the market-implied pitching quality (e.g., starter is materially better than the market priced in), it reduces opponent runs.
- `lineup_residual`: when our weighted top-8 OPS analysis (handedness-aware) differs from the league baseline that the market implicitly priced.
- `bullpen_residual`: when our bullpen-quality estimate differs from the bullpen-quality embedded in the market line.
- `park_residual`: catches systematic park mispricings; usually small (markets price parks well).
- `weather_residual`: catches recent weather changes the line hasn't fully absorbed (e.g., wind shift announced after market opened).
- `sharp_residual`: aligns or opposes based on sharp money / steam / RLM direction.

The **α coefficients are calibrated** against historical data using ridge regression: minimize sum-of-squares of (V2 prediction − actual score) over a training set, with L2 regularization to prevent overfit. Initial values seeded from V1's layer weights.

### 3.3 Cap rationale

A 2.5-run cap on team-residual is deliberate:
- Empirical: very few MLB games have actual total errors > 5 runs from the market line.
- Safety: prevents one strong signal (e.g., minor injury cleared by reporter) from producing a 12-run prediction.
- Honesty: when our model wants to move >2.5 runs from the market, that's either real edge (Best Angle territory) OR a calibration bug; either way, flag it.

When cap is binding, the prediction is annotated `cap_active: true` in `sport_specific.v2_audit` so we can monitor frequency and recalibrate.

### 3.4 Confidence derivation (V2)

V1's confidence is run-diff-based: `50 + 10·runDiff + 5·eraGap·10`. This compresses to 50% when scores compress.

V2's confidence is **edge-based + quality-weighted**:

```
ml_confidence_v2 = 50
  + edge_term(predicted_no_vig_prob - market_no_vig_prob)
  + alignment_term(sharp_signals_agree_with_pick)
  - drag_term(data_quality_warnings)
  - drag_term(stale_lines)
  - drag_term(bullpen_fallback)
clamped to [50, 80]
```

- **edge_term**: scales the gap between our predicted no-vig win probability and the market's implied no-vig win probability. A 3% positive edge becomes ~10 points of confidence; 5% becomes ~15; 8%+ pegs at the cap.
- **alignment_term**: rewards confidence when sharp signals point the same way as our pick (+3 to +8 depending on tier); modest penalty when they oppose.
- **drag_term**: subtracts confidence when data is incomplete or stale (e.g., missing top-of-order OPS, lines >60 min old).

The clamp at 80 reflects baseline market efficiency — V1 already capped here implicitly via dampening; V2 makes it explicit.

### 3.5 Grade qualification (V2)

V2 retains the existing grade taxonomy (best_signal / sharp_confirmed / market_led / model_only / market_watch / public_smoke / sharp_conflict) but **the qualification thresholds are recalibrated** against actual historical edge magnitude:

- **`best_signal`**: predicted no-vig edge ≥ +2.5% AND at least one strong-tier sharp signal aligned AND data quality is "complete" (no fallbacks). Approximate frequency target: 5–10% of slate.
- **`sharp_confirmed`**: predicted no-vig edge ≥ +1.5% AND (≥1 strong sharp signal aligned OR ≥2 moderate signals aligned). Target: 15–20%.
- **`market_led`**: predicted no-vig edge ≥ +1.0% AND ≥1 strong sharp signal aligned. Target: 10–15%.
- **`model_only`**: predicted no-vig edge ≥ +2.0% AND no opposing strong signals AND market signals silent. Target: 5–10%.
- **`market_watch`**: residual class. Target: 30–50%.
- **`public_smoke`**: significant public money imbalance toward our pick side. Target: 5–10%.
- **`sharp_conflict`**: strong sharp signal opposing our pick. Target: 5–10%.

Existing V1 thresholds are V1-set and weren't recalibrated since launch — they assume V1's compressed confidence distribution. V2's confidence will be more spread, so the absolute thresholds will need to be moved.

### 3.6 Best Angles (V2)

Best Angle qualification requires ALL of:
- Grade ∈ {best_signal, sharp_confirmed}
- Confidence ≥ 60 (raised from 53)
- Edge ≥ +2.0% (no-vig basis)
- Data quality complete (no critical fallbacks)
- Line sanity: line moved <30¢ in last 2 hours, or movement aligned with pick
- No reviewer "caution" flag in `sport_specific.review_v1`

Target Best Angle frequency: 5–10% of markets per slate (matches sharp-betting research showing that ~5–10% of any given slate has meaningful +EV opportunities for a well-calibrated bettor).

---

## 4. Required inputs (extensions to `featureSnapshot`)

New fields the V2 model requires. All optional with documented fallbacks:

| Field | Source | Fallback |
|---|---|---|
| `market.listed_total` | SharpAPI lines | already present |
| `market.home_no_vig_prob` | derived from ML odds | Pinnacle preferred; multi-book consensus fallback |
| `market.away_no_vig_prob` | derived | mirror of home |
| `market.implied_home_run_share` | calibration table from ML prob | empirical mapping derived from historical slates |
| `market.implied_home_run_total` | listed_total × home_run_share | when listed_total or home_no_vig_prob null → null |
| `market.implied_away_run_total` | listed_total × (1 - home_run_share) | same |
| `market.data_quality` | derived (sportsbook count, freshness, consistency) | "ok" / "degraded" / "missing" |
| `signal.line_movement_last_2h_pct` | line_history | 0 / null |
| `signal.line_movement_aligned_with_pick` | line_history + model_pick | true if line moved >5¢ toward pick |

Existing fields (starter ERA, lineup OPS, park, weather, etc.) all retained.

---

## 5. Data quality guards

V2 must NOT silently fall back to bad market data. Guards:

1. **Market-line freshness**: if `MAX(lines.fetched_at) < 60 min ago`, treat as fresh. Else fall back to V1 layered model with audit annotation.
2. **Sportsbook coverage**: require ≥3 books with ML odds for the same game. <3 → fall back.
3. **Cross-book consistency**: max ML odds gap across books ≤ 25¢. >25¢ → fall back (likely stale book or marketplace anomaly).
4. **No `null` listed_total** → fall back to V1 (no anchor possible).
5. **Reviewer flag**: if `sport_specific.review_v1.flags` includes `public_smoke_aligned_with_pick` or similar, increase drag_term in confidence.
6. **First-inning rules unchanged**: V2 does not modify FI logic; existing Phase 4D.1 thresholds remain.

When any guard triggers fallback, V2 emits the V1 layered prediction AND annotates `sport_specific.v2_audit.fallback_reason` so monitoring catches frequency.

---

## 6. Rollout plan

### 6.1 Phase 6B.1 — Shadow mode (1 week)

- Add `lib/automodel/mlbAutoModelV2.ts` (new file; V1 untouched).
- Add env flag `AUTOMODEL_VERSION` ∈ {`v1`, `v2_shadow`, `v2`}. Default `v1`.
- In `v2_shadow` mode: orchestrator runs BOTH V1 and V2 per game. V1 result is written to `game_predictions` (production). V2 result is written to a new `game_predictions_v2_shadow` table with the same shape.
- Backtest harness compares `*_v2_shadow` vs `*_v1` over 5–7 nights.

### 6.2 Phase 6B.2 — Calibration evaluation

- Nightly: run `automodel-calibration-backtest.ts` over the shadow window.
- Compute calibration deltas: Brier(V1) vs Brier(V2), reliability bin alignment, Best-Angle hit rate, score MAE/RMSE.
- Criteria for replacing V1 (ALL must be met):
  - V2 Brier ≤ V1 Brier (lower is better) by ≥ 0.005 absolute on at least 100 finalized games
  - V2 reliability bins are closer to diagonal (predicted % matches actual %) than V1
  - V2 produces Best Angles at the 5–10% target frequency
  - V2 score MAE ≤ V1 score MAE (or within 5% — calibration matters more than score precision)
  - No regression in upset-calling (V2 calls upsets at a rate comparable to V1's bias-aware peers)

### 6.3 Phase 6B.3 — Cutover

- Flip `AUTOMODEL_VERSION=v2`. V1 continues running in shadow for monitoring.
- After 7 days clean: deprecate V1 shadow.

### 6.4 Rollback

- Single env flip: `AUTOMODEL_VERSION=v1`. V1 resumes writing to `game_predictions`. No code change, no DB schema rollback.
- Shadow table retained as audit trail.

### 6.5 Using tomorrow's slate without contaminating cron validation

**Constraint**: tomorrow is a cron-validation day; we don't want to ship V2 code alongside cron first-fire.

**Solution**:
- V2 is built post-validation (Day +2 onwards).
- V2 ships in shadow mode (no production write, no API change).
- The shadow data is comparison fodder; no member-facing behavior change.
- This decouples model risk from infrastructure risk completely.

---

## 7. Implementation outline

When implementation begins (Phase 6B.1), the following files change:

### New files

1. **`lib/automodel/mlbAutoModelV2.ts`** (~400 LOC)
   - `runMlbAutoModelV2(snapshot, stage): AutoModelOutput`
   - Pure module; no DB, no env, no service imports
   - Reuses the existing `AutoModelOutput` type
   - Internal helpers for residual computation per signal
2. **`lib/automodel/marketImpliedRunShare.ts`** (~80 LOC)
   - Pure function: ML no-vig prob → implied run share (calibration table)
   - Initial table seeded from historical league-wide data; updateable
3. **`scripts/test-mlb-automodel-v2.ts`** (~300 LOC)
   - Fixture-only unit tests
   - Covers cap behavior, fallback paths, edge cases
4. **`docs/PHASE_6B_CALIBRATION_LOG.md`** (running log)
   - Nightly backtest results during shadow phase

### Modified files

1. **`lib/automodel/featureSnapshot.ts`**
   - Add new market-derived fields (see §4)
   - Extend `GameSnapshot` type
   - Compute fields from existing `lines` + `sharp_signals` + ML odds with the data-quality guards
2. **`lib/services/automodelService.ts`**
   - Read `AUTOMODEL_VERSION` env at module load
   - Branch on `v1` / `v2_shadow` / `v2`
   - Write to shadow table when in `v2_shadow` mode
3. **`lib/services/gradeDerivationService.ts`**
   - Add edge-based qualification path (current path retained for V1 compatibility)
   - When V2 prediction is the source, use V2-aware thresholds
4. **`lib/services/verdictDerivation.ts`**
   - Raise Best Angle threshold to 60 + data-quality + line-sanity (per §3.6)
5. **`vercel.json`** (no change for shadow mode; V2 cron entry only at cutover)

### Database schema

**Optional**: add `game_predictions_v2_shadow` table with same shape as `game_predictions` for shadow mode. Alternative: write V2 audit to `sport_specific.v2_audit` JSONB on the V1 row.

Recommended: JSONB audit approach (no schema change required).

### Env vars

- `AUTOMODEL_VERSION` = `v1` | `v2_shadow` | `v2`. Default `v1`.
- `V2_RESIDUAL_CAP_RUNS` = default `2.5`.
- `V2_BEST_ANGLE_MIN_EDGE_PCT` = default `2.0`.
- `V2_CONFIDENCE_MAX` = default `80`.

All thresholds env-tunable so operator can adjust without code change during calibration.

---

## 8. Calibration evaluation criteria

V2 ships only when the calibration backtest (`automodel-calibration-backtest.ts`) reports, on a sample of 100+ finalized games:

| Metric | V1 baseline | V2 acceptance |
|---|---|---|
| Brier ML | TBD (compute first) | ≤ V1 − 0.005 |
| Brier O/U | TBD | ≤ V1 − 0.005 |
| Reliability MAE (predicted % vs actual %) | TBD | ≤ V1 |
| Best Angle frequency | 0% (current) | 5–10% per slate |
| Best Angle hit rate | n/a | ≥ 55% (sharp-edge floor) |
| Score MAE (per team) | TBD | ≤ V1 + 5% |
| Per-team score std_dev | 0.76 | ≥ 1.10 (less compression) |
| Upset rate (predicted home loses ML pick) | TBD | within 20% of V1's rate |
| Cap-active frequency | n/a | < 15% (cap should bind rarely) |

If V2 fails any criterion, iterate on α weights / threshold tuning / signal residual definitions before cutover. V1 stays in production throughout.

---

## 9. Open questions (require operator decision)

1. **Calibration training set**: when do we have enough historical finalized games to fit α weights? Need at least one full month of finalized scores. Currently 0 in DB.
2. **Post-game-results cron activation**: blocks calibration. Must activate before V2 work can complete.
3. **Sportsbook ML coverage**: Pinnacle is the gold standard for no-vig prob. Do we have it on all games? Audit needed.
4. **Implied home run share table**: empirical mapping needs data. Possible sources: Retrosheet historical scores, Statcast public dumps. Operator to confirm acceptable data source.
5. **Shadow table vs JSONB audit**: which is preferred? JSONB is lighter, fits the current schema.
6. **V2 confidence cap of 80**: matches V1 implicit cap. Should we relax to 85 for strongest Best Angles? Requires calibration evidence.

---

## 10. Rollback path

At any stage:

- **During shadow** (Phase 6B.1): no rollback needed — V2 doesn't affect production. Just delete the new module(s) or stop running shadow mode.
- **After cutover** (Phase 6B.3): single env flip `AUTOMODEL_VERSION=v1`. Production resumes V1 within next cron fire. No DB cleanup needed. Shadow audit retained for post-mortem.
- **Code revert**: `git revert <cutover-commit>`. V1 logic was never modified; safe to revert any single Phase 6B commit independently.

---

## 11. Validation-day positioning

- **Tomorrow (validation day)**: V2 work **does not** ship. Cron infrastructure validates with V1. No model risk.
- **Day +2**: Phase 6B.1 implementation begins. Shadow mode + JSONB audit. No production behavior change.
- **Day +3 to +9**: shadow data accumulates. Nightly backtest. Tune α and thresholds.
- **Day +10**: if calibration criteria met, propose cutover.

This sequence guarantees model changes never share a deploy window with infrastructure changes.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Insufficient calibration training data | Activate post-game-results cron immediately; wait at least 30 days of finalized games before V2 cutover |
| Market data unavailable / stale | Fallback to V1 layered model with audit annotation |
| Over-anchoring to market (V2 mimics market) | Residual cap + α weights from independent baseball signals |
| Under-correction (V2 stays compressed like V1) | Confidence and grade thresholds explicitly calibrated against historical bookmaker outcomes |
| Best Angles too rare | Frequency target 5–10%; adjust grade thresholds if shadow shows <3% Best Angles |
| Best Angles too frequent / low quality | Edge floor + data quality + line sanity guards |
| Cap binds too often (>15%) | Recalibrate residual weights to be more constrained; or raise cap |

---

## End

This doc captures the V2 model direction without committing code. Implementation begins after tomorrow morning's cron validation and once post-game-results data starts flowing.

When implementation begins, this doc becomes the contract: any deviation must update the doc first, then code.
