# NBA chronology-fitted market consequence

Owner direction: make the production reader interpret named-book movement and
apply it to the final score without blindly following a market level. Measure
the released procedure forward after publication. No guarantee of future
accuracy, bookmaker intent, or identification of every market event is made.

Own branch: `codex/nba-market-consequence-20261031`.
Starting remote-main base: `c3a557feff3c0cc249243b08d995b4ed20009ad9`.

## Releases and scope

- model: `nba_professional_unified_2026_10_31_r30_chronology_fitted_innovation`
- marriage: `nba_market_marriage_2026_10_31_r31_chronology_fitted_innovation`
- grade: `nba_grade_policy_2026_10_31_r20_chronology_fitted_final_forecast`
- market consequence: `nba_market_consequence_2026_10_31_r5_chronology_fitted_innovation`
- posture: `nba_named_book_posture_2026_10_31_r6_deferred_numeric_direction_retained`

The change is limited to unlocked and future NBA forecasts. Existing locked
payloads retain exact writer and reader precedence. It adds no prediction
writer, timer, provider call, or table and remains under the shared
`prediction_pipeline:nba` lease.

## Decision law

For a margin or Total coordinate, define the independent forecast `I`, the
named-book opening coordinate `A`, and the latest coordinate `C`. Line and
paired juice are converted to a coordinate with the released NBA residual CDF.

1. `C=A`: no numeric consequence.
2. `C-A` points from `A` toward `I` without crossing `I`: confirmation only;
   no second copy of information already expressed by `I` is added.
3. `C-A` points away from `I`: the full movement is corrective innovation.
4. The move crosses `I`: only the portion beyond `I` is innovation.

The final coordinate is `I + beta * innovation`, with frozen coefficients
`beta_margin=1.813` and `beta_total=1.0`. These coefficients are explicit
release constants. There is no per-game weight, dynamic model/market blend,
source-count vote, cross-book median, arbitrary point cap, minimum-move gate,
or sign-triggered adoption of the complete market forecast.

Three independent outside AI reviews rejected the prior r3 dynamic-scale and
de-duplication design as unidentified hidden weighting. Each concluded that if
numeric market evidence is to alter a scalar score, the honest replacement is
an explicit, fitted, continuous and translation-equivariant influence law on
the exact source/time contract. R5 follows that shared requirement; none of the
reviewers approved r3 or an arbitrary fixed model/market percentage.

Margin `1.813` is the proper-score coefficient estimated on development
seasons 2023-24 and 2024-25. Total `1.0` is the predeclared structural
no-amplification transport choice: the unconstrained fitted coefficient made
the Total side decision worse. The untouched chronology-later 2025-26 season
was not used to select either value.

Same-book ML and Spread are two fixed-scale measurements of one margin. Exact
American-price quote bins create small coordinate intervals. Intersecting
intervals yield one feasible margin. If the contracts conflict, Spread has
numeric authority because it is the direct margin contract and is the family
used to fit the release; ML remains diagnostic. The rejected r3 reader inferred
a second game-specific scale from transformed probabilities. At ordinary
one-tick precision that inversion was unstable and could erase valid Spread
movement, so it is forbidden by regression tests.

Posture r6 preserves the direction of an ML move even when its numeric score
authority is deferred to Spread. It labels that deferral and can still report
movement against the final pick as resistance; numeric deferral no longer
silently turns observed directional evidence into a neutral member signal.

Across books, one observed causal leader authors each coordinate. Followers do
not add amplitude. Later frontier extension, retracement, cancellation, and
reversal remain chronological. Unequal simultaneous effects without a causal
leader fail closed; they are not averaged. Static levels still enter price
value and opposition posture and can affect the final grade, but cannot invent
score points without observed chronology.

## Frozen evidence and separation

Development and confirmation inputs were frozen before the release constants:

| Artifact | SHA-256 | Role |
| --- | --- | --- |
| `/private/tmp/nba-joint-market-oof.csv` | `6360144d6f3248468142c4bbd80cb773c469c7cc2e385297795077cde7e091ec` | point-in-time independent OOF forecasts |
| `/private/tmp/nba-espn-feature-open-close.csv` | `876f9707e5d95aebc49c642e63f8cb9d25bb54638a50a7b725b248166ea21c2d` | named-book open/close, 2023-24 through 2024-25 |
| `/private/tmp/nba-espn-feature-open-close-2025.csv` | `906d16705f51c3536033c678e44216fc6364e14c8321dcf051a99e139c71370b` | untouched 2025-26 confirmation |
| `/private/tmp/tr_oof_games_2023_2024.csv` | `50951e63d5d4507d315c2e90a23f595b7927adffe94d0b29860a41bc27343a33` | live-timing transport fixture IDs |

The combined panel contains 3,692 games: 1,231 development games from each of
2023-24 and 2024-25 and 1,230 chronology-later 2025-26 games before one invalid
market row is removed. Independent OOF forecasts come from the feature-time
model; market movements are joined separately, not used to rebuild the
independent forecast.

## Results

On 1,229 untouched 2025-26 games:

| Measure | Independent | Candidate |
| --- | ---: | ---: |
| Margin MAE | 11.3770 | 11.0520 |
| Margin RMSE | 14.5350 | 14.1661 |
| Spread-side direction | 49.064% | 51.424% |
| Margin prediction SD | 6.876 | 7.665 |
| Predictions with `abs(margin)>=10` | 17.33% | 21.56% |
| Total MAE | 15.2131 | 14.9964 |
| Total RMSE | 19.125 | 18.873 |

Paired game bootstrap 95% intervals for candidate-minus-independent MAE were
`[-0.477,-0.178]` margin and `[-0.341,-0.095]` Total. Direction improved, but
its bootstrap intervals included zero; this release does not claim proven ATS
or Total-side profitability.

An exact 25-game October 28-31 production-source replay found that the prior
reader applied zero score consequences. The candidate applied margin evidence
to 13 games and Total evidence to 15: margin MAE 12.6247→12.4569, Total MAE
18.0364→17.2495, and winner accuracy remained 64%. This is a small, fixed
functional replay, not a general performance estimate.

The current unlocked six-game/18-market zero-write rehearsal is stored at
`/private/tmp/nba-continuous-current-board-20261031-r6.json`, SHA-256
`a04c9abb4558e52cb6e0788054092d8e2bbbb104a2983bd93aa7c23a787d9c91`.
It used zero outcomes, provider calls, and writes. Margin and Total consequences
were applied in four games; MIN-SA and OKC-HOU had none. Actionables changed
2→9: eight promotions, one demotion, and all nine actionables are Leans. The
PHI-CHA Total demotion is paired with the eight tested promotions. Some promotions are
from the already reviewed final-forecast grade policy rather than a numeric
market consequence. The live reader check must confirm this disclosed expansion.

The named-book confirmation is based on close snapshots. A separate historical
T-60 snapshot panel checks transport to the production lock window. Its sources
are anonymous TeamRankings Book1/Book2/Book3 and must never be relabeled Circa,
Pinnacle, or another named sportsbook. The frozen r5 law was not retuned on this
panel. On the chronology-later 2024-25 segment, Book1 had 1,212 games and improved
margin MAE 11.0658→10.8451, winner accuracy 66.83%→68.15%, and exact-line
direction 50.13%→50.88%. Book2 had 1,088 games and improved margin MAE
11.1609→10.9033, winner accuracy 66.45%→67.10%, and exact-line direction
50.09%→51.01%. Prediction SD increased from 6.45 to 7.56/7.30 and the share
with `abs(margin)>=10` from 14.1%/14.2% to 20.6%/19.5%. Book3 did not meet
the predeclared minimum coverage and is not reported. Because some game outcomes
overlap the separate coefficient-development seasons, this is timing/source
transport evidence, not a second untouched outcome confirmation.

Transport receipts: panel `/private/tmp/nba_tr_t60_final.csv` SHA-256
`af26f631b003f3924aefef90c8091aed40d8e582c0a522ee03e8c72ed803868b`;
manifest `/private/tmp/nba_tr_t60_final.manifest.json` SHA-256
`5ae662136aee1e067239205ac3a498c0ba940f8b012acae3034e3554cdf1f971`;
analysis `/private/tmp/nba_tr_t60_final.analysis.json` SHA-256
`57c5aaf5421b2ad07f389d13f6feaa0d2b084a16fb35c1270c70c7979d39ebaa`.
The manifest contains 2,458 game rows and exact source hashes/timezone rules.

## Functional and safety contract

Focused tests cover no movement, movement toward the model, movement away,
crossing/overshoot, continuity at the crossing point, side-reflection symmetry,
one-tick perturbations, quote-bin uncertainty, ML/Spread conflict with direct
Spread authority, first-release full-trail bootstrap, retries without
compounding, input-revision lineage, target-book exclusion, persistence, and
exact locked-record precedence.

Publication also requires the focused NBA suites, `npm run verify:model-change`,
fresh-main integration, a clean committed worktree, integration-safety proof,
an up-to-date protected pull request, and post-merge production verification of
release identifiers, lease/cron health, data coverage, final-score coherence,
reader output, and locked-record immutability.

## Rollback

Roll back model r30, marriage r31, grade r20, and consequence r5 together to
the immediately prior production release. Never reinterpret or rewrite an
existing locked snapshot. The rejected r3 dynamic-scale implementation is not
a permitted rollback target.
