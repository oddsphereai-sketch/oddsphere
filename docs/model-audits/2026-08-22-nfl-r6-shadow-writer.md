# NFL r6 moneyline shadow writer integration

Date: 2026-08-22

## Decision

Integrate the frozen r6 moneyline Lean candidate into the existing leased NFL
forward-evidence writer as shadow evidence only. Do not publish r6, change the
member reader, create grades or stakes, enable tracking, or add another writer.

The candidate is the best currently evidenced moneyline lane, not a perfect or
production-approved system. Its frozen chronological evidence is positive in
both confirmation seasons, but its weekly-cluster bootstrap interval still
crosses zero and current 2026 quarterback designations remain projected.

## Frozen releases and policy

- Runtime artifact: `nfl_r6_moneyline_runtime_artifact_2026_08_22_r1`
- Model: `nfl_market_led_moneyline_shadow_2026_08_22_r6`
- Calibration: `nfl_market_led_price_calibration_shadow_2026_08_22_r6`
- Decision: `nfl_market_led_moneyline_lean_shadow_2026_08_22_r6`
- Source point model: `nfl_pregame_market_residual_shadow_2026_08_21_r2`
- Writer: `nfl_forward_evidence_writer_2026_08_22_r3_r6_shadow`

The policy was frozen before confirmation: evaluate both moneyline sides at
every comparable named sportsbook, exclude the target book from its market
consensus, select the greatest exact-price modeled EV per game, accept prices
from -300 through +300, and require nonnegative EV and nonnegative model gap.
There is no weekly quota or forced minimum. This release can produce Lean or
Held only; it cannot produce Best Angle.

The probability remains market-heavy, not market-only. It combines the
leave-one-book-out no-vig prior with the r2 independent margin residual built
from opponent-adjusted efficiency, quarterback history/continuity, roster role,
and availability inputs. The Python joblib models are exported into a portable
JSON runtime containing the exact logistic scaling/coefficients and all 220
histogram-gradient trees. Three margin and three probability parity cases match
the frozen Python artifacts within `1e-12` in the TypeScript runtime.

## Chronological evidence retained

| Period | Actions | Units | ROI | Mean CLV |
|---|---:|---:|---:|---:|
| 2023 policy selection | 120 | +18.773 | +15.64% | +0.00141 |
| 2024 confirmation | 115 | +14.179 | +12.33% | +0.00291 |
| 2025 confirmation | 137 | +4.764 | +3.48% | +0.00057 |
| 2024-2025 pooled | 252 | +18.944 | +7.52% | +0.00164 |

The deterministic 20,000-draw weekly-cluster bootstrap retained a 95% ROI
interval of -3.37% to +18.34% and positive units in 91.38% of draws. Removing
each confirmation season's single largest win left both seasons profitable.
Positive-CLV frequency was only 40.87%, and 2025 probability Brier was 0.001138
worse than the market while remaining inside the frozen tolerance. Those are
explicit reasons to keep the candidate at Lean and shadow-only.

## Current authoritative Week 1 replay

The runtime replay read the latest immutable r2 row for all 16 real Week 1
games. The read-only export was created at `2026-08-22T16:37:15.126Z`; every
latest row was captured at `2026-08-22T13:50:56.934Z`, every game carried five
comparable conventional books, and the export SHA-256 was
`b13c50b08428ca236642019d375983f3bae52230449f15a643b897478f896436`.

Nine exact prices produced internal Lean candidates and seven were Held:

| Shadow candidate | Exact offer | Model | Other-book consensus | Gap | EV/unit |
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

Relative to the current production-held state, the replay has nine proposed
shadow promotions and zero shadow demotions. Applied production promotions and
demotions are zero/zero. The nine names also exactly reproduce the accepted r6
offline forward run, so runtime integration adds zero candidate promotions and
zero candidate demotions relative to the frozen candidate.

All 32 expected quarterbacks matched historical identities, but all 32 remain
projected and zero are confirmed. The tuple records QB confirmation reasons
separately from price-policy eligibility. Missing SharpAPI splits remain a
context health reason and never alter a decision; no SharpAPI coverage is
fabricated.

## Tuple, writer, and lock boundaries

Every due capture stores one moneyline `shadowEvaluatedBets` tuple containing:

- model probability;
- exact evaluated sportsbook, price, quote timestamp, and null moneyline line;
- target-book no-vig probability and the mean no-vig probability of at least
  two other comparable books;
- Lean or Held, modeled EV, gap, writer evaluation timestamp, and immutable
  runtime/model/calibration/decision releases;
- independent opening-margin correction and projected home margin;
- QB names, historical-match status, confirmation status, and separate blocking
  versus context health reasons.

The production `evaluatedBets` and `outcomeConfidence` arrays remain empty.
Every shadow tuple hard-codes `shadowOnly=true`, `publicationEligible=false`,
and `trackingEligible=false`. The existing `/api/cron/nfl-forward-evidence`
route remains the sole provider caller and writer under the shared
`prediction_pipeline:nfl` lease, so this adds zero requests and no DB schema or
permission change.

Unlocked due captures recompute the tuple from their current exact offers. A
T-60 tuple freezes only when the reported lag matches the lag recomputed from
the game/capture timestamps and both are between zero and 20 minutes. A later,
earlier, or inconsistent T-60 capture is Held with no `lockedAt`. Publication
and official tracking remain disabled even for an on-time shadow lock.

## Highest-value next lane

The next shadow lane should be **score distribution**, ahead of a standalone
spread or total policy. The existing score clustering and all-Over behavior are
joint projection defects; repairing one downstream price rule would leave the
underlying final-score product incoherent. A calibrated joint margin/total
distribution can instead produce differentiated team scores and then feed both
spread and total exact-price tournaments from one coherent forecast.

That lane must not inherit r6's moneyline grade or weaken its gates. It should
be selected chronologically on independent margin/total likelihood, calibration,
team-score and total MAE, dispersion/tail coverage, and market comparison, then
opened once on untouched seasons. Exact-price spread and total actionability
must be tested afterward as separate uncapped policies with paired promotions,
demotions, CLV, units, ROI, largest-win sensitivity, and weekly-cluster
uncertainty. Until that passes, spread, total, projected scores, member grades,
and stakes remain unchanged.

## Promotion gates and rollback

Production r6 remains blocked pending timestamp-valid forward T-60 tuples,
closing-line and settlement evidence, QB confirmation/input health, explicit
member-layout integration, full model-change verification, and owner approval.
No current board, prediction record, lifetime total, settlement row, or stake is
changed here.

Rollback is removal of the r3 shadow call/type/runtime artifact and restoration
of the r2 writer identifier. Stored append-only shadow evidence may remain as
auditable historical evidence; it is ineligible for publication and tracking.
