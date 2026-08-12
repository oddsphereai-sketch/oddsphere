# MLB Player Props shared pitcher shadow r1

Date: 2026-08-12

## Decision

Begin prospective feature collection for a pitcher-strikeout challenger without changing any
member-visible projection, probability, side, grade, stake, or actionability rule. Pitcher outs
are recorded as the existing peer-consensus control while the next action-policy challenger is
developed separately.

The active bundle is now `mlb_props_2026_08_12_r29`. The new immutable shadow identifiers are:

- Shadow release: `mlb_props_shadow_pitcher_2026_08_12_r1`
- Feature contract: `mlb_props_shared_pitcher_features_v1_2026_08_12`

## Data path

The existing authoritative `/api/cron/mlb-player-props-refresh` writer already loads pitcher
arsenal, opponent profile, recent form, park, weather, probable-pitcher, price, and workload
evidence under the shared MLB `prediction_pipeline` lease. The shadow path reuses those cached
inputs. It adds no provider request, writer, cron, or user-time computation.

The prior active pitcher context exposed only opponent strikeout rate, opponent OPS, park, and
weather even though the research bundle also contained opponent walk rate, batting average,
home-run rate, and pitcher pitch-type results. Shadow r1 freezes those additional fields and
usage-weighted arsenal whiff, chase, zone, batting-average-allowed, and xwOBA-allowed measures.

At every authoritative T-60 tracking lock, the shadow release, probability, projection, feature
contract, compact feature snapshot, and missing-feature findings are stored in the existing
tracking metadata. Missing required evidence fails closed as `insufficient_features`; it never
becomes a shadow prediction through a fallback constant.

## Strikeout challenger

The prospective candidate separates opportunity from event rate:

1. Expected batters faced blends current-season and recent workload, with a bounded pitch-count
   adjustment.
2. Strikeout rate uses the verified recent batters-faced exposure with empirical-Bayes shrinkage
   toward the contemporaneous league rate, then blends the longer-term rate. When the upstream
   season payload lacks official batters faced, that longer-term rate is explicitly stamped as
   `innings_proxy` rather than misrepresented as an official exposure.
3. Opponent strikeout tendency and usage-weighted pitcher whiff quality make bounded adjustments.
4. The count probability uses a beta-binomial distribution to retain rate uncertainty instead of
   the active Poisson count shortcut.

The coefficients are frozen for prospective evaluation, not approved production parameters.

A prior-only retrospective audit subsequently tested the opportunity/rate family on 506 unique
locked observations. The validation-selected candidate was evaluated on 345 untouched holdout
observations and did not beat the market: Brier `0.245609` versus `0.244551`, log loss `0.684348`
versus `0.682200`, and 55% selected-side hit rate `59.2%` versus `61.5%`. The independent-only
form was materially worse (`0.266785` Brier, `0.730744` log loss, `50.6%` hit rate). Therefore r1
is only a prospective feature-collection instrument; it is not a promotion candidate. Opponent
and arsenal modifiers were excluded from the retrospective claim because historically frozen
values do not exist.

## Promotion requirements

No live change is authorized by this commit. A later release must:

- accumulate settled T-60 shadow observations across enough slate-date, game, and pitcher clusters;
- use chronological discovery, calibration, and untouched holdout windows;
- beat both r28 and the de-vig locked market on Brier score and log loss;
- report selected-side hit rate, break-even rate, locked-price units/ROI, calibration gap, and
  price/line/side cohorts;
- pair every actionable demotion with a tested promotion and report the exact board-count impact;
- bump the active model release and affected market version only if all production gates pass.

Until then, r1 is evidence collection only.
