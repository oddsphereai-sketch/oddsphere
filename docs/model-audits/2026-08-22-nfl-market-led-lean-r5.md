# NFL market-led moneyline candidate — r5 rejection audit

Date: 2026-08-22
Scope: NFL regular-season moneyline; chronological shadow research and current Week 1 multi-book scoring
Production predictions, grades, stakes, tracking, readers, crons, and release pointers changed: **no**

## Decision

**Reject r5 for production.** Preserve it only as a reproducible shadow
candidate.

The market-led probability is a useful starting baseline: it treats the no-vig
market as a strong prior and adds a regularized football correction. It improves
pooled 2024-2025 probability scores slightly. But the product-compatible,
uncapped exact-price decision rule loses in 2025, has weak positive-CLV
frequency, and has a wide uncertainty interval. The earlier maximum-two-actions
version is withdrawn because a quota suppressed qualifying plays and masked the
2025 failure. Bet count must remain an output.

The current authoritative Week 1 evidence produces eight current shadow
candidates when every named-book price is evaluated against the other books'
consensus. Those rows are valuable forward research, not member recommendations:
all 16 games remain **Bet Grade Held**, with zero production-actionable bets.

Best Angle remains unavailable. No production promotion, demotion, regrade, or
stake change is authorized by this audit.

## Why this is a defensible baseline

The design follows the parts of the football-prediction and market-efficiency
literature that are operationally useful for Daily Edge:

- Use a dynamic, opponent-adjusted football state rather than recent record or
  raw points alone. Glickman and Stern's NFL state-space work is the conceptual
  benchmark for evolving team strength:
  <https://www.tandfonline.com/doi/abs/10.1080/01621459.1998.10474084>.
- Treat the sportsbook market as a strong prior, not as a nuisance variable.
  Gray and Gray document both efficiency and bounded opportunities in NFL
  markets: <https://doi.org/10.1111/j.1540-6261.1997.tb01129.x>.
- Evaluate the probability at the exact price offered to the bettor. A side is
  not actionable merely because it is likely to win; it must have nonnegative
  modeled value versus the sportsbook price.
- Judge calibration with Brier score and log loss, then judge the decision layer
  with locked-price units, closing-line movement, season stability, and weekly
  portfolio counts. Hit rate alone is not sufficient.

The model is not market-only. The probability input contains the current
no-vig moneyline probability plus the independently built r2 point-margin
projection. That point projection starts from the operational opening spread and
adds a strongly shrunk correction from opponent-adjusted efficiency, quarterback
history and continuity, roster/depth roles, and player availability.

## Immutable releases and exact policy

- Tournament: `nfl_market_led_lean_tournament_2026_08_22_r5`
- Model: `nfl_market_led_moneyline_shadow_2026_08_22_r5`
- Calibration: `nfl_market_led_price_calibration_shadow_2026_08_22_r5`
- Decision: `nfl_market_led_moneyline_lean_shadow_2026_08_22_r5`
- Source point model: `nfl_pregame_market_residual_shadow_2026_08_21_r2`
- Production behavior changed: no
- Production promotions/demotions: 0/0

The rejected decision policy is fixed as:

1. Evaluate both moneyline sides at one named-book, two-sided quote.
2. Use the side with the larger model-implied expected value.
3. Require a price from -200 through +200, nonnegative expected value, and a
   nonnegative model-versus-no-vig-market probability gap.
4. Evaluate every qualifying exact-price edge with no weekly cap or quota.
5. Never create a Best Angle from this release.

The coherent recommendation tuple is always model probability, evaluated
sportsbook and American price, no-vig market probability, grade, decision
timestamp, model release, calibration release, and decision release. A later
quote may be displayed separately, but it cannot inherit the older grade.

## Chronological probability evidence

The probability family and regularization were selected on 2023 after fitting on
2021-2022. The selected football-plus-market probability was then refit only on
prior seasons for each 2024 and 2025 chronological evaluation.

| Probability metric | Candidate | No-vig market | Candidate improvement |
|---|---:|---:|---:|
| 2024-2025 pooled Brier | **0.206865** | 0.208131 | +0.001267 |
| 2024-2025 pooled log loss | **0.601061** | 0.603801 | +0.002740 |
| 2024-2025 pooled 10-bin calibration error | **0.038779** | 0.054429 | +0.015651 |
| 2024 Brier | **0.199404** | 0.203075 | +0.003671 |
| 2025 Brier | 0.214326 | **0.213188** | -0.001138 |

The pooled probability improvement is worth continuing to research, but it is
not season-stable: the candidate is worse than the market in 2025.

## Uncapped exact-price evidence

| Period | Actions | Record | Units | ROI | Positive-CLV rate | Mean CLV |
|---|---:|---:|---:|---:|---:|---:|
| 2023 policy selection | 99 | 67-32 | +16.816 | +16.99% | 46.46% | +0.00111 |
| 2024 confirmation | 96 | 62-34 | +11.589 | +12.07% | 43.75% | +0.00204 |
| 2025 confirmation | 108 | 63-45 | **-2.210** | **-2.05%** | 37.96% | +0.00071 |
| 2024-2025 pooled | 204 | 125-79 | +9.379 | +4.60% | 40.69% | +0.00134 |

A deterministic 20,000-draw weekly-cluster bootstrap puts pooled confirmation
ROI at **-7.67% to +17.36%** (95% interval), with positive units in 76.75% of
resamples. Removing each season's largest win leaves 2024 at +9.789 units but
2025 at -3.119 units. The positive-each-season and largest-win-independent gates
therefore both fail.

These results reject r5 as a live grading policy. The capped version's small
positive 2025 result was not robustness; it was selection suppression.

## Current authoritative Week 1 forward audit

The read-only scorer consumed the latest immutable r2 multi-book evidence row
for each of the genuine 16 Week 1 games. Every row was captured at
2026-08-22T13:50:56.934Z and had at least five comparable books. For each exact
target offer, the scorer excludes that sportsbook and forms the market prior
from the remaining comparable books, preventing the evaluated price from
grading itself.

Eight games clear the rejected r5 threshold as current shadow candidates:

| Shadow candidate | Exact target offer | Model | Other-books consensus | Gap | EV / unit |
|---|---:|---:|---:|---:|---:|
| Los Angeles Rams ML | DraftKings -185 | 66.62% | 63.37% | +3.25 pp | +0.0263 |
| Tennessee ML | FanDuel -142 | 59.31% | 56.89% | +2.42 pp | +0.0107 |
| Baltimore ML | Caesars -182 | 66.21% | 62.51% | +3.71 pp | +0.0259 |
| Chicago ML | BetMGM -145 | 64.70% | 57.45% | +7.25 pp | +0.0932 |
| Houston ML | DraftKings -102 | 55.99% | 50.23% | +5.76 pp | +0.1088 |
| Minnesota ML | BetRivers -110 | 56.50% | 51.89% | +4.61 pp | +0.0785 |
| Dallas ML | BetMGM -145 | 65.22% | 57.01% | +8.21 pp | +0.1020 |
| Kansas City ML | BetMGM -150 | 60.58% | 57.77% | +2.81 pp | +0.0096 |

This proves the system can surface a nonempty, exact-price Week 1 slate without
a bet-count quota. It does not make the eight rows publishable: the underlying
decision policy failed 2025 confirmation.

The snapshot matched all 32 expected quarterbacks, but all 32 were
**projected** and zero were confirmed. Quarterback confirmation is a
board-health hold, not an ordinary No Play. SharpAPI splits were also
unavailable. Those health facts must remain visible and cannot promote or demote
a bet.

## Reader and grading contract

- Every Week 1 moneyline offer is evaluated; qualifying exact-price edges are
  not suppressed by a quota.
- The eight current labels are shadow candidates, not member-facing Leans.
- Best Angle remains unavailable for r5.
- Outcome confidence remains separate from Bet grade.
- Splits and line movement are displayed as market evidence. They cannot add
  probability or promote a grade until comparable timestamped evidence supports
  that behavior.
- Spread and total remain separately blocked. A moneyline candidate cannot be
  copied into those markets or used to disguise an all-Over score defect.
- At T-60, any eventual production tuple must satisfy the existing maximum lag,
  freeze, tracking, and later-price-context boundaries.

## Known evidence limitations

1. The competitive -200 to +200 band was retained after the broader r4 policy
   family and its 2024-2025 results had been inspected. Those seasons are useful
   historical confirmation, not a pristine final holdout.
2. Historical decisions use provider-native DraftKings openings. The Week 1
   audit uses current multi-book quotes and leave-one-book-out consensus; market
   stage is not interchangeable.
3. Historical player availability is a near-kick weekly report. It is not treated
   as opening-time knowledge.
4. The current forward export is read-only and cannot publish a recommendation.
5. Pooled confirmation is positive, but 2025 is negative and the uncertainty
   interval crosses zero.

## Production blockers

1. The uncapped, product-compatible r5 policy loses in 2025 and does not pass
   season-stability or largest-win-independence gates.
2. The eight current candidates are read-only shadow rows outside the
   authoritative prediction writer.
3. All expected Week 1 quarterbacks are projected rather than confirmed.
4. This release has no timestamp-valid 2026 T-60 probability, price, CLV, or
   settlement evidence.
5. SharpAPI split history remains unavailable; splits cannot repair or promote
   the failed decision policy.
6. Spread, total, and calibrated score-distribution candidates remain unresolved.

The live Week 1 board's evidence-only **Bet Grade Held** state is therefore
correct. r5 supplies a concrete research slate to monitor, not permission to
show users an unvalidated Lean.

Official NFL lifetime tracking still begins only with an approved, pre-kick
locked regular-season decision. Preseason remains excluded.

## Verification and rollback

Required verification includes Python compilation, a full r5 chronological run,
generated-report invariant checks, the read-only 16-game multi-book forward
export and scorer, focused football tests, `npm run verify:model-change`, the
application build, and integration safety against current `origin/main`.

Rollback is removal of the isolated r4/r5 research scripts, tests, exporter, and
this audit. Generated joblib/JSON artifacts are ignored local evidence. No
production state or member behavior requires rollback because r5 is rejected
and unpublished.
