# NBA professional model r2 — current architecture audit

Date: 2026-10-15

Status: research and data capture only. No production score, pick, probability,
grade, stake, lock, reader, writer, or tracking behavior is changed by this
audit.

The shared architecture, mandatory replay-error artifacts, reconstructed r1
findings, and market-reader parity matrix are defined in
[`2026-10-15-nba-shared-model-market-standard.md`](./2026-10-15-nba-shared-model-market-standard.md).

## October 15 opening-readiness evidence

A read-only production-data and provider probe on October 15 establishes the
following launch boundary. These observations are a point-in-time operational
audit, not a historical backtest:

- The database contained 60 NBA games, 118,585 NBA `line_history` rows, and
  1,998 rows marked as openers. The volume proves that odds observations are
  being collected; it does not prove a coherent same-book, exact-line movement
  sequence is being interpreted.
- NBA had zero `public_splits_observations` rows and zero `sharp_signals` rows.
  There is therefore no persisted NBA split history or last-known-good split
  fallback to validate or restore when the live provider is unavailable.
- SharpAPI `/splits?league=nba` returned 32 current rows covering 18 event ids.
  The rows were sportsbook-specific rather than a single consensus: the
  observed DraftKings rows included ticket and handle shares, while observed
  BetMGM rows included ticket shares with null handle shares. These records may
  be useful evidence, but they must retain sportsbook provenance and cannot be
  collapsed or labeled as generic "sharp money."
- SharpAPI `/opportunities/ev?league=nba` returned zero rows at the audit
  timestamp. Opportunity/fair-value data therefore cannot be assumed to be an
  opening-night fallback.
- SharpAPI `/splits/history` did return sportsbook-specific NBA history for an
  October 20 event. BetMGM history exposed ticket shares only; filtering by
  `sportsbook=draftkings` exposed ticket and handle shares, with observations
  beginning October 13. The shared Market Intelligence v2 SharpAPI collector
  currently returns immediately for every sport except MLB, so this recoverable
  NBA sequence is not being persisted or resolved by the application.
- The NBA split client reads the live endpoint on demand. A provider failure
  falls back to no split data; it does not read a persisted NBA last-known-good
  observation.
- The shared public-splits capability registry correctly marks NBA
  `audit_required` and observe-only. The NBA adapter separately treats the
  mere presence of `SHARPAPI_KEY` as market-signal availability. That conflict
  must be removed before the card can make authoritative split or sharp-signal
  claims.
- The NBA adapter derives `lineOpenAmerican` from the earliest price observed
  for a side and compares it with a current best price. It does not preserve
  the opening spread/Total number in that DTO, and the opening and current
  prices need not be from the same sportsbook. This is not a valid basis for
  steam, reverse-line-movement, resistance, or buyback classification.
- The stored official NBA sample contained ten locked `nba_v0_2026` records:
  five Moneylines and five Totals. Moneyline was 1-4 and Total was 3-2. Only
  eight records retained predicted scores; across those four games, team-score
  MAE was 12.90, margin MAE was 13.50, and Total MAE was 19.55. This sample is
  far too small, belongs to a superseded release, and cannot qualify the
  current champion.

### Opening-readiness verdict

The NBA data collection substrate is partially live, but the complete model +
market-reader system is **not qualified for trust** as of this audit. Current
multi-book, same-line no-vig comparison is usable as a price benchmark. The
following are not yet qualified: public-split influence, any claim of sharp
money, open-to-current movement interpretation, reverse line movement, steam,
resistance/buyback, or release-pure performance for the current champion.

Until the gates below clear, split rows remain provenance-labeled observation
data, market movement remains unavailable rather than neutral, and no split or
single-book movement may flip an independent pick or promote a Best Angle.

## Current champion and measured baseline

- Model: `nba_v2_independent_first_2026_10_06_r1`
- Market marriage: `nba_market_marriage_2026_10_06_r1_independent_first`
- Grade policy: `nba_grade_policy_2026_10_06_r1_coherent_exact_price`
- Official tracked markets: Moneyline and Total
- Context-only market: Spread
- Sole writer: the existing NBA prediction-record path under the shared
  `prediction_pipeline:nba` lease

The published 2025-26 chronological confirmation baseline contains 1,230
games: 9.6001 team-score MAE, 10.9252 margin MAE, 15.6065 Total MAE, 64.80%
winner accuracy, 48.55% Spread direction, and 49.82% Total direction. That
replay validates the prior-only independent architecture, not complete runtime
parity, exact-price economics, or the current market reader.

The later reconstructed score-path audit is narrower. It remains valid for its
1,230-game independent score diagnostics, but only 553 rows have exact market
data. An earlier reconstructed report accidentally scored neutral placeholders
as real market rows, creating false 60.85% ATS and 29.02% market-winner
headlines. The corrected market-eligible subset is 47.36% ATS and 50.27% on
Totals for the independent model; it is incomplete and cannot supersede the
published baseline or qualify a market correction.

## What the runtime actually uses

The independent score consumes season-level offensive rating, defensive
rating, pace, Four Factors, a prior-season early-year handoff, home-court
advantage, and a bounded rest differential. A normal distribution with fixed
base margin and Total standard deviations supplies Moneyline, exact-spread,
and exact-Total probabilities.

The current market layer builds coherent two-sided no-vig references from the
same sportsbook and exact line, rejects obvious cross-market contradictions,
selects the best evaluated price, and compares the independent forecast with
the consensus. Public split and opportunity payloads are retained as context.
They do not currently alter the score, side, probability, or grade.

## Confirmed gaps

1. Player availability is not a score input. An Out or unknown designation
   caps confidence but applies zero player-value or expected-minutes impact.
2. Recent form is absent from the production snapshot. Both teams'
   `recent_form_10g_net_rating` fields are explicitly null.
3. The score has no expected-rotation, roster-continuity, trade, on/off,
   adjusted-plus-minus, usage redistribution, or replacement-level layer.
4. Matchup style is shallow. Shot zones, rim and three-point profiles,
   transition, half-court play types, switching, drives, passing, rebounding,
   hustle, and foul pressure are not production inputs.
5. Schedule context stops at basic rest. Travel distance, time-zone change,
   altitude, road-trip position, and compressed multi-game travel are absent.
6. The distribution uses fixed uncertainty. It does not condition variance or
   tails on pace, three-point attempt share, lineup uncertainty, team
   volatility, or favorite size.
7. The score equation is additive and hand-weighted. No chronological runtime-
   parity tournament has yet proved that its coefficients or interaction
   structure are the best available candidate.
8. The market reader has no authoritative same-book opening/prior/current
   sequence. Its stored card truthfully says `First observed tracking only —
   no opener available`.
9. Money-versus-ticket splits are displayed context only. Source quality,
   persistence, reversal, buyback, resistance, and target-book-excluded
   confirmation are not used in an NBA-specific decision rule.
10. Spread remains context-only and has no release-pure official performance
    record. It cannot be promoted merely because a richer score model exists.

## GOAT evidence now proved available

A trial-safe contract capture verified finalized game identity and scores,
player box scores, player-game advanced V2 rows with tracking/hustle/matchup
fields, and timestamped opening Moneyline/Spread/Total quotes. The sample is
explicitly ineligible for model selection or price claims. Complete immutable
season packages and their checksums are required before the tournament runs.

Historical capture release
`nba_bdl_historical_research_2026_10_15_r2_resumable_game_scoped` replaces the
fragile season-wide player-stat scan with exact-game batches. Each completed
batch is written atomically, can be resumed without another provider request,
and must cover every requested game before the manifest can become score- or
price-backtest eligible. This is research input collection only and has no
production reader or model authority.

The active 48-hour GOAT trial truthfully reports a five-request-per-minute
limit. BALLDONTLIE documents that this is the trial contract and that the same
key automatically moves to 600 requests per minute after paid conversion. The
collector therefore supports separate bounded batch sizes per dataset: small
box-score checkpoints limit loss on interruption, while advanced and opening-
odds rows can use larger exact-game batches to avoid unnecessary trial-window
requests. Batch sizes are recorded in the immutable manifest and do not relax
the per-game coverage gate.

BALLDONTLIE team-season feature families are useful as prior-season or live
current-state context. A completed full-season aggregate may not be applied
backward to an earlier game in that same season. Historical rolling features
must instead be reconstructed from player-game rows that existed before the
forecast cutoff.

## Research-informed design constraints

External research is an input to candidate design, not permission to import a
coefficient into production. The following findings define tests the
chronological tournament must run:

- Four Factors remain a principled efficiency decomposition, but their
  nonlinear interaction and opponent-relative form should be tested rather
  than represented only by fixed additive weights. A recent derivation using
  NBA data from 2000 through 2025 reports that shooting, turnovers, rebounding,
  and free throws jointly determine team efficiency
  ([Poropudas and Halme](https://arxiv.org/abs/2305.13032)).
- More inputs and a more complex learner are not automatically better. One
  16-season NBA study reported that a single Elo or relative-win-strength
  feature fit outcomes better than its box-score/Four-Factors alternatives.
  That is not a universal result, but it requires every rich candidate to beat
  simple dynamic-rating and home-court baselines on untouched seasons
  ([Migliorati et al.](https://arxiv.org/abs/2111.09695)).
- Final team scores are correlated outputs. Published NBA score research has
  modeled the two scores jointly with bivariate mean regression and derived
  winner probabilities from that system. Our tournament therefore compares
  direct team-score heads with coherent margin/Total heads and will reject
  independently rounded scores that imply inconsistent markets
  ([Song, Zou, and Shi](https://doi.org/10.1080/03610918.2018.1520878)).
- Player value must be estimated conditional on the other players on court.
  Win-probability adjusted player impact and lineup-combination research both
  warn against treating a player's box-score average as a context-free point
  adjustment
  ([Deshpande and Jensen](https://arxiv.org/abs/1604.03186),
  [Martonosi, Gonzalez, and Oshiro](https://arxiv.org/abs/2303.04963)).
- Regularized adjusted plus-minus is useful but not a context-free truth. An
  empirical assessment found material teammate-complementarity effects still
  present in player estimates, and modern lineup work emphasizes extreme
  lineup sparsity. Player impact candidates therefore require shrinkage,
  replacement/lineup interactions, and out-of-sample testing rather than raw
  plus-minus or a single public all-in-one number
  ([Lewis, Lock, and Sexton](https://pmc.ncbi.nlm.nih.gov/articles/PMC7447047/),
  [Petridis and Pelechrinis](https://arxiv.org/abs/2601.15000)).
- Schedule stress is multidimensional. Rest, travel direction and distance,
  time-zone change, and trip sequence are separate candidate features, not a
  single back-to-back flag
  ([Charest et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC8636381/),
  [Esteves et al.](https://pubmed.ncbi.nlm.nih.gov/32172667/)).
- A season-level NBA study found a negative association between games missed
  and winning percentage, but its retrospective correlational design cannot
  identify the effect of one star missing one game
  ([Podlog et al.](https://pubmed.ncbi.nlm.nih.gov/24908360/)).
- The most directly relevant betting study examined 10,555 games from
  1996-97 through 2004-05. It found that higher-value absences moved lines
  against the affected team, that most opening-line bias disappeared by the
  close, and that slight overreaction was not sufficient to beat commission.
  The age of the sample and changed injury-reporting and betting environment
  require a modern replication rather than direct adoption
  ([Dare, Dennis, and Paul](https://doi.org/10.1016/j.frl.2015.02.004)).
- Betting decisions require calibrated probabilities, not merely a high winner
  hit rate. An NBA betting experiment found that model selection by
  calibration materially outperformed selection by accuracy in its held-out
  season. We treat its reported returns as study-specific, while adopting the
  sound evaluation requirement: Brier score, log loss, reliability by price
  band, and exact-price expected value must gate actionability
  ([Walsh and Joshi](https://doi.org/10.1016/j.mlwa.2024.100539)). The
  authors later published a corrigendum after feature-engineering errors
  changed the reported results while preserving that directional conclusion;
  this is also a concrete warning that independent leakage tests are mandatory
  ([corrigendum](https://doi.org/10.1016/j.mlwa.2025.100627)).
- Opening-to-closing NBA line changes have historically improved the market's
  forecast and removed opening bias. This supports the independent-first
  architecture plus a timestamped downstream market reader; it does not
  justify feeding the evaluated closing line into the independent score
  ([Gandar et al.](https://doi.org/10.1111/0022-1082.155346)).
- Long-run NBA betting research treats the point spread as a strong market
  forecast and finds approximately symmetric forecast errors. The market-only
  score must therefore appear beside every independent and combined result;
  beating an internal rating baseline alone is not enough
  ([Price and Wolfers](https://doi.org/10.2202/1559-0410.1112)).
- Evidence of sentiment-based NBA price shading did not translate into higher
  bettor returns in a sample of more than 32,000 games. Public popularity,
  ticket share, or a money-ticket divergence can be a candidate interaction,
  but none is inherently a profitable `sharp` signal
  ([Feddersen, Humphreys, and Soebbing](https://doi.org/10.1177/1527002516656726)).
- Thirty-four-season evidence finds that streaks affected both point spreads
  and outcomes, with season-dependent differences at long streaks. That is a
  reason to test nonlinear recent-form residuals and market response, not to
  hard-code a hot-hand or contrarian rule
  ([Waggoner et al.](https://doi.org/10.3390/ijfs2040359)).

These findings support a layered model: stable team strength, opponent and
style interaction, expected rotation and minutes, schedule/travel state,
current-form residuals, and conditional uncertainty. None may become a live
feature merely because it is intuitively plausible; each must improve the
frozen chronological evaluation without a hidden subgroup or calibration
regression.

The GOAT tracking candidate now maps prior-game paint, transition,
second-chance and turnover scoring shares; passing and touches; secondary and
screen assists; deflections and contests; rim-defense volume and efficiency;
rebounding chances; player-impact dispersion; usage concentration; and
distance/speed into five-game, 15-game, and prior-season windows. The raw
provider fields are not assumed predictive. The tournament decides whether
each family adds stable score or calibration value beyond the simple baselines.
The expanded candidate also tests prior-game PIE, assist and turnover rates,
true-shooting and three-point-attempt profile, offensive and defensive rebound
rates, foul pressure, loose-ball and charge activity, switching, contested and
uncontested shooting, matchup field-goal defense, screen assists, and offensive
and defensive rebound chances. Nullable provider fields stay missing and gain
explicit missingness indicators; they are never filled with a favorable value.

Feature release `nba_point_in_time_features_2026_10_15_r8_season_boundary_schedule_reset`
also adds a dynamic Elo benchmark, explicit offense-versus-opponent-defense
and Four-Factor matchup edges, prior-game player-minute rotation overlap,
rolling expected rotation size/concentration, venue-to-venue great-circle
travel, east/west time-zone direction, road-trip position, and venue altitude.
Every field is constructed before the predicted game's result becomes
available, and the mutation test proves that changing a game's final box or
tracking rows cannot change that game's own feature state. The historical
rotation fields describe continuity entering the game; they do not pretend to
know the current game's participants. Timestamped injury status and projected
current-game minutes remain a separate required input and promotion gate.

## Acute player-absence experiment

The model must not encode `star out = automatic loss` or a generic fixed-point
penalty. It must distinguish at least:

1. the player's pre-absence impact and expected minutes;
2. the expected replacement rotation and replacement quality;
3. usage, shot-profile, rebounding, turnover, and pace redistribution;
4. lineup continuity and how often the available unit has played together;
5. the first game or two of an unexpected absence versus an established
   multi-game rotation;
6. injury-report certainty and the time at which the status became knowable;
7. opponent matchup, venue, rest, travel, and season phase; and
8. increased outcome uncertainty even when the mean score adjustment is
   small.

The proposed short-absence response or market-overreaction effect is a
predeclared hypothesis, not a narrative override. The event study will compare
the first, second, third-to-fifth, and later missed games against a
pregame-matched baseline. Matching and/or regression controls must use only
information available at the forecast cutoff: prior team strength, player
impact, replacement quality, home/away, opponent, rest/travel, and opening
market probability. Results will report home score, away score, margin, Total,
winner probability, and calibration residuals—not raw win percentage alone.

We will separately test whether the opening market overprices an acute absence
and whether any difference remains at the actionable decision timestamp after
vig. A positive result must repeat out of sample and improve the joint score
distribution; otherwise the feature is rejected. Long absences may affect the
stable roster-strength state, while acute absences may affect minutes,
interactions, and variance. Combining those mechanisms into one injury number
is prohibited.

## Independent score tournament

The tournament keeps score construction independent of the evaluated book and
compares, at minimum:

- dynamic adjusted-rating and pace baseline;
- schedule-aware baseline;
- rolling Four-Factors and volatility candidate;
- rotation/player-impact candidate;
- richer shot-profile and play-type residual candidates when point-in-time
  coverage permits;
- direct team-score heads versus coherent margin/Total heads;
- simple linear regularization versus nonlinear candidates with materially
  bounded complexity.

Seasons before 2024-25 fit parameters, 2024-25 selects architecture and
regularization, and 2025-26 is opened once for confirmation. Rolling-origin
folds supplement, but never replace, the frozen chronological blocks.

The candidate must beat the published r1 baseline on team-score MAE and may not
hide a material regression in margin, Total, winner calibration, early-season
performance, or board coverage. Statistical uncertainty is game-clustered.
One aggregate win is insufficient: results are segmented by month, rest state,
injury certainty, projected pace, favorite size, and home/away status.

Where timestamp-valid opening quotes exist, Moneyline, Spread, and Total are
also graded at the exact side price selected by the independent distribution.
The report includes units and ROI alongside direction accuracy and Brier score;
a hit-rate headline cannot conceal unprofitable prices. Opening-price results
remain separate from later decision-time and closing-line evidence.

The 2023-24 and 2024-25 public reference database may supply evaluation-only
Moneylines, Spreads, and Totals when joined by exact date and team identity.
Its sportsbook and observation timestamp are unknown, so it can measure score
performance against a real pregame benchmark but cannot support an opener,
movement, CLV, split, or market-reader claim. Every row carries that provenance;
2025-26 BALLDONTLIE timestamped openings take precedence when available.

The executable tournament release is now
`nba_professional_tournament_2026_10_15_r15_consensus_opening_selection`. Its
predeclared model grid is reproducible with the repository's NumPy runtime:
closed-form ridge, robust iteratively reweighted Huber ridge, and bounded
hinge-spline ridge. Feature-family ablations separately test ratings,
ratings-plus-schedule/travel, Four Factors, prior-rotation continuity, and
tracking/style interactions rather than assuming the largest feature set is
best. Selection requires lower team-score MAE without material margin, Total,
winner-accuracy, Brier, or log-loss regression versus the simple rating
baseline. It records rolling-origin stability before confirmation, 2,000
deterministic game-cluster bootstrap samples, and the complete winner
correction/harm ledger versus that baseline. These are selection safeguards,
not evidence that a candidate has already qualified.

The tournament includes Elo-only and adjusted-rating-only feature groups; a
rich feature set cannot win merely by containing more columns. Eligible models
are ranked by a predeclared joint relative score: team-score MAE 25%, margin
MAE 20%, Total MAE 20%, Moneyline Brier 20%, Moneyline log loss 10%, and
winner error rate 5%. Hard no-regression gates still apply separately. This
keeps the final-score objective central without allowing a tiny score gain to
mask worse winner probabilities or market distributions.

The bounded estimator grid also contains predeclared one- and two-season
half-life candidates. Recency weighting applies only to the model-fitting rows;
it cannot move an outcome into an earlier feature cutoff or calibration block.
The unweighted candidates remain in the same tournament, so recent form must
outperform stable multi-season coefficients rather than being assumed better.

Probability uncertainty is never estimated from the same fitted rows used to
train the score heads. Within each development block, an earlier partition fits
the score model and a later partition calibrates the margin scale by log loss;
the untouched selection or confirmation season is scored only afterward. Total
uncertainty likewise comes from those later out-of-fit residuals. This prevents
in-sample residual shrinkage from manufacturing overconfident Moneyline,
Spread, or Total probabilities.

The selection season also freezes separate actionable thresholds before the
confirmation season is opened. Moneyline candidates use minimum calibrated
expected value at the exact available price. Spread and Total candidates use a
bounded grid of calibrated probability edges against the listed line, with at
least 100 selection bets in a full season; their exact-price economics are then
reported on confirmation wherever prices exist. Thresholds are selected by
Moneyline ROI or by the 95% Wilson lower bound for Spread/Total accuracy, never
by confirmation outcomes. Confirmation explicitly tests the product's 69.4%
Moneyline and 53.2% Total lifetime hit-rate references, while also requiring
positive exact-price units. The lifetime records are selective product results,
so they are compared with the frozen actionable subsets—not misrepresented as
all-game winner accuracy.

The r14 tournament now evaluates three separately named lanes: independent
scores, the market-only score reference, and the final combined distribution.
The earlier 60% of the selection season chooses bounded independent weights
for margin and Total; the later 40% chooses actionable thresholds. Both are
frozen before the confirmation season is opened. The selected margin and Total
are recombined into one home/away score pair, so Moneyline, Spread, Total, and
representative scores cannot come from contradictory forecasts. Missing market
heads fall back to the independent model rather than being imputed.

The confirmation report makes the combined lane primary while preserving the
independent and market-only results, exact-price economics, coverage, and a
winner correction/harm ledger for the market adjustment versus the independent
forecast. A combined candidate fails the final-product gate if it buys lower
score error by materially worsening winner accuracy, Brier score, log loss, or
an actionable market. An opening-reference blend is not labeled a fully
validated reader: movement and split gates remain false until timestamped
sequences exist.
The report also counts the provenance used to select the market weights. A
weight chosen from the public pregame reference remains sensitivity analysis
only because its sportsbook and observation time are unknown; the
`timestampedMarketSelectionValidated` gate cannot pass on those rows.

A paginated read-only production query on October 15 found 121,885 NBA
`line_history` rows, but they covered only 22 preseason games from October
11–15. That sample can verify parsing, same-book pairing, chronological
cutoffs, and correction-ledger mechanics. It is too small and not
regular-season representative, so it cannot choose or qualify an NBA movement
or splits rule. Those rules remain observation-only and must earn authority on
forward timestamped evidence; they cannot alter r14 confirmation forecasts.

### Regular-season market-source cross-check

Preseason games are excluded from every accuracy, calibration, threshold, and
reader-rule decision. The tournament now refuses a historical season with
fewer than 1,200 games by default. The intended chronology is 2022-23 as a
warm-up/training season, 2023-24 for additional development, 2024-25 for model
and threshold selection, and 2025-26 as an untouched confirmation season. The
warm-up season prevents the first development season's early games from being
evaluated without a prior-season state.

The independent 2025-26 consensus reference downloaded for source
cross-validation is the CC-BY-4.0 `nba-closing-lines-ats-2025-26` CSV with
SHA-256
`9ff4950cd96dc97da58dd64632444e5865d39f1e02a0673533a924f895d1ecae`.
It contains 1,224 labeled regular-season rows and omits six NBA Cup knockout
games, so it cannot replace the canonical BDL season identity or become a
model-selection source.

The matching 2024-25 consensus CSV has SHA-256
`e756b4c09c3ac56070f95ad8b6de78fc1b95a1df1049825a5f329d7ce57968cc`.
Its documentation defines the opening fields as the median across bookmaker
brands after proportional vig removal; the file reports a median of 17 books
per game. It also has 1,224 regular-season rows and omits the six NBA Cup
knockout games. It may select a bounded score-level opening-market blend and
probability-edge threshold on the 2024-25 selection season, with missing Cup
games falling back to the independent forecast. It cannot supply exact
opening prices, a recoverable snapshot time, same-book movement, or splits.
Those limitations remain separate hard gates; they are not repaired by the
consensus label.

A preliminary 50-game match against the available BDL opening-price sample
found median absolute source differences of 1.0 spread point, 2.0 total
points, and 4.62 percentage points in no-vig home win probability. The 90th
percentiles were 4.0 spread points, 6.0 total points, and 10.39 probability
points. This is not a performance result: it demonstrates that sportsbook,
vendor, consensus construction, and observation time materially affect the
meaning of "the market." The 50-game BDL trial sample contains BetMGM only,
not multiple books. The complete BDL capture must therefore be audited for
vendor coverage and cross-checked against the independent multi-book consensus
before its exact-price results are qualified. It is a named-book confirmation
source, not "the market" by itself.

### Consensus open-to-close sensitivity

A predeclared chronological sensitivity audit used 2024-25 for rule selection
and 2025-26 for confirmation. Closing consensus improved Moneyline Brier score
from 0.20416 to 0.19893 in selection and from 0.19851 to 0.19426 in
confirmation; log loss also improved in both seasons. Closing consensus was
modestly closer to the result than opening consensus for both Spread and Total
in both seasons.

That does not validate a generic movement-following rule. The selection season
chose following Spread moves of at least three points, but confirmation was
130-102 (56.03%) with a 95% Wilson lower bound of only 49.60%. Following Total
moves of at least four points fell from 221-186 (54.30%) in selection to
164-172 (48.81%) in confirmation. Both rules fail their confirmation gate.
The evidence supports testing a bounded market anchor; it rejects blindly
following large moves. Because the source is consensus open/close rather than
the exact same-book T-60 sequence and price, no live movement-reader rule is
authorized by this audit.

## Upset-aware evaluation

An upset is evaluated against a timestamp-valid, de-vigged pregame market
favorite; the independent score does not consume that label. Reporting must
include:

- underdog win recall and false-upset rate;
- Brier score and log loss by favorite-probability band;
- favorite and underdog calibration curves;
- large-favorite misses and corrected upsets, with no cherry-picked deletion;
- margin residuals by favorite size;
- candidate-versus-r1 corrections and harms for every changed winner.

An upset-specific head may be used only as a calibrated residual or mixture
component that improves untouched probability metrics. It cannot force a dog
quota, flip a winner from narrative evidence, or create incoherent score,
Spread, Total, and Moneyline outputs.

## Market-reader qualification

Market evidence remains downstream and source-separated. Historical validation
requires timestamped same-book opening/prior/current observations, exact-line
identity for Spread and Total, two-sided no-vig pairs, target-book exclusion,
and a documented decision cutoff. Opening odds alone may evaluate opening-line
value but cannot stand in for T-60 prices, closing-line value, or movement.

Candidate correction rules must be discrete, reproducible, reversible, and
derived from the independent base exactly once. Missing sequence or splits are
unavailable, never neutral evidence. Public consensus splits cannot be called
sharp action unless provider provenance proves that claim. One final joint
distribution must own expected score, representative score, Moneyline,
Spread, Total, probabilities, and exact-price decisions.

## Production gate

No r2 live release is authorized until all of the following are true:

1. Complete historical inputs and checksums pass the leakage and identity
   gates.
2. Independent selection and confirmation results beat the declared baselines
   without a hidden subgroup collapse.
3. Moneyline, Spread, and Total probabilities are calibrated at the exact
   evaluated lines.
4. Exact-price units, ROI, coverage, and CLV claims use recoverable pregame
   timestamps and are reported separately from score-only evidence.
5. Every actionable demotion is paired with a tested eligible promotion and
   the full board impact is reported.
6. Opening-night rehearsal proves complete feature, injury, price, release,
   writer, lease, reader, and T-60 lock coherence.
7. All affected releases advance together; existing locked rows remain byte-
   for-byte authoritative.

If those gates do not clear by October 20, r1 remains the production fallback
and r2 continues forward validation. The deadline does not convert incomplete
evidence into a professional model.
