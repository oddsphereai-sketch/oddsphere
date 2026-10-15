# NBA professional model r2 — current architecture audit

Date: 2026-10-15

Status: research and data capture only. No production score, pick, probability,
grade, stake, lock, reader, writer, or tracking behavior is changed by this
audit.

The shared architecture, mandatory replay-error artifacts, reconstructed r1
findings, and market-reader parity matrix are defined in
[`2026-10-15-nba-shared-model-market-standard.md`](./2026-10-15-nba-shared-model-market-standard.md).

## Current decision checkpoint (r35, after latest-main integration)

This section supersedes earlier intermediate r14/r29 readiness conclusions in
this document. The historical notes remain below as an audit trail; they must
not be mistaken for the current candidate.

- Point-in-time feature release:
  `nba_point_in_time_features_2026_10_15_r13_season_regime_state`
- Tournament release:
  `nba_professional_tournament_2026_10_15_r35_comparable_benchmark_gates`
- Research deployment candidate:
  `nba_professional_deployment_candidate_2026_10_15_r15_comparable_benchmark_gates`
- Historical scope: 6,152 games across five completed seasons, with 2022,
  2023, and 2024 used as rolling-origin selection tests before the 2025
  confirmation season was opened.
- Selected independent architecture: `ratings_schedule`, coherent
  margin-plus-Total heads, ridge alpha 1000. Its relative joint score versus
  the simple rating baseline was 0.9980, 0.9940, and 0.9928 in the three
  rolling-origin seasons. This stability, rather than one pooled average,
  selected the model.

Season scoring and pace are not pooled into one timeless NBA baseline. Every
feature row now contains the current and prior season's observed team-game
count, league offensive rating, league pace, their deltas, and a smoothed
current-regime state. The prior season contributes a 60-team-game equivalent
(30 NBA games) while current-season observations progressively take over. This
state is computed strictly before the predicted game. Early, developing, and
established-season cohorts are reported separately.

### Frozen 2025 confirmation

| Lane | Winner direction | Team-score MAE | Margin MAE | Total MAE |
|---|---:|---:|---:|---:|
| Independent | 68.13% | 9.562 | 11.371 | 15.224 |
| Final independent + bounded opening-market blend | 69.02% | 9.341 | 11.138 | 14.814 |

The final blend improves all four aggregate forecast measures. It does not
make every betting market actionable:

- **Total:** the selection-frozen 0.01 probability-edge rule confirmed at
  470-392 (54.52%) over 862 decisions. Of those, 697 retained an exact
  side-specific price and sportsbook, returning +24.683 units and +3.54% ROI.
  The direction Wilson 95% lower bound was 51.19%. This is the only historical
  actionable lane that cleared the current evidence gate.
- **Spread:** 49.79% direction accuracy and -6.19% exact-price ROI. No
  actionable Spread threshold survived selection and confirmation. Spread must
  remain context-only/No Play.
- **Moneyline:** all-game winner direction is a forecast metric, not an
  automatic wager. The exact-price value strategy did not clear the required
  selection evidence and coverage gates, so the actionable Moneyline threshold
  is null/No Play.

The product's historical 69.4% Moneyline record is a selective released-pick
result. It has no preserved per-game release/cutoff ledger equivalent to this
all-game confirmation set, so 69.02% all-game winner direction is a useful
reference but not a direct like-for-like failure or victory. The old r1
64.80%/9.600/10.925/15.607 aggregate is likewise descriptive: it does not
carry a reproducible row-level release and cutoff contract.

### Alternate-line checkpoint (+3 and +6)

Release `nba_alternate_line_audit_2026_10_15_r1_frozen_confirmation` applies
the already established Daily Edge NBA menu—three and six favorable points—to
the exact frozen r35 confirmation decisions. The offsets were not chosen from
2025 outcomes. A surrounding 0/2.5/3/5/6/7.5/10 sensitivity grid is diagnostic
only.

| Frozen final-model cohort | Main line | Favorable +3 | Favorable +6 |
|---|---:|---:|---:|
| Spread direction (context/No Play) | 603-608-1 (49.79%) | 716-495-1 (59.12%) | 830-379-3 (68.65%) |
| All Total directions (diagnostic) | 650-563-0 (53.59%) | 712-498-3 (58.84%) | 783-427-3 (64.71%) |
| Selection-frozen actionable Totals | 470-392-0 (54.52%) | 513-346-3 (59.72%) | 567-293-2 (65.93%) |

The Spread jump is not evidence that the forecast has a three- or six-point
global error. The selected-side result distribution has mean +0.158, median
-0.5, and standard deviation 14.181. A normal distribution with that observed
center and dispersion predicts 50.44%, 58.81%, and 66.79% at 0/+3/+6; the
observed curve is 49.79%, 59.12%, and 68.65%. Most of the lift is the expected
mathematical effect of buying points in a volatile NBA margin distribution.

The more serious Spread finding is lack of market-residual signal. Against the
opening line, the reconstructed independent residual has only 0.026 Pearson
correlation with the actual game residual; the final blend has the same sign
and therefore the same correlation. The 50% market blend shrinks residual
standard deviation from 3.556 model points to 1.778, but it cannot flip the
side because it blends toward the exact market center. Opening-market margin
MAE was 11.086, versus 11.357 for the independent model and 11.121 for the
final blend. Final model edge was not monotonic: the 1-2 point band went
188-161-1 (53.87%), while 2-3 went 83-95 (46.63%) and 3-5 went 53-55
(49.07%); the >5 band was 9-3 but contained only 12 games. This confirms the
selection result: no defensible Spread threshold exists yet.

Release `nba_spread_residual_challenger_2026_10_15_r1_chronological` then
tested the direct repair rather than assuming one. It trained market-residual
models on 2023, selected once on 2024, and opened 2025 only for confirmation.
The grid combined the independent edge and market topology with ratings,
schedule, Four Factors, and rotation groups across six ridge penalties. The
selection winner was a strongly regularized Four Factors/schedule residual
model (alpha 10000): it improved 2024 residual MAE from 11.006 to 10.699,
Brier from 0.25599 to 0.24897, and direction from 51.97% to 53.90%.

That apparent selection edge did not survive confirmation. In 2025 it reached
614-597 (50.70%), with a 47.89% Wilson lower bound. Its exact-priced subset was
482-485 over 967 wagers, -42.217 units and -4.37% ROI. On the 978-row
timestamped BALLDONTLIE cohort specifically, direction was 49.85%; the better
54.27% result occurred only in the 234-row timestamp-unknown consensus cohort.
`promotionEligible` is therefore false. The challenger does improve residual
MAE and Brier by shrinking weak opinions, but improved continuous error is not
permission to publish economically losing Spread selections.

### Selective classifier and movement-reader continuation

The audit did not stop at the failed residual model, and `No Play` is not the
intended product design. Release
`nba_selective_spread_challenger_2026_10_15_r2_four_season` added the public
2022-23 pregame-reference market to the chronology, then tested regularized
logistic, histogram-gradient, and extra-trees cover classifiers across edge,
market topology, ratings, schedule, Four Factors, and rotation inputs. It also
tested fixed favorite, underdog, home, away, line-size, and season-stage lanes.
The policy that looked best before confirmation—away sides at classifier
confidence 0.53—went 124-99 (55.61%) in 2024 after going 62-45 (57.94%) in
2023, but collapsed to 132-143 (48.00%) in 2025. This is a rejected candidate,
not a reason to hide 2025 games or manufacture a narrower post-hoc subgroup.

Release `nba_spread_movement_reader_2026_10_15_r1_all_game` then tested the
new information the score-only candidates lacked. It joined the documented
multibook open and close for every available regular-season game and required
every recipe to return a side on every game. The reader selected on 2024 was:

1. compute the independent model's edge against the current/closing spread;
2. when the home spread moved at least two points from open to close, follow
   that movement direction; and
3. otherwise retain the independent side.

| Reader result at closing line | Main | Favorable +3 | Favorable +6 |
|---|---:|---:|---:|
| 2024 selection | 632-591-1 (51.68%) | 766-457-1 (62.63%) | 866-357-1 (70.81%) |
| 2025 confirmation | 648-576-0 (52.94%) | 759-465-0 (62.01%) | 868-356-0 (70.92%) |
| Two-season orientation | 1280-1167-1 (52.31%) | 1525-922-1 (62.32%) | 1734-713-1 (70.86%) |

This is the first reader that improved main-line direction in both the
selection and confirmation seasons: +1.96 percentage points in 2024 and +4.08
points in 2025 versus the independent side evaluated at the same closing
line. The adjacent follow-movement thresholds from 0.5 through 2.0 points all
landed between 52.94% and 53.68% in 2025, so the confirmation is not isolated
to one exact cutoff. In 2025, the frozen all-game reader was 54.75% on home
selections, 51.14% on away selections, 52.96% on favorites, and 52.92% on
underdogs. Those subgroups are disclosure, not separately selected rules.

The evidence is directionally useful but not yet permission to claim a
profitable main-line betting release. The pooled main-line result has a 50.33%
Wilson lower bound, but at a flat -110 it is -3.36 units and -0.14% ROI. The
source retains closing lines and fair probabilities, not exact closing Spread
prices, and its captured manifest did not authorize movement-rule selection.
Historical public/sharp splits also remain unavailable. Accordingly, the
reader is the 2026 prospective candidate and produces a side for every game;
economic promotion still depends on the exact live price and the new locked
ledger rather than a blanket `No Play` label.

The fixed +3/+6 ladder is retained. Across the two reader seasons its pooled
empirical break-even prices are -165.40 and -243.20. The more conservative
Wilson-lower price ceilings are -152.42 at +3 and -222.90 at +6. A live
alternate can qualify only when its exact offered price is better than the
applicable ceiling; the ledger must store line, price, book, provider/fetch
timestamps, locked decision time, and release. This creates actual candidate
plays without pretending that a favorable line is valuable at any price.

This isolates the remaining paths. A better generic score or residual model
has not produced stable ATS signal. The current market blend cannot correct a
side because blending toward the evaluated line preserves the independent
edge's sign. A market reader can add value only from genuinely new,
timestamp-valid information—same-book movement, target-book-excluded prices,
source-specific splits, lineup changes, or a principled abstention rule—and
must prove that value prospectively. It cannot be approximated by a global
three-point adjustment or by treating the favorable-cushion curve as edge.

The curve is balanced enough to retain the competitor-comparable checkpoints:
at +3/+6, selected Spread favorites were 58.03%/67.32% and underdogs were
59.58%/69.20%; actionable Total Overs were 59.22%/66.87% and Unders were
60.38%/64.69%. This did not rescue the earlier score-only main-line Spread
lane. The all-game movement-reader candidate above supersedes that interim
endpoint while its exact-price validation continues prospectively.

The GOAT opening archive contains 7,354 rows across 1,230 games and 13 books,
with zero duplicate game/book keys. It stores one opening quote per game/book,
not an offered alternate-line ladder. Consequently, these are favorable-line
outcome curves, not alternate-wager returns. Historical alternate ROI, units,
and CLV are unavailable.

For orientation only, the actionable Total cohort's empirical break-even price
was -148.27 at +3 and -193.52 at +6. The more conservative Wilson-lower-bound
break-even prices were -129.38 and -168.08. The Spread diagnostic equivalents
were -144.65/-219.00 empirically and -129.00/-193.95 at the Wilson lower
bound. These are validation ceilings, not recommended prices: an offered line
must be better than the applicable ceiling and must survive a prospective
exact-price confirmation before it can become a wager.

The product decision is therefore:

- retain +3 and +6 for Spread and Total as same-cohort, competitor-comparable
  favorable-cushion tracking;
- label the curves as alternate-line diagnostics rather than historical bets;
- emit a prospective alternate candidate only when the exact live price is
  better than the frozen conservative ceiling; and
- prospectively archive the exact main line/price, alternate line/price,
  sportsbook, provider/fetch timestamps, locked decision timestamp, and model
  and calibration releases. Only that ledger can validate alternate-line ROI.

The reproducible operator is
`scripts/operator/audit_nba_alternate_lines.py`. It hard-fails if its rebuilt
main-line actionable Total cohort differs from the frozen tournament report.

Opening-stage results remain explicitly visible. In 2025, the selected
independent model's first-five-prior-games cohort contained 79 games and had
10.785 team-score MAE, 10.834 margin MAE, 18.270 Total MAE, and 64.56% winner
direction. The season-regime state removed the temptation to hard-code a
single historical opening-week scoring adjustment; the sign and magnitude of
opening Total bias did not repeat consistently across seasons.

### Nonlinear challenge rejected

Release `nba_nonlinear_challenger_audit_2026_10_15_r1_season_robust` compared
12 predeclared random-forest, extra-trees, and histogram-gradient-boosting
candidates across ratings, Four Factors, rotation, schedule, and season-regime
features. Every challenger was worse than the regularized incumbent on the
pre-confirmation rolling-origin joint score. The best random forest averaged
1.0046 relative to the incumbent (lower is better) and failed its selection
gate. It later happened to reach 69.19% winner direction in 2025, but that
single-season improvement is rejected as unstable rather than promoted.

### Forward 2026 market-reader state at 2026-10-15 16:16 ET

The latest production base owns the authoritative seven-day schedule and
Market Intelligence V2 observation path. No second writer is permitted. The
October 20 slate contains three scheduled games. The shared reader audit found:

- 562 provenance-bearing split observations across the three games;
- 100% event coverage for Moneyline, Spread, and Total splits;
- DraftKings ticket-plus-handle rows and BetMGM ticket-only rows preserved as
  different evidence rather than collapsed or imputed;
- zero `market_price_observations_v2` rows and therefore zero same-book price
  pairs or movement trails; and
- zero official candidates, correctly leaving the markets non-actionable.

A bounded SharpAPI odds probe returned 1,000 unique quotes, all for October
15-16, even when the request supplied October 20 or 21 as the date. It returned
zero opening-night prices. The current absence of October 20 prices is provider
availability, not permission to compare a split row with a fabricated price.
Schedule cards may populate; predictions and market reads must wait for real
playable quotes.

### Current promotion verdict

`promotionEligible` remains **false**. The current production champion and its
locked records remain unchanged. The research score core and Total lane are
validated historical candidates; Moneyline wagering, Spread wagering, split
influence, and movement-driven corrections are not validated. Forward 2026
captures must produce exact-book, exact-line, timestamped price sequences and
settled outcomes before any source-specific reader rule can receive prediction
or grade authority.

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
  is removed in the r2 candidate: the row retains its sportsbook, the best
  same-book ticket+handle observation is selected deterministically, and the
  adapter reports `unavailable_unvalidated_source` until the shared NBA
  capability gate clears. No member split or sharp-signal claim is authorized.
- The NBA adapter derives `lineOpenAmerican` from the earliest price observed
  for a side and compares it with a current best price. It does not preserve
  the opening spread/Total number in that DTO, and the opening and current
  prices need not be from the same sportsbook. This is not a valid basis for
  steam, reverse-line-movement, resistance, or buyback classification.
  The r2 candidate now exposes an opening price only when game, market, side,
  sportsbook, and exact Spread/Total number all match the evaluated current
  quote. This repairs basic price-comparison identity but does not, by itself,
  authorize any of those movement classifications.
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

Feature release `nba_point_in_time_features_2026_10_15_r12_date_only_start_fallback`
also adds a dynamic Elo benchmark, explicit offense-versus-opponent-defense
and Four-Factor matchup edges, prior-game player-minute rotation overlap,
rolling expected rotation size/concentration, venue-to-venue great-circle
travel, east/west time-zone direction, road-trip position, and venue altitude.
Both Elo and recursive opponent-adjusted offense/defense retain 75% of their
deviation from league average across an offseason. This prevents old roster
strength from entering opening night at full weight while preserving the
separate, explicit prior-season windows for the tournament to accept or reject.
Schedule state resets completely at the season boundary: the offseason is not
rest, and the prior season's final venue is not an opening-night travel origin.
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
`nba_professional_tournament_2026_10_15_r29_regime_anchored_residuals`. Its
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

The rating-family candidates include each team's leakage-safe 5-game,
15-game, and prior-season scoring-margin form alongside opponent-adjusted
offense, defense, pace, and Elo. These columns were present in the feature
artifact but are now explicitly declared rather than silently omitted from
every candidate family.

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

Every exact historical price now retains the side-specific sportsbook that
supplied it. The confirmation report discloses sportsbook counts and coverage
for each priced result, and the row-level ledger retains the exact book beside
each Moneyline, Spread, and Total price. A numeric quote without recoverable
book provenance may remain descriptive but cannot silently satisfy an
authoritative exact-price gate. Thresholds may be selected on the documented
opening line when the older season lacks recoverable prices, but confirmation
economics are graded only on genuine exact prices. That gate requires at least
100 priced decisions, exact-price coverage of at least 75% of all qualifying
signals, complete sportsbook provenance for the priced decisions, and positive
units. The report keeps the full signal count and priced-bet count separate;
missing provider prices cannot disappear from an ROI denominator.

Provider `null`, empty, and zero American-price fields are quarantined as
missing for that market rather than numerically coerced. Legitimate zero-point
pick'em lines remain valid. The completed 2025-26 capture still has full
advanced-stat team coverage, while exact opening-market availability is
reported separately by market instead of being inferred from the presence of
an odds row.

The tournament also writes a season-by-season coverage record for every
declared pregame feature, including selected status, finite-value coverage,
and distinct-value count. Fully missing, below-50%-coverage, and constant
features are summarized in the main report. Candidate eligibility is also
blocked unless at least 80% of that feature family's inputs have at least 50%
finite coverage and more than one observed value in the training partition.
That gate is fixed before selection and confirmation outcomes are consulted,
so a nominally rich model cannot pass while most of its supposed inputs are
absent or inert.

After confirmation, the research operator writes a checksummed, explicitly
non-promoted deployment candidate containing the exact feature order, training
medians, missingness indicators, standardization state, spline construction,
target coefficients, frozen market weights, probability scales, and actionable
thresholds. This closes the gap between naming a tournament winner and being
able to reproduce it in a future-game scorer. A separate replay path rebuilds
the design matrix using only that exported state and is contract-tested to
match the fitted model's home and away predictions to numerical tolerance.
The artifact remains ineligible for production until every promotion gate
clears.

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

### Unified final-score confirmation

The earlier result above tested movement in isolation. The final-product audit
instead froze the separately selected all-game two-point reader before opening
confirmation, selected only the score-blend weights on 2024-25, and then
reconstructed one home score, away score, margin, Total, winner, Spread side,
and alternate-line ladder. The selected recipe gives 25% authority to the
independent margin and Total and 75% to the complete pregame consensus. When
the home-spread move is at least two points, its direction owns the sign of the
remaining model-versus-current-line spread residual; its magnitude remains
bounded by the reconciled model disagreement.

On the untouched 1,224-game 2025-26 confirmation set, this one coherent tuple
improves the independent benchmark as follows:

| Metric | Independent | Unified final |
| --- | ---: | ---: |
| Team-score MAE | 9.562 | 9.209 |
| Margin MAE | 11.345 | 10.806 |
| Total MAE | 15.237 | 14.665 |
| Winner accuracy | 68.14% | 69.61% |
| Home-win Brier | 0.20468 | 0.19354 |
| Main Spread | 598-626, 48.86% | 648-576, 52.94% |
| Favorable +3 | 57.43% | 62.01% |
| Favorable +6 | 66.83% | 70.92% |

The unified main-spread 95% Wilson lower bound is 50.14%. At a hypothetical
flat -110 it returns +13.09 units, +1.07% ROI; this is not an exact-price
claim. Favorites are 268-238 (52.96%) and underdogs are 380-338 (52.92%). The
movement-active cohort is 245-194 (55.81%); the movement-inactive cohort is
403-382 (51.34%). Every game retains a prediction. The +3 and +6 accuracy
figures are retained, but their economics remain unavailable until their exact
prices are captured; they must never be priced as though they were -110.

The score and winner gates pass, as does the main-spread historical performance
gate. The Total side against the sharper closing line remains only 634-590
(51.80%) and is not independently profitable evidence. The separately selected
opening-line actionable Total lane remains 470-392 (54.52%) with +24.68 units
and +3.54% exact-price ROI on 697 priced decisions. These are different line
and decision populations and must not be blended into one advertised record.

BALLDONTLIE GOAT documents historical opening odds with `opened_at`, but its
regular odds endpoint returned zero rows when probed for completed 2025-26
games. The probe was stopped after three 50-game batches. GOAT therefore does
not retroactively supply the missing same-book T-60/closing sequence. Its
regular odds endpoint is now represented as `current_odds`, never
`closing_odds`; it can support prospective capture only. The unified historical
recipe has cleared its performance gate but still lacks production authority
until the exact same-book opening/current/T-60 sequence, target-book exclusion,
and exact main/+3/+6 prices are proven for the runtime path.

### Runtime-parity and current-board repair

The historical candidate is not the score engine currently used by the member
route. The site still calls the hand-built
`nba_v2_independent_first_2026_10_06_r1` efficiency formula, while the
confirmation above starts from the selected `ratings_schedule`, coherent
margin-plus-Total ridge model. Applying the 25/75 reconciliation to the old
runtime would therefore be a different, unvalidated model. A portable
TypeScript scorer now implements the selected deployment-artifact transform;
25 rows scored independently in Python and TypeScript agree to a maximum
absolute difference of `2.8422e-13`. The runtime gap is now closed by a compact,
versioned five-season bootstrap and an append-only current-season finalized-game
input. The compact artifact stores one aggregate team box per game because none
of the selected 75 fields consumes player-level rotation detail. Twelve rows
spanning all five seasons reproduce every selected feature to less than
`1e-10`; two opening-night games score through the complete runtime path in
under one second in the focused test. The daily sole writer collects bounded
finalized BALLDONTLIE game/box evidence into
`nba_professional_game_inputs`; the runtime fails closed on a missing table,
unknown team identity, malformed row, artifact mismatch, or missing tip time.

The first current-board audit also found a separate feed defect. The NBA line
refresh sent `/odds?league=nba&date=...`, although SharpAPI documents league,
market, sportsbook, and cursor filters—not a date filter. The provider ignored
the parameter and the old offset loop fetched an unrelated board, producing
zero matches and zero stored lines for all 14 scheduled October 20-22 games.
The corrected reader discovers exact provider event IDs, verifies team and
start-time identity, then fetches `moneyline`, `point_spread`, and
`total_points` independently with cursor pagination and rejects live/stale
rows. A credential-backed October 20 dry run moved from 2,000 fetched / zero
matched / zero parsed to three matched event IDs, 940 matched raw observations,
and 316 canonical line rows across the three scheduled games.

Main-line history now stores the same canonical per-book rows used by the
current `lines` table. It no longer archives multiple unflagged alternates from
one response as though they were successive main-line movement. A separate
alternate-price contract remains required for +3/+6 economics. The movement
reader's live input is explicitly `first_tracked_per_book_consensus`, not a
provider-labeled opener, until a true opener source is joined.

The candidate price reader now also excludes the sportsbook supplying the
evaluated best price before constructing the exact-line, two-sided no-vig fair
reference for Moneyline, Spread, and Total. If no independent comparison book
remains, the fair probability is unavailable and the existing grade path cannot
promote the quote. Split observations remain context-only; no ticket/handle row
can alter the score or grade in this candidate.

### Current-board promotion/demotion rehearsal

A credential-backed, read-only rehearsal used the corrected exact-event
SharpAPI collector and the same DTO/grade code intended for production. It
covered all three October 20 games and all eleven October 21 games: 14 games,
42 markets, and 1,317 canonical per-book line rows in the final prepublication
rerun. The incumbent produced 12
Lean/Best Angle markets; r2 produced 10, with four promotions, six demotions,
and six side changes. October 20 moved 3 to 2 actionables (one promotion, two
demotions); October 21 moved 9 to 8 (three promotions, four demotions).

The contraction is explicit rather than a hidden no-play device. All four
promotions are Moneyline reads created by the confirmed scorer. Five of the six
demotions are Spread/Total reads whose incumbent probabilities were materially
more confident than the r2 residual calibration; the sixth is a Moneyline
demotion. Historical confirmation does not justify lowering the 55%
actionability boundary to restore those rows: unified Total direction is only
51.80%, and movement-inactive Spread is 51.34%. R2 therefore retains ten real
actionables instead of manufacturing two replacements from unvalidated
thresholds. The paired local audit artifacts are
`nba_professional_r43_current_board/2026-10-20.json` and
`nba_professional_r43_current_board/2026-10-21.json`.

After reviewing that exact impact, the owner approved the r2 cutover and
prospective official Spread tracking beginning October 20 with no historical
backfill. The writer, coherence gate, and T-60 lifecycle therefore treat
Moneyline, Spread, and Total as one three-row official tuple; the older
context-only Spread findings above remain historical descriptions of r1, not
the r2 publication contract.

The release-transition audit also found that the NBA writer previously looked
up only its current `model_version`, which could make an older immutable lock
invisible after a release bump. The candidate now resolves all releases for the
game/market slot, gives any single locked row unconditional precedence, fails
closed on ambiguous duplicates, and advances only a sole unlocked legacy row
in place. Future lock snapshots store the complete NBA game DTO in all three
official-market records; the paired reader accepts it only when the records are
byte-identical, so later model or DTO changes cannot reinterpret the score,
sides, probabilities, grades, or prices members saw. Focused tests cover old
lock precedence, duplicate-lock rejection, exact DTO restoration, mismatch
failure, and complete score/pick/exact-price/grade-input coherence. The full
repository `verify:model-change` gate passed after these changes.

The final direct member-pipeline rehearsal also proved the intended deployment
fail-closed behavior: the primary Supabase PostgREST schema cache does not yet
contain `nba_professional_game_inputs`, so no r2 member response can be
published until migration v44 is applied and the same rehearsal returns the r2
release with coherent scores. This is a deployment gate, not permission to
fall back to default features or silently run the old model under the r2 ID.

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
