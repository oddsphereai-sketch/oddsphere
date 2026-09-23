# MLB Player Props accuracy-marriage result

Date: 2026-09-23
Base: `a1e1b0f6abc69de7f38b84c6832f32533c220d41`
Predeclaration: `docs/model-audits/2026-09-23-mlb-player-props-accuracy-marriage-predeclaration.md`

## Decision

Keep the active complete release `mlb_props_2026_09_21_r43` and market-context release
`mlb_props_market_aware_context_2026_09_02_r2_target_excluded_forecast` unchanged. The current
model/market marriage is healthy and materially improves whole-board probability quality. The
observed Under concentration is currently accuracy-accretive; adding Over quotas or weakening
validated Unders would make the model worse.

## Release-pure evidence

For r42, using the frozen chronological windows:

- through September 11, the final posterior produced Brier 0.21946 versus 0.22613 for the
  independent model and 0.24308 for the target-excluded market;
- September 12-16 selection produced Brier 0.22113 versus 0.22841 model and 0.24018 market;
- September 17-20 confirmation produced Brier 0.21556 versus 0.22230 model and 0.24468 market.

That is direct evidence that the final probability is not a market echo and that combining the
independent projection with target-excluded prices, movement, matchup inputs, and verified context
improves calibration. The r42 confirmation actionable cohort finished 284-178 (61.5%). The current
r43 settled actionable cohort is 91-50 (64.5%): Unders are 87-39 (69.0%), while the small Over
cohort is 4-11.

The weak Over observations are concentrated in Home Run milestones and pitcher strikeouts. Home
Run milestones cannot be judged by raw hit rate alone because the positive prices change the
break-even threshold. Pitcher-strikeout Over and Home Run Over already have bounded model-weight
caps, target-excluded comparisons, exact-price economics, and portfolio limits. No Watchlist
promotion family cleared selection and confirmation strongly enough to pair with further
demotions, so no board-flattening change is authorized.

## Current live-data proof

A same-day read-only full refresh at `2026-09-23T15:46:42.429Z` returned 24,330 source rows with
24,330 mapped rows, 6,020 board rows, 5,617 forecasts, 16 games, six books, 17 markets, and zero
stale odds. Of those forecasts, 4,963 use target-book-excluded market references and 654 use the
independent fallback. All 119 actionables had a target-excluded reference and zero failed the data
gate. The snapshot was publishable with no validation error; three consecutive persisted snapshots
were valid and the persisted production snapshot matched r43.

The five telemetry projection exceptions are intentional one-sided Home Run milestone rows, whose
event-value semantics are explicitly exempt from an ordinary two-way mean/line check. Ordinary
two-way projection contradictions remain fail-closed at Watchlist.

The authoritative writer remains `/api/cron/mlb-player-props-refresh` through
`refreshMlbPropsBoard` under `prediction_pipeline:mlb`. Provider budgets, publication, locking,
settlement, stakes, tracking history, UI copy, labels, and layout are unchanged.
