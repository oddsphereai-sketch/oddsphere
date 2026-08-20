# EPL forecast-first and line-history release v14

## Scope

- Runtime/model release is `epl_club_dixon_coles_2026_08_19_r9`; its probability core is unchanged r8.
- Calibration/runtime release is `epl_grade_policy_2026_08_19_v14`.
- Match Result selection and grade semantics change; r8 probabilities and score projections do not. The new model identifier prevents the v14 writer from overwriting v13 records because model release is part of the prediction-record uniqueness key.
- The existing `epl-daily-refresh` and targeted `epl-pregame-lock` routes remain the only writers, under the shared soccer `prediction_pipeline` lease.
- Provider cadence and call counts are unchanged. The new database work is bounded to one current-slate read and one bulk insert of changed economic quotes per writer run.

## Confirmed production defects

The v13 Match Result rule selected the largest model-minus-market outcome as the public pick. That allowed a less-likely price-value side to replace the forecast. The live slate therefore presented Hull instead of model-favored Man United, Palace instead of model-favored Everton, and Fulham instead of model-favored Chelsea. This contradicted OddSphere's prediction-first product contract.

The price trail also treated a changed provider timestamp as movement even when American odds, line, and sportsbook were unchanged. Arsenal consequently displayed repeated -700 rows as though the quote moved. No -600-range Arsenal record was recoverable from the production member snapshot, versioned prediction record, `line_history`, or a Sharp `/odds/delta` query beginning 2026-08-18. v14 does not fabricate that missing observation.

## Forecast-first rule

The headline Match Result side is always `argmax(P(home), P(draw), P(away))`. Price remains secondary grading evidence:

- Best Angle requires the forecast side itself to have at least +5pp de-vigged edge, price longer than -300, and full club history.
- Winner-confidence Lean and expensive-favorite Lean remain forecast-side rules.
- Forecast-side edge of at least +2pp may receive Watchlist.
- A value side that differs from the forecast stays visible in the three-way market table but cannot replace or promote the prediction.
- Any absolute three-way model-market gap above 20pp is No Play and a calibration/data hold.

Historical opening-price replay supports the retained actionable path. Forecast-aligned +5pp outcomes returned +4.139u over 58 calibration plays (+7.14% ROI) and +0.852u over 15 final-holdout plays (+5.68% ROI). Forecast-opposed +5pp outcomes lost -0.800u over 67 calibration plays (-1.19% ROI); their +5.500u result over only 11 final-holdout plays was unstable and does not override the earlier loss.

## Draw audit

Across the 380-match chronological 2025–26 replay, raw r8 argmax accuracy was 48.68%, but it selected zero draws while 104 matches drew (27.37%). Draw probabilities were meaningful rather than absent: the 20–30% band had a 27.13% actual draw rate, and the 30–40% band had a 34.62% actual draw rate. The current limitation is outcome selection, not missing draw probability.

Three candidate families were rejected:

1. World Cup-style expected-goal margin bands materially reduced accuracy in the 285-match calibration block.
2. A 1.20 draw multiplier created 7 calibration and 2 holdout draw picks, but worsened calibration Brier from 0.61010 to 0.61160 and log loss from 1.01716 to 1.01904; the draw sample was too small.
3. Multiclass recalibration trained on 2024–25 produced no draw picks and worsened 2025–26 Brier/log loss across tested regularization values.

No draw-specific selection rule is promoted in v14. Draw remains a first-class probability and can become the forecast only when the released probability model ranks it first.

## Board impact and current dry run

The genuine 10-fixture v14 dry run produced:

- Match Result: 3 Best Angles, 2 Leans, 1 Watchlist, 4 No Plays.
- All 40 markets: 3 Best Angles, 2 Leans, 6 Watchlists, 29 No Plays.
- Forecast sides: 7 home, 3 away, 0 draw.
- Price coverage: 40/40 selected rows and 100/100 complete outcome rows.

Versus the contemporaneous v13 board, two forecast-opposed Best Angles are demoted and no new actionable row is invented. The paired promotion candidate is the forecast-aligned +5pp rule above; it passed both chronological partitions and retains three current Best Angles. Net current actionable impact is -2 and is intentional, explicit, and founder-requested rather than a hidden flat-board side effect.

## Durable line history

v14 stores only a change in American odds, tracked line, or sportsbook. A timestamp-only refresh is ignored, and timestamp identity is normalized to milliseconds before deduplication so Postgres precision and timezone formatting cannot replay an existing stop. Current-slate rows are read before assembly so real movement survives cold starts, releases, and member-snapshot replacement. The read is capped at the latest 800 rows (eight retained stops for each of 100 outcomes); a new slate normally writes one initial row per outcome, and later writes include only changed outcomes. A line-history error blocks publication and preserves the last coherent member snapshot.

Rollback is calibration v13 plus the prior member snapshot. r8 probabilities remain compatible in either direction.
