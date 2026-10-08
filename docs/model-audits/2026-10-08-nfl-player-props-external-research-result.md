# NFL player props external-research result

Date: 2026-10-08  
Starting production base: `0c4d31d21dd6aae08eb7b49cf89cc4d1ee8ddc6a`  
Decision: keep every released market unchanged; continue in shadow

## Bottom line

This audit confirmed the owner's diagnosis: the released independent model is not accurate enough,
and its raw probabilities are materially overconfident. Public football data can improve portions of
the point model, but none of the tested families passed the complete current-season point,
distribution, actionable-retention, and price-evidence gates. No projection, probability, grade,
stake, lock, writer, release identifier, or member surface changed.

The strongest new result was a component model for Rushing Yards and Receptions. It improved the old
independent point head on the matched 2026 locked subset, but not the published/market-informed point
or probability benchmarks, and its game-clustered interval still included zero. That is useful model
progress, not production evidence.

## External methods and inputs actually tested

The research used published primary documentation rather than relying only on internal experiments:

- [NFL Next Gen Stats](https://operations.nfl.com/game-operations-logistics/technology/performance-tracking-data-next-gen-stats/)
  and the [nflverse NGS dictionary](https://nflreadr.nflverse.com/articles/dictionary_nextgen_stats.html)
  for CPOE, air-yards profile, time to throw/line, cushion, separation, expected YAC/YACOE,
  expected rushing yards/RYOE, box exposure, and rushing efficiency;
- [nflfastR expected-points, win-probability, completion, xYAC, and xPass models](https://opensourcefootball.com/posts/2020-09-28-nflfastr-ep-wp-and-cp-models/)
  for held-out, play-state-aware opportunity modeling;
- [ffopportunity](https://github.com/ffverse/ffopportunity) for the separation of expected opportunity
  from performance over expectation;
- [FTN charting via nflverse](https://nflreadr.nflverse.com/articles/dictionary_ftn_charting.html)
  for motion, play action, RPO, screens, box counts, blitz/pass-rusher counts, catchability,
  contested balls, drops, and quarterback movement;
- [PFR advanced passing data via nflverse](https://nflreadr.nflverse.com/articles/dictionary_pfr_passing.html)
  for pressure, blitz, hurry, hit, bad-throw, and drop context;
- [nflverse depth charts](https://nflreadr.nflverse.com/articles/dictionary_depth_charts.html), including
  a timestamp from 2025 forward for point-in-time role evidence; and
- tracking-based route and rushing research, including
  [Route Identification](https://arxiv.org/abs/1908.02423),
  [NFL Ghosts](https://arxiv.org/abs/2406.17220), and the NFL Big Data Bowl rushing work on
  [expected yards](https://operations.nfl.com/media/4207/bdb_pash_powell.pdf),
  [blocking/defender context](https://edge-operations.nfl.com/media/4206/bdb_davis.pdf), and
  [rushing evaluation](https://operations.nfl.com/media/4204/bdb_ploenzke.pdf).

The checksum-pinned cache contains 61 public source files. The final feature matrix contains 142,160
player/game rows across 2,703 games, including 3,300 rows for 2026 Weeks 1-4. Current-season feature
coverage is 100% for state/position/weather, 73.1% for PFR, 73.0% for FTN, and 55.3% for NGS. Missing
NGS publication is retained as missing, never interpreted as zero skill.

The audit also corrected two previously discovered identity errors: 21 `prior_opponent_allowed_*`
and 42 `matchup_opponent_allowed_*` features had described the player's own defense instead of the
actual opponent. New shadow artifacts use the correct opponent; released locks remain untouched.

## Frozen historical tournament

The split was 2016-2023 training, 2024 selection, and 2025 confirmation. The 2026 Weeks 1-4 replay
was opened only after a candidate name was frozen. It is still diagnostic because earlier OddSphere
audits had already inspected the season.

| Market | Candidate result through 2025 | Decision before 2026 |
|---|---|---|
| Passing Attempts | MAE 8.68→7.56 in 2024; 8.43→7.67 in 2025 | freeze state + NGS Poisson candidate |
| Passing Completions | 5.87→5.20; 5.65→5.14 | freeze state + pressure Poisson candidate |
| Passing Yards | 67.85→61.12; 66.63→60.87 | freeze full-external absolute-error candidate |
| Rushing Attempts | 3.154→3.135 in 2024; 3.054→3.073 in 2025 | reject |
| Rushing Yards | 19.04→18.91; 18.56→18.50 | freeze 75% component hierarchy |
| Receptions | 1.533→1.517; 1.460→1.455 | freeze 75% component hierarchy |
| Receiving Yards | 19.96→19.89; 19.52→19.69 | reject |

The Rushing Yards and Receptions hierarchy forecasts team rush/target volume, forecasts the player's
share using shifted role/snap/external inputs, and then forecasts yards-per-carry or catch rate. This
outperformed the earlier normalization-only team-budget experiment, which had inherited weak player
role scores.

## Exact 2026 locked replay

The immutable ledger contains 207 canonical scopes across 47 games. Weeks 1-3 full boards were not
retained, so this can measure exact locked decisions but cannot honestly reconstruct every possible
promotion and demotion.

### Passing candidates

- 35 of 36 locked passing scopes matched; Tyson Bagent Passing Completions lacked eligible prior
  history.
- Candidate MAE was 38.17 versus 39.00 for the locked independent point, but RMSE worsened from
  64.47 to 71.92.
- Direction accuracy fell from 62.9% to 48.6%, and actionable-direction retention was only 60%.
- Candidate Brier was 0.3081 versus 0.2493 for the market probability.
- The game-clustered 95% interval for candidate-minus-independent MAE was `[-11.21, 8.15]`.

The historical passing gains did not survive the actual offered subset. All three candidates are
rejected.

### Rushing Yards and Receptions component candidates

- 78 of 86 locked scopes matched (90.7% coverage) across 39 games.
- Combined candidate MAE improved from 7.726 to 7.528 and RMSE from 15.152 to 14.692 versus the
  locked independent point.
- The published point remained better: MAE 7.055 and RMSE 13.617.
- Direction improved only from 47.4% to 48.7%; actionable-direction retention was 88.5%.
- Candidate Brier improved on the old independent probability (0.2865 versus 0.3250) but remained
  materially worse than the market (0.2500) and published final probability (0.2545).
- The game-clustered 95% interval for candidate-minus-independent MAE was `[-0.809, 0.260]`, which
  includes zero.

By market, the candidate improved Receptions MAE from 2.215 to 2.041 and Rushing Yards from 18.135
to 17.891, but neither beat the corresponding published point (1.916 and 16.762). The point model is
moving in the correct direction; the distribution and product gates are not.

## Market reading result

Market reading remains a separate diagnostic rather than an input to the independent projection.
Same-book opening line and price evidence existed for all 207 canonical scopes. Market movement that
supported the locked pick went 21-16 (56.8%); movement against it went 42-48 (46.7%). The
game-clustered 95% interval for the win-rate difference was approximately -11.3 to +33.2 percentage
points, so the current sample does not authorize a sharp-book label, automatic flip, or fixed weight.

The product should preserve three visibly separate objects: independent projection/distribution,
market state/movement, and the final decision. Market information may later gate or annotate a play;
it should not silently rewrite the independent forecast.

## What is still missing

1. **Point-in-time role and availability.** The public depth-chart source is now cached for
   2016-2026, and 2025+ rows include observation timestamps. It was discovered after the frozen
   tournaments and was not backfit into their results. This is the next safe source for starter,
   backup, slot/rank, and role-change evidence at the exact lock time.
2. **Cold-start and promoted-player priors.** Nine exact scopes across the two replays lacked enough
   prior player history. Depth rank plus position/team priors must cover rookies, backups, and newly
   promoted players without falling straight back to the market.
3. **Routes, alignment, and assignment-level matchups.** Public in-season data does not provide a
   complete pregame route-participation, OL/DL assignment, or CB/WR coverage feed. Aggregate pressure,
   box, and position-bucket proxies are useful but are not equivalent. A licensed feed should be
   evaluated if these features are required in production.
4. **Teammate redistribution.** The hierarchy needs timestamped inactive/limited/expanded states and
   explicit vacated carry/target redistribution, not only shifted participation and snap history.
5. **Full-board preservation.** Every offered candidate and both sides/prices must be snapshotted at
   lock. Without it, symmetric promotion/demotion and units cannot be reconstructed for Weeks 1-3.

## Release decision

No production model change is authorized. The next shadow release should add lock-time depth/role
features and cold-start priors, preserve a complete current board, and evaluate on a later untouched
window. The current independent model should remain separate from market reading, while the product
may display market movement as timestamped context with no unsupported “sharp” claim.
