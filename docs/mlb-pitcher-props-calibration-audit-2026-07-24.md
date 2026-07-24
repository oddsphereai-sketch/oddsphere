# MLB pitcher props calibration audit — 2026-07-24

## Decision

Do not change live pitcher probabilities, grades, or stakes from this audit. Keep the public model on `mlb_props_2026_07_24_r6`.

The audit found a narrow pitcher-outs under-side problem worth monitoring, but the available immutable tracking history covers only eight slates, and the untouched holdout covers only July 22–23. That is not enough independent evidence to promote a behavioral model change under the repository's model-change safety protocol.

This release adds only private observability and future evidence retention:

- T−60 tracking rows retain projection, projection source, model-input warnings, and an evidence schema identifier.
- The private props control room reports pitcher calibration by release, market, and selected side.
- Independent-model, no-vig-market, and final-probability Brier score, log loss, average probability, calibration gap, side mix, and CLV are shown separately.

No writer, cron, lease, public reader, probability, grade, or stake behavior changes.

## Runtime and release controls

- Authoritative writer: `refreshMlbPropsBoard`, invoked by `/api/cron/mlb-player-props-refresh`.
- Shared writer lease: sport-scoped `prediction_pipeline:mlb`.
- Tracking lock: one immutable best row per game, player, and market at T−60.
- Current public model release: `mlb_props_2026_07_24_r6`.
- Tracking policy release is intentionally unchanged. Bumping it mid-slate would create a second tracking identity for unchanged decisions.
- Historical releases are diagnostics only. Current-release performance is always evaluated separately.

## Available evidence

The immutable ledger contained 782 pitcher rows, 765 settled, from July 16–23. The chronological audit used July 16–21 for candidate selection and kept July 22–23 untouched as the holdout.

The foundation archive tables (`prop_markets`, `prop_odds_snapshots`, `prop_results`, `feature_snapshots`, `prop_edges`, and `recommended_bets`) contained no usable historical rows for replaying this model. The older `prop_predictions` rows did not preserve sufficient odds and feature fidelity. Therefore, there is no second independent holdout.

## Findings

Across all tracked pitcher rows:

- Selected side mix was 399 overs and 383 unders (48.98% unders), so there is no global tendency to select unders.
- Overs went 216–175 (55.24%); unders went 193–181 (51.60%).
- Flat one-unit ROI was −1.29%.
- Independent-model Brier score was 0.2611, no-vig market was 0.2481, and final probability was 0.2510.
- Average same-book, same-line CLV was effectively zero (+0.018 probability points).

The clearest directional issue was pitcher outs:

- 60.14% of selections were unders.
- Overs went 37–20 (64.9%); unders went 37–47 (44.05%).
- Actual over frequency was 59.57%, versus 51.49% from the independent model and 50.02% from the market.

Pitcher strikeouts did not show an overall under-selection bias: only 40.36% of selections were unders. However, over selections performed materially better than under selections in this short sample. Pitcher walks appeared over-biased, but walks remain research/watchlist-only and are not an actionable market.

## Chronological candidate replay

A training-only grid search suggested removing independent-model weight from pitcher-outs unders. On the untouched July 22–23 holdout:

- Current outs calibration: 15 actionables, 5–10, −26.6% flat ROI, 0.2393 Brier.
- Candidate with outs-under model weight set to zero: 7 actionables, 4–3, +23.0% flat ROI, 0.2137 Brier.
- The candidate demoted eight outs unders; those rows went 1–7.

That change alone fails the required promotion/demotion balance because it removes eight board entries without a tested replacement. Relaxing positive-edge thresholds for strikeout overs and outs overs could numerically replace the eight rows, and those promoted holdout rows went approximately 5–3. But this relies on only two slates, near-zero CLV, and very small edges. It remains a shadow candidate, not a defensible live rule.

## Research synthesis

Pitcher strikeout and walk rates become informative sooner than many traditional pitching outcomes, but stabilization is not the same as prediction. Baseball Prospectus' reliability work places strikeout rate in the relatively fast-stabilizing group and walk rate later, while explicitly warning against treating stabilization thresholds as automatic forecasting rules:

- https://legacy.baseballprospectus.com/article_legacy.php?articleid=14293
- https://legacy.baseballprospectus.com/article_legacy.php?articleid=20516

Batter-pitcher matchup work supports combining pitcher and batter tendencies rather than relying on a pitcher-only average:

- https://arxiv.org/abs/1706.10272
- https://blogs.fangraphs.com/bettermatch-up-data-forecasting-strikeout-rate/

Count outcomes can be overdispersed relative to a Poisson model. Negative-binomial or hierarchical count models should be evaluated when the locked feature archive is deep enough for chronological comparison:

- https://scholarworks.wmich.edu/dissertations/1166/
- https://academic.oup.com/biometrics/article/65/4/1254/7333505
- https://www.tandfonline.com/doi/abs/10.1080/00031305.1996.10473565

Held-out baseball forecasting research also supports empirical-Bayes shrinkage over naive current averages:

- https://arxiv.org/abs/0803.3697

The practical next model candidate should therefore be plate-appearance/workload aware, combine pitcher and opposing-lineup strikeout tendencies, shrink small samples hierarchically, and compare Poisson with negative-binomial predictive distributions. It must be tested chronologically against both the current model and no-vig market.

## Promotion gates for a live change

A pitcher calibration candidate may leave shadow mode only after:

1. At least ten additional independent slates are locked with the evidence-v2 schema.
2. The target market and side have at least 150 settled observations, with uncertainty clustered by game and player.
3. A chronological untouched holdout improves Brier score and log loss versus both the current release and no-vig market.
4. Same-book, same-line CLV is positive and directionally consistent.
5. Every actionable demotion is paired with a tested actionable promotion rule, with explicit board-count and side-mix impact.
6. The release identifier is bumped and all focused/model-safety tests pass.
7. The existing writer, shared lease, refresh cycles, overrides, and reader snapshot remain the single authoritative runtime path.

## Rollback

The deployed change is additive private reporting and tracking metadata. Rollback consists of reverting the reporting/evidence commit. Existing immutable ledger rows remain valid, and the public r6 model remains unchanged.
