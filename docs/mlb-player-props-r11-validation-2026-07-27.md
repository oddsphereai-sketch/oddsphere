# MLB player-props r11 validation — 2026-07-27

## Release scope

- Champion: `mlb_props_2026_07_26_r9`
- Candidate: `mlb_props_2026_07_27_r11`
- Sport: MLB
- Markets: all 17 supported batter and pitcher prop markets were examined independently.
- Writer/reader/cron: unchanged. The existing MLB player-props refresh remains the only
  authoritative writer and continues to use the shared sport-scoped `prediction_pipeline`
  lease.
- Tracking: historical rows retain their original release identifiers. r11 does not rewrite,
  unlock, or regrade prior predictions.

## Method

The audit did not blend model eras and call the blend current-model performance.

1. Immutable opening offers through July 23 were joined to official MLB game logs with
   leakage-safe, pregame-only features.
2. The current dedicated Hits and Hits + Runs + RBIs model implementations were replayed
   directly over those offers. The split was chronological: discovery through June 21,
   calibration June 22–30, validation windows July 1–7, July 8–12, and July 16–23.
3. Exact locked r9 rows from July 26 were treated as the untouched external forward check.
4. Probability quality used Brier score, log loss, and calibration gap. Action policies used
   locked prices, flat-price units/ROI, and date-clustered uncertainty.
5. Every supported market received the same audit sequence. A market was left unchanged when
   its own evidence did not support a better live rule.

## Runtime ownership and coherence

The pre-release coherence audit found that several market release labels described later
calibration layers while their runtime core still identified itself as the original
conservative distribution. It also found that the shared model factory exposed batter
fallbacks even though the member board uses a different integrated batter path.

r11 makes ownership explicit:

| Runtime path | Markets owned |
|---|---|
| Real pitcher scorer | Strikeouts, outs, hits allowed, walks, earned runs |
| Dedicated integrated batter scorer | Hits; hits + runs + RBIs |
| Integrated batter scorer | All other currently modeled batter markets |
| Research-only display | Pitcher win, stolen base, first home run |
| Fixture backtest | Pitcher strikeouts and outs only |

The real pitcher factory now returns no batter model, and the real pitcher grouping step
explicitly excludes batter markets. Tests assert those boundaries. Strikeout, walk, and
earned-run version labels now identify the actual core plus its calibration layer rather
than implying a replacement core that does not exist.

## Pitcher deep audit

Opening offers from 186 slate dates in 2025 were reconstructed and joined to official pitcher
game logs. After de-duplication the audit contained 7,266 strikeout, 2,158 outs, 2,113 hits
allowed, 1,675 walks, and 2,109 earned-run outcomes. The untouched 2026 external sets added
610, 585, 603, 589, and 608 outcomes respectively.

- Strikeouts: a market-offset candidate returned +8.3% on 102 actions in the 2025 holdout,
  but reversed to -7.3% on the 2026 external set and had worse external Brier score than the
  no-vig market. It was rejected.
- Outs: the existing peer-consensus compact core remains the champion. Its separate
  7,414-offer robustness audit produced 0.243711 Brier versus 0.244752 for the target-book
  market and corrected the old model's large under bias. No replacement or new Best Angle
  cohort survived.
- Hits allowed: the candidate improved 2025 holdout Brier by 0.001138 but lost that gain in
  2026. No priced action cohort survived.
- Walks: neither probability quality nor action returns beat the market consistently.
- Earned runs: calibration gains changed sign between holdouts, and the apparent actionable
  edge failed later windows. No replacement or Best Angle cohort survived.

The result is intentionally not a universal pitcher rewrite. r11 preserves the proven outs
model and prevents unvalidated pitcher changes from replacing one conservative fallback with
another.

## Market-by-market decision

| Market | r11 decision |
|---|---|
| Pitcher strikeouts | Unchanged. Candidate market-following and side rules failed at least one later window. |
| Pitcher outs | Unchanged. The compact-core model remains the current verified version; broader action policies were unstable. |
| Pitcher hits allowed | Unchanged and non-actionable. No two-sided priced rule survived chronological validation. |
| Pitcher walks | Unchanged. No stable model-side or market-side action cohort. |
| Pitcher earned runs | Unchanged. Probability shrinkage improved some windows but actionable ROI reversed across later windows. |
| Batter strikeouts | Unchanged. Two-way actionable evidence remained too small. |
| Batter hits | Use a 0.30 current-model weight against the no-vig market and retain the validated under sleeve. Qualified ranked Hits unders can be Best Angles. |
| Batter total bases | Unchanged. The existing market-anchored implementation remains the best supported version. |
| Batter home runs | Add a 0.10 reliability weight without changing the validated ranked Lean sleeve or its 0.25u stake. A cap-free replacement was tested and failed future validation. |
| Batter RBIs | Unchanged and watchlist-only. No priced action sleeve validated. |
| Batter runs scored | Unchanged. Retain the validated under promotion path. |
| Hits + runs + RBIs | Use a 0.10 current-model weight. Unsupported native actions are demoted, but the independently validated 1.5-under promotion path remains live. No flip passed. |
| Batter singles | Use a 0.50 market-specific reliability cap. Later chronological action windows were positive and the current r9 external slate improved. |
| Batter doubles | Tighten the existing reliability cap from 0.40 to 0.10. Brier score and log loss improved in calibration, validation, and the external r9 check; the market remains watchlist-only. |
| Batter triples | Unchanged and watchlist-only. Sample and pricing evidence remain insufficient. |
| Batter walks | Unchanged. The proposed tighter cap removed current action without a sufficiently stable replacement. |
| Batter stolen bases | Unchanged and watchlist-only. Battery/attempt context and priced evidence remain insufficient. |

## Best Angle qualification

Best Angle remains evidence-based rather than quota-based.

- Qualified ranked Hits unders retain their existing Best Angle promotion.
- Existing Singles Leans become Best Angles when model probability is at least 62%, calibrated
  edge is at least 8%, expected value is at least 5%, and the price is -200 or better. There
  is no daily or per-game Best Angle cap.
- Pitcher strikeouts and outs retain their existing premium grade path and projection-cushion
  gate, but no additional pitcher cohort passed this audit.

The runtime-aligned Singles reconstruction produced the following result for all qualifiers
at the fixed premium threshold:

| Split | Record | Units | ROI |
|---|---:|---:|---:|
| Discovery | 300-203 | +20.80 | +4.14% |
| Calibration | 145-86 | +23.15 | +10.02% |
| Validation 1 | 84-67 | -1.42 | -0.94% |
| Validation 2 | 85-52 | +13.43 | +9.80% |
| Validation 3 | 96-77 | +0.50 | +0.29% |

Across the post-discovery windows it went 410-282, +35.65 units, and +5.15% ROI. On the
untouched July 24-25 locked live-model rows, the same fixed threshold went 38-22, +5.86 units,
and +9.77% ROI. The grade rule therefore improves the information hierarchy without creating
new bets or changing stakes: it promotes an already-actionable Lean only.

## Current-model reconstruction

The dedicated Hits model's selected 0.30 weight improved Brier score versus the unshrunk
current implementation in every chronological split:

| Split | Rows | Current Brier | r10 Brier | r10 action ROI |
|---|---:|---:|---:|---:|
| Discovery | 4,178 | 0.239099 | 0.235594 | +2.66% |
| Calibration | 2,086 | 0.245321 | 0.241774 | +3.73% |
| Validation 1 | 1,502 | 0.238733 | 0.236696 | +5.14% |
| Validation 2 | 1,339 | 0.244469 | 0.241684 | -1.46% |
| Validation 3 | 1,551 | 0.237833 | 0.234888 | +9.23% |

The existing qualified Hits-under sleeve was then evaluated with the live one-per-game
ranking. Across the 28 post-discovery date clusters it went 117–88, returned +33.46 flat
units (+16.32% ROI), and had a date-clustered 95% ROI interval of +2.68% to +29.29%.
That supports Best Angle status for a row only after it passes the existing Hits-under,
price, best-offer, concentration, freshness, and lineup gates. It does not create a quota:
the July 27 morning slate had no qualifying Hits-under Best Angle at the final preview.

The dedicated Hits + Runs + RBIs model was also reconstructed directly. Market shrinkage
improved Brier score and log loss in all five chronological splits, but no native side,
line, edge, EV, or price cohort selected in discovery stayed profitable in the later
windows. r10 therefore removes the unsupported native action path while preserving the
separately validated 1.5-under promotion.

## Exact current-slate board impact

The final r9 and r10 no-write previews were captured 48 seconds apart. They contained the
same 4,658 rows, 12 games, 17 markets, six books, and no stale prices. No matched offer had
an odds change.

| Grade | r9 | r10 |
|---|---:|---:|
| Best Angle | 0 | 0 |
| Lean | 155 | 131 |
| Watchlist | 1,386 | 1,365 |
| No Play | 1,810 | 1,801 |
| Pending Data | 137 | 133 |
| Research | 1,170 | 1,228 |

There were 43 actionable promotions and 65 actionable demotions, a net change of -22
(-14.2%). The candidate still produced 131 Leans across 12 games and is not a flat board.
The largest intentional removal was 44 unsupported native Hits + Runs + RBIs actions.
Replacement promotions came primarily from Singles (+28), Runs Scored (+12), Hits (+1),
Total Bases (+1), and Walks (+1). Existing HR, pitcher-outs, pitcher-earned-runs, and
pitcher-strikeout action counts were not reduced.

The final r11 no-persist preview contained 4,792 rows across 12 currently posted games, all
17 markets, and six books. It produced 30 Best Angles and 103 Leans, preserving the same 133
total actionable calls. Every Best Angle was an existing Singles Lean that passed the fixed
premium threshold; no Watchlist or No Play was promoted directly. The preview had zero stale
rows, no validation errors, and was publishable. Tracking and persistence were disabled.

## Safety and rollback

- Release and affected per-market identifiers are immutable and bumped.
- No new provider call, writer, timer, database query, retry loop, or concurrent workload was
  added.
- Price, best-offer, lineup, freshness, player, game, and correlation gates remain active.
- Locked rows are untouched.
- Rollback target: `mlb_props_2026_07_26_r9` and the last coherent r9 reader snapshot.
- Roll back for mixed current-slate release identifiers, missing required features shown as
  ordinary No Plays, an unexpected board collapse, writer overlap, snapshot-size failure, or
  disagreement between stored rows and the member snapshot.
