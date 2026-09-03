# UEFA Champions League production launch — 2026-09-03

## Decision

Launch UEFA Champions League as a dedicated production competition inside the
existing Daily Edge Soccer family. UCL reuses the EPL score-distribution,
target-excluded evidence, exact-price grade, locked-record, line-history,
member-snapshot, settlement, and tracking architecture. It does not create a
parallel prediction writer or a UCL-only member layout.

## Releases

- model: `ucl_goals_coherent_2026_09_03_r1_cross_league_regulation`
- coherent outcome: `ucl_coherent_market_outcome_2026_09_03_r1_target_excluded`
- grade policy: `ucl_grade_policy_2026_09_03_r1_positive_forecast_ev`
- competition context: `ucl_competition_context_2026_09_03_r1`
- member lifecycle: `ucl_member_snapshot_lifecycle_2026_09_03_r1`
- settlement: `ucl_regulation_settlement_2026_09_03_r1`
- tracking aggregation: `tracking_aggregate_v3_ucl_release_separated_competition_2026_09_03`

## Provider and identity boundary

Ball Don't Lie's purchased product is the dedicated
`https://api.balldontlie.io/ucl/v1` API. It uses the existing server-only
`BALLDONTLIE_API_KEY` and no league identifier. The production client uses
teams, matches, team-match stats, standings, pregame forms, injuries, lineups,
current odds, and opening odds. SharpAPI uses its verified canonical league
slug `uefa_-_champions_league` and the established event, per-event odds, and
league-splits reads. Empty-team futures shells are ineligible for fixture
matching; full-game market breadth wins duplicate-event selection. Explicit
club aliases cover provider naming differences without fuzzy cross-fixture
substitution.

UCL team and match IDs occupy `[30,000,000, 40,000,000)` in the shared soccer
tables. EPL settlement is now explicitly bounded below that namespace. Every
UCL record also carries `snapshot_json.competition=uefa_champions_league`.

## Forecast and grade contract

One Dixon–Coles score PMF supplies regulation-time expected goals, likely and
representative score, three-way Match Result, Double Chance, Total 2.5, BTTS,
and winner/draw probabilities. The common club-strength scale is fit across
UCL entrants and seasons. Versioned modifiers cover only evidenced neutral
venue, UCL-schedule rest/congestion, and away travel derived from provider
venue coordinates. The evidence scope is explicitly `ucl_schedule_only`; the
model does not pretend that the UCL feed contains domestic-match congestion.

As with EPL, the independent club PMF is authoritative unless fresh complete
alternative Total vectors pass target-exclusion, distinct-family,
distinct-quote, and unanimous-direction gates. The evaluated Match Result,
Total, and BTTS books are excluded from forecast evidence. The selected quote
is downstream economics only. Best Angle and Lean require a positive expected
value at that exact selected price. Double Chance remains forecast-anchored
and non-actionable. No favorite, underdog, draw, or contrarian quota exists.

This is a new competition launch, so there is no prior UCL production board to
demote. The promotion/demotion baseline is therefore zero prior actionables;
every new actionable is a launch addition and no existing EPL or World Cup
selection changes. The September 3 bounded read-only rehearsal found 18
fixtures/72 markets: 3 Best Angles, 16 Leans, 18 Watchlists, and 35 No Plays.
All 19 actionables had positive exact-quote EV and all 18 games had coherent
1X2, Total, and BTTS probability sums. This is 19 launch additions, zero
demotions, and zero cross-competition board changes—not a historical accuracy
claim.

## Competition and settlement semantics

BDL does not expose an authoritative stage/leg/aggregate field. The context
release classifies the post-2024 autumn/January schedule as league phase and
recognizes a two-leg tie only when the same unordered club pair appears twice
with reciprocal home/away identity. The second-leg aggregate uses only the
stored first-leg regulation score and is oriented to the current home/away
clubs. Final/neutral context requires the one-match late-season topology;
unknown evidence stays unknown. Advancement is always false because the
current Daily Edge board evaluates match markets, not qualification markets.

Match Result, Double Chance, Total, and BTTS settle after 90 minutes. Ordinary
FT uses the provider final score. `AET` and `FT-Pens` use first-half plus
second-half components. A special final missing those components remains
scheduled/pending and is reported as a settlement hold; the post-extra-time or
shootout score is never substituted. Raw provider status, provider final
score, derived regulation score, source, and settlement release are retained
in the existing `games.inning_scores` JSONB audit field.

## Writer, member, and cost contract

`ucl-daily-refresh` and `ucl-pregame-lock` both run as `sport=soccer` under the
shared `prediction_pipeline` lease. They call the same soccer prediction-row
writer implementation used by EPL with a competition configuration. Any prior
locked market row blocks every later-release overwrite. Member requests read
the indexed `soccer::uefa_champions_league::current-week` snapshot only and
make zero provider calls.

A cycle is bounded to three Sharp event catalogs, four narrow market requests
per active match, one league splits read, and at most ten recovery requests,
concurrency three. For the current 18-match slate that is at most 86 logical
Sharp endpoint reads before any provider pagination or one retry on a failed
odds read. The first uncached BDL foundation build uses two season scans, ten
40-match stats batches for the current 378-match history, and eight current-
slate endpoint reads; cursor pagination can add HTTP requests. The versioned
persisted foundation stores both raw historical matches and joined stats, so a
later cold refresh avoids the historical scans/batches; the 15-minute process
cache also coalesces warm refreshes. The current cycle proposes at most
36 team upserts, 18 games, 72 prediction records, one member snapshot, and
append-only economic line changes.

## Historical tracking boundary

Production inventory found no row-level UCL games or prediction records. It
found two aggregate-only `tracking_baselines` rows imported from
`oddsphere_tracking_updated_6_2_26.csv`, `model_family=legacy`: moneyline
100/174 lifetime (5/8 current season) and Double Chance 129/174 lifetime (6/8
current season). They remain immutable historical archive rows. Forward UCL
results are keyed by exact release and displayed as current-release results;
the tracking reader shows the old aggregate beside them but never arithmetically
blends it into current-release accuracy.

## Rollback and risks

Disable `CHAMPIONS_LEAGUE_DAILY_EDGE_ENABLED` to remove member routing;
disable `UCL_PUBLICATION_ENABLED`, `UCL_LOCK_CRON_ENABLED`, or
`UCL_CRON_ENABLED` to stop later publication/lock/refresh stages. Locked rows
remain immutable under every rollback. Current risks are BDL pregame
odds/forms not appearing until near kickoff, Sharp duplicate/alias coverage,
provider round numbers being incomplete, and older AET/Pen rows missing period
scores. Each risk fails to a labeled empty, hold, or pending state.

At the September 3 rehearsal, BDL fixture coverage was ready while recent stat
and xG team coverage were each 50%; historical complete-xG coverage was 49.73%.
BDL current/opening 1X2 remained pending/unavailable. Sharp supplied 55/72
selected quotes and 138/180 required outcome quotes. The UCL coverage gate
therefore publishes all 18 coherent forecasts while holding the 17 unpriced
markets as No Play. Those quotes cannot be manufactured or replaced by
incomplete/futures shells; coverage remains an explicit operational warning.
