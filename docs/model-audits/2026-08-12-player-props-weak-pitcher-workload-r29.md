# MLB Player Props weak pitcher workload guard r29

Date: 2026-08-12

## Decision

Release `mlb_props_2026_08_12_r29` corrects mixed starter/reliever workload identity and uses the
de-vig target-book market as a non-actionable strikeout control when the independent starter
baseline is explicitly weak. Established pitcher models and all hitter markets are unchanged.

Affected market versions:

- `pitcher_strikeouts_distribution_v6_weak_baseline_market_control`
- `pitcher_outs_peer_consensus_compact_core_v6_mixed_role_workload_guard`

## Root cause

The feature builder treated all season innings as starter innings and divided them by games
started. Mason Barnett had two starts, 16 total appearances, and 34 innings. Dividing 34 innings
by two starts implied 51 outs and roughly 72 batters faced per start, producing a 16.4 strikeout
projection on a 3.5 line. His official result was zero strikeouts. The row was non-actionable but
the displayed prediction was materially wrong.

r29 uses season-per-start workload only with at least five starts and a starter share of at least
50%. Otherwise it uses official recent-start outs and batters faced; if those are unavailable it
falls back to conservative per-appearance workload. Weak-baseline strikeout rows remain blocked
from stakes and use the de-vig market side/probability instead of allowing the unreliable
independent model to pull the displayed probability away from consensus.

## Chronological evidence

The read-only audit used immutable locked tracking probabilities and official starter logs dated
strictly before each game. A grid was selected only on July 22-25 and evaluated on the untouched
July 26-August 11 holdout.

- Full holdout: 345 observations across 17 dates.
- Market: Brier `0.244551`, log loss `0.682200`, hit rate at 55% `61.5%`.
- r28 active: Brier `0.247490`, log loss `0.688193`, hit rate at 55% `59.1%`.
- Opportunity/rate challenger: rejected at Brier `0.245609`, log loss `0.684348`.
- Independent-only opportunity model: rejected at Brier `0.266785`, log loss `0.730744`.

The predeclared weak-baseline cohort contained 21 holdout observations across 10 dates:

- Market control: Brier `0.232115`, log loss `0.657115`, 55% hit rate `66.7%`.
- r28 active: Brier `0.254888`, log loss `0.703085`, 55% hit rate `47.1%`.

The established-baseline cohort was much closer: market and r28 hit rates were `61.0%` and
`60.6%`, respectively. Therefore the control is scoped only to explicitly weak pitcher
baselines, not applied across the entire strikeout market.

## Safety and board policy

Weak-baseline rows were already forced to no-play by `LOW_DATA_CONFIDENCE`, so the control cannot
create a promotion, stake, or actionable recommendation. The August 12 paired current-slate audit
contained 15 matched weak strikeout rows: 12 changed probability and 13 changed projection, with
zero weak-baseline actionable promotions and zero weak-baseline actionable demotions. The broader
r28 snapshot versus fresh r29 rebuild had 114 retained, five promoted, and 12 demoted actionables,
but also 151 additional offers and 992 unmatched prior rows as the live market advanced; those
uncontrolled whole-board movements are not attributed to r29. The scoped affected cohort had an
exact actionable delta of zero.

The shadow feature collector remains non-production and is explicitly rejected as a promotion
candidate until prospective opponent/arsenal evidence exists.
