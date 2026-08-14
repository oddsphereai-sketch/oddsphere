# Current MLB and WNBA model releases

This file is the human-readable production handoff registry. Runtime constants and stamped
prediction snapshots remain the machine authority. Future model work must start here, verify the
constants, and preserve the precedence and writer ownership below.

Last reviewed: 2026-08-14

## MLB champion

- Projection runtime: resolved automodel `v2_2`
- First-inning runtime: `fi_v2` with the versioned unpublished-probable availability head below
- Public calibration: `mlb_public_calibration_v19_guarded_signed_market_evidence_2026_08_10`
- Decision release: `mlb_daily_edge_decision_2026_08_14_r46`
- Rule bundle: `mlb_daily_edge_rule_bundle_v45_2026_08_14`
- Grade policy: `mlb_public_grade_policy_v36_first_inning_board_endpoint_coherence_2026_08_14`
- Tracking contract: `member_facing_lock_v8_priority_retry_minute_cadence_2026_08_11`
- Machine registry: `lib/automodel/mlbModelLayerVersions.ts`
- Authoritative member-facing writer: `lib/services/predictionRecordService.ts`

Moneyline precedence is immutable unless a later versioned release explicitly replaces it:

The August 14 r43 completion release expands SharpAPI event discovery to the
union of the verified `+EV` and `low_hold` feeds, then directly probes
deterministic provider event IDs for any game still missing from the
authoritative database slate. This restores current event odds even when no
qualifying opportunity row exists at a poll. The r42 aggregate-splits
slate-identity guard remains in force; mismatched SharpAPI public percentages
are never used. See
`docs/model-audits/2026-08-14-mlb-complete-sharpapi-event-discovery-r43.md`.

The August 14 r44 reader-coherence release makes MLB first-inning Market Read
consume the same selected-side, same-book price trail displayed in the
two-sided NRFI/YRFI movement tracker. It removes the first-inning exception
from the existing visible-odds alignment path without changing its movement
thresholds, prediction side, probability, projection, writer ownership, or
stake. The authoritative stored prediction grade remains authoritative; the
paired current-board impact is zero promotions and zero demotions. Evidence
and rollback details are recorded in
`docs/model-audits/2026-08-14-mlb-first-inning-market-read-alignment-r44.md`.

The August 14 r45 rendered-coherence follow-up removes the redesigned reader's
independent 1.25-point movement cutoff when the canonical Market Read endpoints
exactly match the visible same-book trail. The renderer now consumes the
versioned canonical direction in that case, preventing contradictory copy such
as “effectively flat” beside “Slight Market Resistance.” It changes no odds,
threshold in the authoritative classifier, prediction, grade, side,
probability, projection, or stake. Evidence is recorded in
`docs/model-audits/2026-08-14-mlb-first-inning-rendered-market-read-r45.md`.

The August 14 r46 endpoint-coherence follow-up recognizes a verified 0.5-run
NRFI/YRFI board even when the canonical Market Read omits redundant line-number
fields. Exact selected-side first/current price equality remains required.
Full-game totals and spreads retain strict point-line matching. This changes no
prediction, grade, side, probability, projection, stake, or movement threshold.
Evidence is recorded in
`docs/model-audits/2026-08-14-mlb-first-inning-board-endpoint-coherence-r46.md`.

1. Existing inversion logic.
2. Existing pick calibration.
3. Existing market-aware side correction.
4. Freeze the final side and its price/probability tuple.
5. Apply signed money-minus-ticket evidence only to the grade on that frozen side.

The signed rule never flips a side. A picked-side gap of at most -10 points stands down an
otherwise unchanged action. A gap of at least +10 may promote a Watchlist to Lean only with at
least 54% picked-side model probability, a real selected-side price, no opposing movement or
public conflict, complete data, and no prior side change. It never creates a Best Angle.

Historical paired replay: 282 actions at -1.5% ROI became 285 at +9.3%; the holdout moved from
47 at +11.9% to 53 at +18.9%. The guarded promotion cohort was 67 plays at +29.4%; the demotion
cohort was 64 plays at -17.1%. Board delta: +3.

The August 11 r29 totals correction policy keeps every historically unstable opposite-side
correction candidate rejected and hidden. A rejected candidate no longer automatically stands
down the original model side. The original side is restored and must independently pass the
existing price, positive-EV, projection-alignment, probability, data-quality, and validated-grade
gates. The forward correction audit found that the prior blanket stand-down removed nine original
sides that went 7-2 (+4.04 units, +44.9% ROI), while the rejected candidates went 2-7 (-5.09
units, -56.6% ROI). The paired current-slate replay and rollback evidence are recorded in
`docs/model-audits/2026-08-11-mlb-totals-rejected-correction-original-side-r29.md`.

The August 11 r30 grade policy adds one additive full-game Total Lean sleeve found by a nested
walk-forward market search: a high-quality, projection-aligned Under with at least 55% model
probability, nonnegative but sub-5-point offered-price edge, a price from -145 through -105,
at most 35% of tickets, and picked-side money at least five points below picked-side tickets.
Those two split fields must come from the SharpAPI sharp-adjacent source on which the sleeve was
validated; a consensus/Playbook row cannot activate it.
It never changes the selected side, probability, projection, price, Best Angle status, or stake;
missing/stale data and every existing no-bet gate retain priority. The member board gains a Lean
only when this complete joint configuration is present. The current August 11 slate has zero
qualifiers, so r30 changes no current recommendation while enabling the validated future sleeve.
Evidence and rollback details are recorded in
`docs/model-audits/2026-08-11-mlb-total-under-low-ticket-resistance-r30.md`.

The August 11 r33 source-alignment release fixes a pre-activation contract mismatch discovered by
the broader sharp-decision audit. The r30 Under sleeve was validated on latest-at-lock SharpAPI
splits, while its first implementation read the legacy aggregate split row. r33 reads the frozen
source-aware SharpAPI pair directly and fails closed when that provider is absent. The August 11
board still has zero qualifiers for this sleeve, so the correction changes no current pick or
grade. Full evidence and rollback details are in
`docs/model-audits/2026-08-11-mlb-total-under-sharpapi-source-alignment-r33.md`.

The August 11 r34 source-alignment release extends that exact-provider contract to the two
Moneyline decisions that were also validated on reconstructed SharpAPI observations: the signed
money-minus-ticket promotion/stand-down and the r32 slate portfolio ranker. They now read the
selected-side SharpAPI pair from the frozen source-aware snapshot and fail closed when that pair
is absent; Playbook or the legacy aggregate row cannot substitute. This does not change the
older market-correction and conflict rules that were designed around their existing aggregate
input. Evidence and rollback details are recorded in
`docs/model-audits/2026-08-11-mlb-moneyline-sharpapi-source-alignment-r34.md`.

The August 11 r35 grade-policy release makes the existing low-ticket Total Under sleeve genuinely
market anchored. The same validated SharpAPI split, Under side, -145 through -105 price, at-most
35% ticket share, five-point money-below-tickets gap, high data quality, and projection-alignment
requirements remain. Model probability and model-versus-price edge remain visible context but no
longer veto this market-defined sleeve: the rows they excluded went 8-1 across seven dates and
were positive in chronological train, validation, and holdout. Existing holds, missing-price
failures, projection conflict, side corrections, and no-bet gates still have priority. Evidence
and rollback details are recorded in
`docs/model-audits/2026-08-11-mlb-total-under-market-anchored-r35.md`.

The August 12 r36 grade-policy release adds an independent, market-anchored Moneyline Lean
sleeve after the existing top-one portfolio ranker. It can promote an otherwise non-actionable,
unchanged final side only with complete high-quality/fresh data, a selected-side price from -120
through +200, at least a one-point opener-to-current implied-probability move toward that side,
and a frozen selected-side SharpAPI money-minus-ticket gap below 20 points. The recorded model
probability must remain in the observed 50%-plus selected-side range; 50% is an evidence-coverage
boundary, not a calibrated confidence claim. No 53%, 54%, or 55% grade threshold applies. It never
changes the selected side, probability, price, Best Angle flag, or stake, and it cannot bypass a
hold, no-bet, stale-data, missing-price, or side-correction gate. Current-head evidence was 23-11
at +40.5% locked-price ROI across 15 dates; after removing overlap with the existing ranker it was
22-11 at +36.5%. The August 12 paired dry run adds no current play. Evidence and rollback details
are recorded in `docs/model-audits/2026-08-12-mlb-market-led-moneyline-lean-r36.md`.

The August 12 r37 combined release supersedes the not-yet-deployed r36 sleeve and incorporates
the full MLB/WNBA market-pattern search. For MLB Moneylines, a movement Lean now requires at
least a 1.5-point opener-to-current implied-probability move, a -200 through +200 price, a
selected-side SharpAPI money-minus-ticket gap below 10, and an unchanged, correction-safe final
side. The full cohort was 15-5; after the existing r32 ranker was removed, the incremental cohort
was 11-5, with the recent validation and holdout periods going 9-2. The broader one-point rule was
rejected after final-side changes were separated and its early period was negative.

R37 also adds a neutral-movement Moneyline Best Angle only when both selected-side SharpAPI
tickets and money are at least 70%, data quality is high, the price is -200 through +200, and no
market correction or inversion fired. It went 45-15 (+26.4% ROI): 27-9 train, 14-5 validation,
and 4-1 holdout. Sensitivity at 70%, 75%, and 80% was stable; lower incremental bands were not
promoted because they borrowed most of their strength from this 70% cohort. No model-probability
floor is used.

For MLB totals, r37 adds an Under-only SharpAPI support Lean at -145 through +145 when selected-
side money exceeds tickets by at least 10 points, movement is not against the pick, and quality is
high. It went 17-5: 8-1 train, 5-3 validation, and 4-1 holdout. The corresponding Over branch was
rejected after going 6-6 in both validation and holdout. R37 also preserves a complete two-sided
first-inning market as a non-actionable Toss-Up when lineups are publishable but a probable
starter has genuinely not yet been published; an absent FI market, lineup problem, or scratch
still holds.

The August 12 r38 integration release preserves every r37 side, probability, grade, price, and
stake rule while fixing the authoritative record writer's handoff for that unpublished-probable
first-inning case. R37 correctly produced a market-backed non-actionable Toss-Up in
`game_predictions`, but the record writer still allowed only the older sparse-named-starter
reason and omitted the public `prediction_records` row. R38 recognizes both explicitly approved
Toss-Up reasons. It cannot create an actionable FI play and still fails closed for an absent FI
market, lineup failure, scratch, or any blocker outside opposing-starter FI availability.

The August 13 r39 totals replacement release stands down the older generic validated-Lean sleeve
after its exact post-launch cohort went 5-8 (-23.5% locked-price ROI). It replaces that sleeve
with a narrower, market-confirmed original-Under path: when the mean-side correction is rejected,
the unchanged original Under may become a Lean only with an exact two-sided SharpAPI split, high
data quality, a real -145 through +145 selected-side price, and every missing-market, divergence,
or explicit no-bet safeguard clear. It never flips the side or changes the price, probability,
projection, Best Angle status, or stake. Frozen-context forward replay was 19-6-1 (+41.1% ROI),
positive in all four chronological weeks; date-block bootstrap P(profitable) was 0.9952. The Over
branch was rejected at 1-7. Historical paired impact removes 13 old-sleeve Leans and adds 26 new
Under Leans (net +13); the August 13 paired board adds four Leans with no current old-sleeve
demotion. Rollback is the exact r38 release and v28 grade policy. Full evidence is recorded in
`docs/model-audits/2026-08-13-mlb-total-mean-selector-original-under-r39.md`.

The August 13 r40 Moneyline continuity release closes the interaction gap between r37's
neutral-consensus Best Angle and its movement Lean. A high-quality, fresh, correction-safe
Moneyline with a -200 through +200 price and exact selected-side SharpAPI tickets and money both
at least 70% remains a Best Angle only while movement is neutral. If movement becomes favorable,
the same evidence now produces a Lean rather than falling to Watchlist; movement against the pick
still receives no protection. The rule does not change the side, probability, projection, price,
or stake. Historical favorable-movement rows went 40-18 (+11.0% ROI); the previously
nonactionable incremental cohort went 24-8 (+17.8% ROI) and was positive in train, validation,
and holdout. The paired August 13 board adds one Lean—Texas at the current snapshot—with no
demotions. Evidence and rollback details are in
`docs/model-audits/2026-08-13-mlb-consensus-grade-continuity-r40.md`.

The August 14 r41 data-identity release prevents SharpAPI slate-rollover
contamination. The provider's event-id date is no longer trusted by itself:
before any split is merged, at least 70% of unique matchup identities must
resolve on the requested slate and the payload must fit that slate better than
the prior slate. Partial, stale, and ambiguous payloads fail closed. This does
not add or change a predictive rule, side, probability, projection, price, or
stake. At the incident snapshot, the provider returned ten matchup rows: only
two matched August 14 while nine matched August 13. The repeated MIL-LAD pair
had therefore received August 13 splits and incorrectly activated one Total
Lean; removing that false input changes exactly that action and manufactures no
replacement. The member reader separately recovers verified both-side movement
from canonical append-only price observations without feeding that recovery
into prediction decisions. Evidence and rollback details are in
`docs/model-audits/2026-08-14-mlb-sharp-slate-identity-and-reader-price-history-r41.md`.

The August 14 r42 completion release applies r41's same whole-payload schedule
identity gate to the separate Market Intelligence observation writer. The
post-r41 live audit proved that the recommendation signal path failed closed,
but the observation writer could still persist the stale repeated-matchup
payload and expose it to source-aware reader/history consumers. R42 rejects
that payload before current or history observations are built. No predictive
formula, side, probability, projection, valid price, or stake changes. Evidence
is recorded in
`docs/model-audits/2026-08-14-mlb-all-writer-sharp-slate-identity-r42.md`.

The August 11 tracking-contract v8 operational release keeps the shared MLB
`prediction_pipeline` lease authoritative while preventing an ordinary writer collision from
leaving a game visibly open for another five-minute interval. The targeted pregame sweep now
runs every minute and waits for the shared lease for at most 20 seconds before deferring to the
next minute. It does not open the lock window before T-60, add a writer, change any model,
probability, side, grade, or stake, or refresh a full slate on no-op sweeps. The incident and
rollback evidence are recorded in
`docs/model-audits/2026-08-11-mlb-lock-priority-retry-v8.md`.

The August 11 r32 release adds a slate-level MLB Moneyline portfolio ranker after all existing
side selection, correction, no-bet, price, freshness, and data-quality gates. It jointly scores
the frozen model probability, offered-price break-even, model-versus-price edge, picked-side
ticket and money shares, their gap, price shape, and captured opener-to-lock market behavior.
It may promote at most the highest-ranked qualifying Watchlist to Lean; it is not a quota and
may add no play. A qualifying row needs at least 50% model probability—the structural boundary
at which the binary model prefers the selected side—a price from -220 through
+200, a learned probability at least equal to the offered break-even, complete high-quality
market evidence, and no movement against the pick. It never changes the side, probability,
projection, price, Best Angle status, or stake.
Its ticket and money inputs must be the frozen selected-side SharpAPI observations used in the
training reconstruction; missing SharpAPI data makes the candidate ineligible.

Exact-record floor sensitivity found no defensible 55% cliff: under the current probability head,
the 50-52%, 52-54%, 54-55%, 55-56%, and 56-58% non-actionable bands were not monotonic. With the
50% selected-side floor, current-head daily walk-forward selection produced 25 plays at 20-5 and
+40.9% locked-price ROI across July 11-August 8. Allowing a second or third daily selection
degraded materially, so only rank one is live. The paired August 11
replay adds one Moneyline Lean (Cincinnati at the then-current +135) to the previously zero-action
Moneyline board; totals and first-inning decisions are unchanged by this ranker. Evidence and
rollback details are recorded in
`docs/model-audits/2026-08-11-mlb-sharp-portfolio-selected-side-floor-r32.md`.

The August 11 r28 first-inning availability release keeps MLB Stats as the authoritative starter
source and fills only an empty side through the existing ESPN probable-pitcher fallback. The
shared service retries ESPN's equivalent official site API host when its primary host is empty or
unavailable from production. A game with named probable starters, a complete two-sided FI market,
and publishable offense context now degrades to a non-actionable Toss-Up when verified starter
history is sparse; an actually unknown starter or missing FI market remains an explicit hold.
The r28 tracking-coherence follow-up preserves that Toss-Up in `prediction_records` even though
its retained audit correctly says the directional fresh-data gate did not pass. It never assigns
a side, price, edge, units, or actionable grade to that row. Data-health actionable counts now
use the actual member grades (Lean/Best Angle) instead of counting Watchlists as actionables.
The tracking follow-up is recorded in
`docs/model-audits/2026-08-11-daily-edge-fi-tracking-coherence-r28.md`.
The paired live-slate replay is recorded in
`docs/model-audits/2026-08-11-daily-edge-fi-probable-availability-r27.md`.

## WNBA champion

- Model: `wnba_v1_1_team_identity`
- Distribution: `wnba_market_heads_value_calibrated_2026_08_02_v3`
- Calibration schema: `wnba_core_calibration_v1`
- Grade policy: `wnba_grade_policy_v6_authoritative_reader_grade_2026_08_13`
- Prediction-record contract: `wnba_prediction_record_contract_v2_published_probability_2026_08_10`
- Machine registry: `lib/automodel/wnbaChampionRuntime.ts`
- Authoritative model writer: `lib/services/wnba/runWnbaModel.ts`
- Tracking writer: `lib/services/wnba/buildWnbaPredictionRecords.ts`
- Member reader: `lib/services/wnba/buildWnbaDailyEdgeAdapted.ts`
- Scheduled owner: `/api/cron/wnba-daily-refresh` under the WNBA-scoped shared
  `prediction_pipeline` lease

WNBA moneyline selection and its established public-support grade behavior are preserved.
Public support cannot promote total or spread Watchlists. Public resistance remains active in all
markets. A spread Watchlist can promote to Lean only for the home side when Elo and statistical
home margins differ by less than three points, at least ten books quote the spread, an exact
picked-side price exists, and public conflict is absent. The rule never changes a side, projection,
probability, or stake.

Exact current-release attribution removed five total/spread public promotions that went 0-5 and
added six spread agreement promotions that went 5-1 (+3.421 units), for a +1 board delta. The
broader historical promotion cohort reproduced at 14-3: 2-1 train, 6-1 validation, and 6-1
holdout.

The August 12 v5 policy adds a second, side-agnostic spread Lean path when the selected side has a
positive canonical projection gap, rest is not against that side, at least ten books quote the
spread, an exact selected-side price exists, and public conflict is absent. The cohort went 22-10
(+29.7% ROI): 9-6 train, 7-2 validation, and 6-2 holdout; 11-7 was incremental outside the v4
home Elo/stat agreement rule. It does not alter moneyline or total decisions.

The August 13 v6 coherence release preserves all v5 selection, projection, probability, price,
and grading rules, but makes the versioned WNBA writer grade authoritative in the member reader.
It removes a second, unversioned reader comparison between rounded display confidence and a
separately reconstructed no-vig probability that could silently demote an official Lean. Locked
v5-and-older rows retain their historical reader behavior. The current-slate paired dry run has
zero promotions and zero demotions; an August 1-14 diagnostic found four historical writer/reader
Lean-to-Watchlist mismatches that demonstrate the forward risk without rewriting that history.
Evidence and rollback details are recorded in
`docs/model-audits/2026-08-13-wnba-authoritative-reader-grade-v6.md`.

## MLB Player Props candidate

- Release: `mlb_props_2026_08_14_r35`
- Machine registry: `lib/mlb/props/marketModelVersions.ts`
- Authoritative writer: `/api/cron/mlb-player-props-refresh` through
  `refreshMlbPropsBoard`
- Status: private launch candidate; not publicly enabled

The August 14 r35 stake-contract correction restores the owner-approved unit
definition: every non-Home Run Lean or Best Angle is 1.00u, while the
diversified Home Run longshot portfolio is 0.25u. R34 had incorrectly stamped
ordinary actionables at 0.25u and the Home Run and RBI portfolios at 0.10u.
R35 changes no selected side, line, price, probability, projection, grade,
promotion/demotion rule, or actionable count. Historical locked rows retain
their original r34 stake metadata; reporting may normalize them explicitly but
must not rewrite them. The no-write August 14 rebuild was publishable with
5,631 rows, 146 actionables (141 standard and five Home Runs), zero stake-policy
mismatches, and zero grade changes attributable to this correction. Evidence
and rollback details are recorded in
`docs/model-audits/2026-08-14-player-props-unit-stake-contract-r35.md`.

The August 13 r34 model release retains r33's weather and three-play Home Run
portfolio and adds two capped Lean sleeves selected chronologically from the
all-market value tournament. The Home Run complement excludes every hitter
and game already selected by the r33 basket, requires +351 through +650, at
least two points of model edge and 5% EV, ranks by model probability, and may
add up to two 0.10u Leans. Validation halves were 3-4 (+9.47u) and 2-3
(+5.11u); untouched August holdout was 5-19 (+2.93u, +12.2% ROI). This is a
diversified basket decision: rank one was strongly positive on holdout, while
rank two was negative independently, so no third complement is live.

R34 also adds at most the highest-EV Batter RBI Watchlist as a 0.10u Lean when
its existing final side has nonnegative edge and EV and a best price from -200
through +300. Validation was 6-2 (+8.89u); untouched holdout was 5-7 (+5.65u).
Ranks two and three failed validation and are not live. The paired August 13
rebuild adds two Home Run Leans and one RBI Lean, with no demotions. A Pitcher
Hits Allowed candidate stayed out of production because the full member-board
rebuild showed its current candidates carried the existing low-data-confidence
flag. Evidence is in
`docs/model-audits/2026-08-13-player-props-incremental-value-portfolios-r34.md`.

The August 13 r33 model release retained r32's missing outdoor weather
coordinates for MLB's neutral-site Field of Dreams venue. The PHI-MIN slate
arrived with that official venue name, so r31 could not resolve required
game-time weather and correctly held the entire snapshot.

R33 adds the validated Batter Home Runs portfolio Lean. It estimates the
hitter's home-run rate per plate appearance from the 20 most recent prior-only
games, shrinks with a 100-PA league prior, adjusts expected opportunities for
batting order and the verified park/outdoor-temperature environment, then
anchors 25% to the multi-book market consensus. Eligible 0.5 Over offers must
have nonnegative edge and EV at +150 through +1000. The three highest-EV best
prices are Leans at 0.10u with at most one hitter per game. Validation was 5-19
(+53.7% ROI); untouched holdout was 8-28 (+108.5% ROI), with date-block
P(profitable)=0.9698. The 4-play variant also stayed positive in both windows,
while 5 plays was flat in validation, supporting the three-play boundary.
Evidence and current-board impact are recorded in
`docs/model-audits/2026-08-13-player-props-home-run-pa-portfolio-r33.md`.

The complete August 13 all-market tournament covered 45,320 settled observations across 16
markets. It retained the r31 HRR Under, Doubles Under, and Batter Strikeouts Over accuracy
sleeves, rejected every broad probability challenger, and kept holdout-sensitive total-bases and
pitcher finalists out of production. A subsequent target-corrected Home Run portfolio test fixed
the tournament's equal-games/equal-opportunities defect and qualified the r33 release. The complete matrix is in
`docs/model-audits/2026-08-13-mlb-props-all-market-tournament.md`.

The r31 accuracy release removes the losing Home Run Over actionable promotion
while preserving the calibrated Home Runs probability and visible Watchlist
card. That selector was 7-49 on validation and 8-67 on the untouched August
holdout. Rich home-run context regressions and a replacement threshold selector
both failed holdout and remain rejected.

R31 pairs that demotion with two prior-only empirical/market accuracy sleeves.
Doubles Under 0.5 was 66-14 on validation and 142-32 on holdout; Batter
Strikeouts Over 0.5 was 12-6 and 27-14. Both require positive model-versus-market
edge, nonnegative locked-price EV, an eligible price, existing lineup/data
quality/freshness gates, and the best offer. The current-slate paired replay
added ten Doubles Unders and two Batter Strikeouts Overs, removed six Home Run
Overs, and produced an intended +6 actionable-board delta. Evidence and all
rejected market-by-market challengers are recorded in
`docs/model-audits/2026-08-12-player-props-market-by-market-accuracy-r31.md`.

The r30 H+R+RBI accuracy sleeve promotes only market-anchored Under candidates
selected on the July 24-31 validation window. It combines 25% prior-only,
line-aware empirical survival with 75% target-market probability and requires at
least 60% final probability, 1 percentage point of final edge, and 3% expected
value. Validation was 6-3 and the untouched August 1-11 holdout was 15-2 across
nine dates; date-block bootstrap support was 99.92% for hit rate above 50% and
99.44% for profitability. It added 17 holdout decisions over r29 with no
demotions. All broad context regressions and weaker action cohorts remain
audit-only. Evidence is recorded in
`docs/model-audits/2026-08-12-player-props-all-market-features-hrr-r30.md`.

The r29 pitcher workload guard prevents total season innings from being divided by a small
starter count for mixed-role pitchers. When the starter baseline is weak, current official start
logs own workload and the strikeout probability is held to the de-vig target-book market as a
non-actionable control. In 21 untouched weak-baseline strikeout observations across 10 dates,
the market control beat r28 on Brier score (`0.232115` vs `0.254888`), log loss (`0.657115` vs
`0.703085`), and 55% selected-side hit rate (`66.7%` vs `47.1%`). Established starters remain on
the existing model path. Evidence and board impact are recorded in
`docs/model-audits/2026-08-12-player-props-weak-pitcher-workload-r29.md`.

The r28 probable-pitcher contract uses MLB Stats as the authoritative starter source and fills
only an empty game side from ESPN's published probable, provided the name resolves to exactly
one active pitcher on the corresponding MLB roster and exactly one Ball Don't Lie player on the
same team. MLB Stats automatically supersedes the fallback on the next authoritative refresh.
Team-pair ESPN identity is never used to guess between doubleheader games, ambiguous mappings
remain held, and an operator kill switch can revert immediately to official-only behavior. If
ESPN's primary official site API host returns an empty slate from the production serverless
network, r28 retries ESPN's equivalent official site API host before declaring the source empty.

The paired August 11 shadow rebuild held all 5,874 offer rows and the same live prices constant.
Fallbacks for Jake Irvin and Carson Whisenhunt restored opposing-starter and pitch-mix research
to 370 rows. Required-research holds fell from 402 to 32, all of which had verified but
insufficient pitch-mix samples. The actionable board moved from 107 to 116 through 11 promotions
and 2 demotions (net +9); 105 actionables were retained. No stale odds, missing prices, mapping
errors, or publication errors were present. Full details are in
`docs/model-audits/2026-08-11-player-props-probable-fallback-r27.md`.

The r26 publication and launch-readiness contract preserves every research-quality gate at row
level. A row missing required opposing-starter or pitch-mix evidence must be
explicitly stamped `PENDING_DATA` or `RESEARCH`, remains ineligible for units,
and is disclosed in snapshot warnings. Those already-held rows no longer
freeze complete priced rows from unrelated games or falsely close the admin
launch gate. Any incomplete row carrying an ordinary Watchlist, Lean, or Best
Angle grade still blocks both publication and launch readiness.

The underlying r23 adapter remains intact: a current Ball Don’t Lie endpoint
response stamps the quote with the current fetch observation while retaining
`updated_at` in raw evidence for movement auditing. This prevents an unchanged
but still-listed offer from being falsely expired after 45 minutes.

The paired August 10 audit compared the latest valid r21 private snapshot with
an r23 read-only rebuild: 3,789 exact rows matched, 204 rows were added, 45
were removed, and the board grew from 3,834 to 3,993 rows. The actionable
board moved from 83 to 79 through 10 promotions and 14 demotions, with 69
actionables retained. The candidate was publishable with all 16 supported
markets, zero stale displayed odds, complete required research, and no public
flags enabled. Full details are recorded in
`docs/model-audits/2026-08-10-player-props-current-observation-r23.md`.

The August 11 paired production dry-run contained 5,821 offer rows and 103
actionables with complete research and fresh prices. Exactly 403 unrelated
rows were already fail-closed (`310 PENDING_DATA`, `93 RESEARCH`): 370 lacked
an announced opposing starter and 33 additional rows had a verified but
insufficient pitch-mix sample. Operational warnings distinguish source-not-yet-
published data, insufficient verified samples, and true unavailable data. The
r26 contract changes only snapshot and launch-gate availability: it promotes zero incomplete
rows, demotes zero complete rows, and leaves the actionable count at 103. See
`docs/model-audits/2026-08-11-player-props-held-research-readiness-r26.md`.
New WNBA records store the final published picked-side moneyline probability while retaining the
independent and final layers separately. Tracking refuses a source payload whose model,
distribution, or grade-policy identifier differs from the champion. The reader hides stale
unlocked payloads but preserves locked historical recommendations.

## Explicitly not active

### MLB Player Props pitcher shadow

- Shadow release: `mlb_props_shadow_pitcher_2026_08_12_r1`
- Feature contract: `mlb_props_shared_pitcher_features_v1_2026_08_12`
- Scope: prospective T-60 evidence for pitcher strikeouts; pitcher outs retained as a control
- Production effect: none; active props bundle remains `mlb_props_2026_08_13_r32`
- Evidence: `docs/model-audits/2026-08-12-player-props-shared-pitcher-shadow-r1.md`

The shadow path reuses the authoritative props refresh and records its immutable output in lock
metadata. It cannot change a member-visible probability, side, grade, or stake. Promotion requires
new chronological holdout evidence and a later active release identifier.

The following research findings are not production rules and must not be inferred from older
audit documents:

- MLB total probability shrink `k=.2`.
- MLB selected-side probability compression.
- Any new MLB first-inning probability or flip rule.
- Any WNBA money/ticket, steam, reverse-line-movement, or opposite-side flip rule.
- Any WNBA total probability recalibration or blanket projection blend.
- Any WNBA spread probability/anchor-weight change.

They require a new immutable release, exact paired replay through the entire downstream grade
pipeline, and the full `docs/model-change-safety.md` protocol.

## Release verification

Before calling a later change live:

1. Confirm these identifiers in the machine registries and member-facing snapshots.
2. Run `npm run verify:model-change` plus the MLB prediction-record, signed-evidence,
   market-signal, grade, and WNBA core suites.
3. Confirm all prediction writers use the sport-scoped `prediction_pipeline` lease.
4. Verify unlocked source releases are coherent and locked rows remain immutable.
5. Compare current board counts and market mix against the approved paired replay.
6. Verify the deployed commit, cron health, response freshness, and member reader after both a
   scheduled refresh and the next lock sweep.
