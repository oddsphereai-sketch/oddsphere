# UEFA Champions League replacement candidate — 2026-09-03

## Decision

Prepare UEFA Champions League as a dedicated production competition inside the
existing Daily Edge Soccer family. UCL reuses the EPL score-distribution,
target-excluded evidence, exact-price grade, locked-record, line-history,
member-snapshot, settlement, and tracking architecture. It does not create a
parallel prediction writer or a UCL-only member layout.

## Releases

- model: `ucl_goals_coherent_2026_09_03_r6_authenticated_match_stats_manifest`
- coherent outcome: `ucl_coherent_market_outcome_2026_09_03_r2_independent_regulation_pmf`
- grade policy: `ucl_grade_policy_2026_09_03_r5_calibration_price_unavailable_no_action`
- competition context: `ucl_competition_context_2026_09_03_r2_qualifying_truthful`
- member lifecycle: `ucl_member_snapshot_lifecycle_2026_09_03_r4_et_midnight_matchweek_rollover`
- settlement: `ucl_regulation_settlement_2026_09_03_r3_complete_lock_manifest`
- tracking aggregation: `tracking_aggregate_v7_ucl_complete_manifest_every_reader_2026_09_03`
- history manifest: `ucl_history_manifest_2026_09_03_r1`

## Provider and identity boundary

Ball Don't Lie's purchased product is the dedicated
`https://api.balldontlie.io/ucl/v1` API. It uses the existing server-only
`BALLDONTLIE_API_KEY` and no league identifier. Live testing proved that the
documented plural `seasons[]` and bounded date filters ignored their values.
Production therefore makes one explicit, empirically verified singular
`season=` request for the current season and each historical season and does
not retry either known-bad path. Every read paginates, deduplicates exact match
IDs, rejects conflicting duplicates and every returned-season mismatch, and
fails closed on an empty current season; each historical cohort additionally
requires at least one regulation-final before use. The
provider contract deviation is always present in health telemetry. The production client uses
teams, matches, team-match stats, standings, pregame forms, injuries, lineups,
current odds, and opening odds. SharpAPI uses its verified canonical league
slug `uefa_-_champions_league` and the established event, per-event odds, and
league-splits reads. Empty-team futures shells are ineligible for fixture
matching; full-game market breadth wins duplicate-event selection. Fresh and
cached history must match the frozen 185/126/63 cohort, full match-field
SHA-256, exact 754-row team-stat SHA-256, and ready 189/189 provider telemetry
before it can train. Schema v6 persists no joined training rows; each read
rebuilds them deterministically from authenticated raw matches and stats.
Drift blocks writes/publication and requires a new release. Explicit
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

The UCL-owned independent club PMF is authoritative. All evaluated Match
Result, Total, BTTS and Double Chance quotes and alternative vectors are
excluded from the forecast and retained only as downstream economics and
evidence. All four markets are No Play because calibration-period exact-price
evidence is unavailable, so no promotion rule can be selected before a
one-shot untouched holdout evaluation. No EPL threshold, favorite,
underdog, draw, actionable, or contrarian quota is inherited.

This is a new competition candidate, so there is no prior UCL production board
to demote. The replacement changes the rejected rehearsal's 19 inherited EPL
actionables to zero actionables and 72 No Plays. That earlier rehearsal is
coverage evidence only and is not training, calibration, or accuracy proof.

## Competition and settlement semantics

BDL does not expose an authoritative stage/leg/aggregate field. The context
release classifies July/August as qualifying and the post-2024 autumn/January schedule as league phase and
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
writer implementation used by EPL with a competition configuration. UCL alone
enables prior-priced-tuple and already-locked snapshot repair, so EPL behavior
does not change. Any prior
locked market row blocks every later-release overwrite. A locked member card
publishes only after all four rows match the exact UCL model, calibration and
competition and either match the immutable current response tuple or carry the
precise current-authority row ID returned by the writer's lock-only or repair
path. Every stored scalar must agree with the captured member market. The
published card is reconstructed from each verified DB row's stored member
market, so a fresh missing-price tuple cannot replace a prior priced lock.
The regular refresh performs this same verification for every game at or past
its scheduled T-60 boundary; an incomplete refresh leaves the prior member LKG
untouched. Partial 1–3-market locks enter neither member publication,
settlement, aggregate Tracking, nor the release-pure winner scorecard; every
path waits for the exact same-game/external-event/slate/model/calibration
four-market manifest. Held rows settle void and never enter public W/L. Member requests read
the indexed `soccer::uefa_champions_league::current-week` snapshot only and
make zero provider calls.

A cycle is bounded to three Sharp event catalogs, four narrow market requests
per active match, one league splits read, and at most ten recovery requests,
concurrency three. For the current 18-match slate that is at most 86 logical
Sharp endpoint reads before any provider pagination or one retry on a failed
odds read. The first uncached BDL foundation build uses two separately bounded
singular season scans. Stats are requested in 40-match batches only after the entire history
cohort passes. Eight current-slate endpoint reads remain; cursor pagination can
add HTTP requests. The versioned
persisted foundation stores authenticated raw historical matches and team stats
and deterministically rebuilds joined training rows, so a
later cold refresh avoids the historical scans/batches; the 15-minute process
cache also coalesces warm refreshes. The current cycle proposes at most
36 team upserts, 18 games, 72 prediction records, one member snapshot, and
append-only economic line changes.

## Historical tracking boundary

Production inventory found no row-level UCL games or prediction records. It
found two aggregate-only `tracking_baselines` rows imported from
`oddsphere_tracking_updated_6_2_26.csv`, `model_family=legacy`: moneyline
100/174 lifetime (5/8 current season) and Double Chance 129/174 lifetime (6/8
current season). They remain immutable historical archive rows. Generic soccer
settlement always excludes UCL, while the exact UCL settlement pass runs only
under the master/write gate and requires the complete lock manifest. Forward UCL results are read from shared soccer storage through exact UCL competition
identity, filtered by the exact active model and calibration pair, and gated on
a complete four-market lock manifest before grading, winner-scorecard
reduction, grouping/deduplication, and display;
the tracking reader shows the old aggregate beside them but never arithmetically
blends it into current-release accuracy.
When the master/member gate is off, direct UCL Tracking is unavailable and
all-sport Tracking plus the homepage/public track-record reader exclude
preserved current UCL rows and dynamic baselines while bypassing any
enabled-state snapshot or memory-cache entry. The static legacy archive stays
visible with its historical provenance; an inseparable mixed current composite
fails closed.

## Rollback and risks

Disable `UCL_PIPELINE_ENABLED` to remove member/API/navigation exposure and
stop providers, writes, publication, foundation writes, locks, and settlement;
sub-switches can narrow but never bypass the master gate. Disable
`CHAMPIONS_LEAGUE_DAILY_EDGE_ENABLED` to remove member routing;
disable `UCL_PUBLICATION_ENABLED`, `UCL_LOCK_CRON_ENABLED`, or
`UCL_CRON_ENABLED` to stop later publication/lock/refresh stages. Locked rows
remain immutable under every rollback. Current risks are BDL pregame
odds/forms not appearing until near kickoff, Sharp duplicate/alias coverage,
provider round numbers being incomplete, and older AET/Pen rows missing period
scores. Each risk fails to a labeled empty, hold, or pending state. Degraded
historical foundation health blocks writes/publication and preserves the
last-known-good snapshot.

At the September 3 rehearsal, BDL current-season fixture coverage was ready while recent stat
and xG team coverage were each 50%; historical complete-xG coverage was 49.73%.
BDL current/opening 1X2 remained pending/unavailable. Sharp supplied 55/72
selected quotes and 138/180 required outcome quotes. The UCL coverage gate
therefore publishes all 18 coherent forecasts while holding the 17 unpriced
markets as No Play. Historical validation is separately blocked because the
live UCL endpoint returned season 2026 for every plural 2024/2025 request,
including `seasons[]`, while the documented bounded date requests returned 2011.
The owner-approved empirical singular requests then returned 189 strict rows
for each season and 754 team-stat rows. The predeclared replay used 185 training,
126 calibration, and 63 untouched holdout matches. Holdout Match Result
accuracy/Brier/log loss were 52.38%/0.19890/0.99638; Total Brier/log loss were
0.22968/0.65323; BTTS Brier/log loss were 0.23845/0.66943; team-score MAE was
1.18637. The provider deviation remains visible, and all four markets remain
explicit No Play because calibration-period exact-price coverage is 0/126, so
no promotion threshold can be selected. Untouched holdout quote coverage is
54/63, but its outcomes remain unused because the calibration gate failed.
Those quotes cannot be manufactured or replaced by
incomplete/futures shells; coverage remains an explicit operational warning.
