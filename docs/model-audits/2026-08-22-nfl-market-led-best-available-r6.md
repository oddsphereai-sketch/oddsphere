# NFL market-led best-available moneyline candidate — r6

Date: 2026-08-22

Scope: NFL regular-season moneyline; chronological shadow tournament and latest
authoritative Week 1 multi-book scoring. Production predictions, grades, stakes,
tracking, crons, model releases, and the single forward writer changed: **no**.
The later product-safety adapter described below changes only how an existing
validation hold is rendered; it does not make r6 authoritative or actionable.

## Decision

Retain r6 as the **best currently evidenced Lean candidate** and the next model
to integrate in shadow behind the single authoritative NFL writer. It is not a
perfect system and it is not represented as one. It clears the frozen
chronological gates that r5 failed, without a weekly quota or a forced minimum
number of bets.

The historical candidate is Lean-eligible, not Best-Angle-eligible. Production
remains blocked because all 32 current Week 1 quarterback designations are
projected rather than confirmed, no r6 tuple has passed through the authoritative
writer and lock boundary, and timestamp-valid 2026 T-60/CLV/settlement evidence
does not yet exist.

## Frozen releases and policy

- Tournament: `nfl_market_led_best_available_tournament_2026_08_22_r6`
- Model: `nfl_market_led_moneyline_shadow_2026_08_22_r6`
- Calibration: `nfl_market_led_price_calibration_shadow_2026_08_22_r6`
- Decision: `nfl_market_led_moneyline_lean_shadow_2026_08_22_r6`
- Forward audit: `nfl_market_led_week1_multibook_forward_shadow_2026_08_22_r6`
- Source point model: `nfl_pregame_market_residual_shadow_2026_08_21_r2`

The product constraint was frozen before confirmation: evaluate every qualifying
exact-price edge, with no weekly cap and no forced minimum. The 168 uncapped
policies varied minimum EV, minimum model-versus-market gap, and four bounded
price lanes. Eligibility and ranking used only 2023 after the probability family
was trained on 2021-2022.

The deterministic 2023 winner was:

1. Evaluate both moneyline sides and every comparable named-book offer.
2. Build the market prior without the target sportsbook.
3. Select the exact side/book tuple with the greatest modeled EV per game.
4. Require price from -300 through +300, model EV at least zero, and model gap
   at least zero.
5. Surface every qualifying tuple; bet count remains an output.
6. Never manufacture a Best Angle from this release.

## Probability evidence

The r6 probability is market-heavy, not market-only. It combines a no-vig market
prior with the strongly shrunk r2 football margin correction using
opponent-adjusted efficiency, quarterback history/continuity, roster and depth
roles, and player availability.

| Probability metric | r6 | No-vig market | Improvement |
|---|---:|---:|---:|
| 2024-2025 pooled Brier | **0.206865** | 0.208131 | +0.001267 |
| 2024-2025 pooled log loss | **0.601061** | 0.603801 | +0.002740 |
| 2024-2025 pooled calibration error | **0.038779** | 0.054429 | +0.015651 |
| 2024 Brier | **0.199404** | 0.203075 | +0.003671 |
| 2025 Brier | 0.214326 | **0.213188** | -0.001138 |

The slight 2025 probability regression is inside the frozen 0.0015 tolerance,
but it is a real limitation and prevents describing r6 as uniformly better than
the market.

## Exact-price chronological evidence

| Period | Actions | Record | Units | ROI | Weeks with action | CLV+ rate | Mean CLV |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2023 selection | 120 | 79-41 | +18.773 | +15.64% | 18/18 | 45.83% | +0.00141 |
| 2024 confirmation | 115 | 74-41 | +14.179 | +12.33% | 18/18 | 44.35% | +0.00291 |
| 2025 confirmation | 137 | 85-52 | +4.764 | +3.48% | 18/18 | 37.96% | +0.00057 |
| 2024-2025 pooled | 252 | 159-93 | +18.944 | +7.52% | 36/36 | 40.87% | +0.00164 |

The deterministic 20,000-draw weekly-cluster bootstrap gives a pooled 95% ROI
interval of **-3.37% to +18.34%** and positive units in 91.38% of resamples.
Removing each season's single largest win leaves 2024 at +11.429 units and 2025
at +1.814 units. The candidate is therefore positive in each confirmation season
and largest-win-independent in each season.

The interval still crosses zero and the positive-CLV frequency is only 40.87%,
despite positive mean CLV in both seasons. Those facts support a provisional
Lean lane, not a guarantee, Best Angle, or aggressive stake.

## Latest authoritative Week 1 scoring

The read-only r6 scorer consumed the same latest immutable r2 evidence row for
all 16 genuine Week 1 games. Every game had at least five comparable books. Each
exact target offer was compared with the mean no-vig probability of the other
books, excluding the target so a sportsbook cannot grade its own price.

Nine moneylines clear the frozen r6 policy:

| Shadow Lean candidate | Exact offer | Model | Other-books consensus | Gap | EV / unit |
|---|---:|---:|---:|---:|---:|
| Los Angeles Rams ML | DraftKings -185 | 66.62% | 63.37% | +3.25 pp | +0.0263 |
| Tennessee ML | FanDuel -142 | 59.31% | 56.89% | +2.42 pp | +0.0107 |
| Baltimore ML | Caesars -182 | 66.21% | 62.51% | +3.71 pp | +0.0259 |
| Chicago ML | BetMGM -145 | 64.70% | 57.45% | +7.25 pp | +0.0932 |
| Houston ML | DraftKings -102 | 55.99% | 50.23% | +5.76 pp | +0.1088 |
| Minnesota ML | BetRivers -110 | 56.50% | 51.89% | +4.61 pp | +0.0785 |
| Philadelphia ML | DraftKings -205 | 68.09% | 66.21% | +1.87 pp | +0.0130 |
| Dallas ML | BetMGM -145 | 65.22% | 57.01% | +8.21 pp | +0.1020 |
| Kansas City ML | BetMGM -150 | 60.58% | 57.77% | +2.81 pp | +0.0096 |

Moneyline board counts are 9 shadow Lean candidates and 7 non-qualifiers. Relative
to rejected r5, r6 preserves its eight candidates, adds Philadelphia -205, and
removes none: **+1 shadow promotion, 0 shadow demotions**. Relative to the live
evidence-only board, the proposed impact is 9 moneyline promotions and 0
demotions, but none is applied in this commit. Production remains 0 actionable
and all 16 moneyline grades remain held. Spread and total are untouched and must
not inherit a moneyline grade.

## Normal-layout Held fallback

The temporary raw evidence wall is not the intended Daily Edge experience. A
read-only adapter now maps the latest complete immutable Week 1 evidence rows
into the standard slate cards and selected-edge reader. It exposes the genuine
schedule, named-book two-sided Opening/current trails, Playbook public splits,
projected quarterbacks, injuries, availability, venue, and weather context.

All 48 markets remain explicitly Held: pick, model probability, evaluated price,
recommendation strength, and grade are null. Held is counted and filtered as a
validation status separate from No Play, and no 0-0 score placeholder is shown.
The adapter calls the existing evidence reader only; it creates no writer, cron,
lease, database mutation, prediction, tracking decision, or reader-side grade.
Once an authoritative release publishes a coherent model/exact-price tuple, the
standard reader can display that tuple without another product redesign.

## Health, writer, reader, and tracking contract

- All 32 expected quarterbacks matched historical identities, but 32 are
  projected and 0 confirmed. This is a health hold, not a No Play.
- Outcome confidence/likely winner remains separate from the exact-price Bet
  grade.
- The actionable tuple is model probability, evaluated sportsbook and price,
  other-books fair probability, grade, decision timestamp, and immutable
  model/calibration/decision releases.
- While unlocked, a material price change requires authoritative recomputation.
  At T-60 the coherent tuple freezes inside the existing maximum-lag boundary;
  later prices are context only.
- The existing leased forward evidence path remains the sole collector. This
  audit adds no writer, cron, lease, prediction row, tracking row, or DB mutation.
- Public and sharp splits remain evidence. SharpAPI is currently unavailable and
  cannot promote or demote r6.
- Official tracking begins only after an approved regular-season tuple locks
  before kickoff. Preseason remains excluded.

## Remaining production gates

1. Integrate r6 into the existing authoritative writer; do not add another
   writer or reader-side override.
2. Recompute the exact-price tuple on each unlocked refresh and report the nine
   proposed promotions plus any later price-driven changes.
3. Confirm the expected quarterbacks and refresh injury/depth/weather inputs in
   their valid windows.
4. Capture and score timestamp-valid T-60 evidence within the existing 20-minute
   maximum-lag boundary.
5. Preserve 0 Best Angles until a separately validated grade tier exists.
6. Keep spread, total, and the clustered-score defect on separate release paths.

## Verification and rollback

Required verification is the complete r6 chronological replay, artifact and
report invariants, latest authoritative multi-book scorer, Python compilation,
focused NFL tests, `npm run verify:model-change`, production build, and
integration safety against current `origin/main`.

Rollback is removal of the r6 research operator, scorer wrapper, test, and this
audit. Generated joblib/JSON artifacts are ignored local evidence. No live state
requires rollback because this commit does not publish or track r6.
