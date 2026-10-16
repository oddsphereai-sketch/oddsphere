# NBA independent-first categorical reader r3

Date: 2026-10-16

Status: owner-directed provisional production candidate for future unlocked rows

## Release contract

- Model / prediction record: `nba_professional_unified_2026_10_16_r3_independent_first_reader`
- Market marriage: `nba_market_marriage_2026_10_16_r3_independent_first_categorical_spread`
- Grade policy: `nba_grade_policy_2026_10_16_r3_independent_first_reader_probabilities`
- Point projection: `nba_unified_final_projection_2026_10_16_r2_independent_first_reader`
- Internal reader: `nba_professional_market_reader_2026_10_16_r2_conditional_spread_only`
- Lock coherence remains `nba_lock_coherence_2026_10_15_r2_unified_score_tuple`; its logic is unchanged.
- Sole writer and lease remain the existing NBA prediction-record writer under
  `prediction_pipeline:nba`.

Stored locked payloads are immutable and retain reader precedence. R3 applies only to unlocked rows
and future locks.

## Decision and architecture

R2 used a fixed 25% independent / 75% consensus blend for both margin and Total. The owner rejected
that as market anchoring. R3 removes the fixed blend:

1. The leakage-safe portable model produces the complete independent home and away score.
2. The independent margin and Total enter the final layer at weight 1.0.
3. The professional reader evaluates provider-separated splits and target-book-excluded,
   same-sportsbook, two-sided price/number chronology.
4. A Spread read can affect the score only when evidence is complete, the read is qualified, at
   least two persistent same-direction number trails each move at least two points, and at least one
   supporting trail is a named sharp book.
5. A qualifying read does not blend toward the current line. It only re-orients the independent
   residual across that line when the model is on the contradicted side.
6. One reconstructed home/away score then owns winner, Spread, Total, probabilities, exact-price
   grades, locks, and tracking.

Moneyline and Total reader outputs remain observational. Total stays fully independent because no
Total correction has cleared a separate outcome-and-score validation gate. Missing sequences,
stale or truncated evidence, a reversal/buyback, book disagreement, one-sided prices, line-mismatched
flow, or fewer than two supporting trails leaves the independent score unchanged.

## Independent-model audit

The broader NBA audit already evaluated possession, efficiency, Four Factors, ratings, schedule,
rest/travel, rotation, injury/availability, shot/play-type and season-regime candidates under
strict point-in-time construction. See
`docs/model-audits/2026-10-15-nba-professional-model-r2-predeclaration.md` and
`docs/model-audits/2026-10-15-nba-professional-model-r2-current-audit.md` for the research basis,
feature inventory, chronology controls and literature references.

Two additional sealed challenges were run before this release:

- A target-specialized richer-feature margin/Total audit improved 2025-26 opening-line Spread
  direction from 49.79% to 50.95%, but reduced winner accuracy from 68.13% to 67.97%, worsened
  team-score MAE from 9.56 to 9.60, and worsened Total MAE from 15.22 to 15.37. It was rejected.
- A dedicated market-free Moneyline classifier selected no eligible walk-forward challenger. On
  sealed 2025-26 it reduced winner accuracy from 68.13% to 67.72% and worsened Brier and log loss.
  It was rejected.

Those failures are evidence against replacing the stable 75-feature ratings/schedule ridge merely
because a candidate ingests more columns. R3 keeps the stronger independent artifact and changes the
downstream market relationship only.

## Chronological historical proxy

The reproducible command is `scripts/operator/audit_nba_independent_first_reader.py`. The 2024-25
season is the selection check and 2025-26 is opened once as confirmation. The frozen recipe is
independent margin weight 1.0, independent Total weight 1.0, two-point categorical Spread threshold.

| Metric | 2024-25 independent | 2024-25 r3 proxy | 2025-26 independent | 2025-26 r3 proxy |
|---|---:|---:|---:|---:|
| Games | 1,224 | 1,224 | 1,224 | 1,224 |
| Team-score MAE | 9.275 | 9.262 | 9.562 | 9.539 |
| Margin MAE | 11.045 | 10.936 | 11.345 | 11.054 |
| Total MAE | 14.824 | 14.824 | 15.237 | 15.237 |
| Winner accuracy | 66.91% | 68.38% | 68.14% | 69.28% |
| Winner Brier | 0.20898 | 0.20665 | 0.20468 | 0.19874 |
| Main Spread | 49.71% | 51.68% | 48.86% | 52.94% |
| Spread +3 | 60.38% | 62.63% | 57.43% | 62.01% |
| Spread +6 | 68.82% | 70.81% | 66.83% | 70.92% |
| Total direction | 48.08% | 48.08% | 51.80% | 51.80% |

On the 439-game movement-active 2025-26 confirmation cohort, Spread is 245-194 (55.81%),
the 95% Wilson lower bound is 51.13%, and flat -110 economics are +28.73 units. Across all 1,224
Spread decisions, the proxy is 648-576 (52.94%), the Wilson lower bound is 50.14%, and flat -110
economics are +13.09 units.

These historical market files are consensus opening/closing snapshots, not authentic same-book
point-in-time chronology or source-specific splits. They justify the categorical two-point boundary,
not a claim that the exact production reader was historically replayed. Production is deliberately
stricter and must be evaluated prospectively by release identifier and locked timestamp.

## Current-board impact

The exact October 20-21 rehearsal compares the released r2 formula and r3 with identical provider
inputs. It covers 14 games and 42 markets.

| Market | R2 actionable | R3 actionable | Promotions | Demotions | Pick changes |
|---|---:|---:|---:|---:|---:|
| Moneyline | 7 | 1 | 0 | 6 | 5 |
| Spread | 1 | 9 | 8 | 0 | 0 |
| Total | 2 | 9 | 7 | 0 | 0 |
| All | 10 | 19 | 15 | 6 | 5 |

Every one of the 15 promotions has positive expected return at its selected displayed price. The six
Moneyline demotions remove market-anchored actions; five change winner direction because the
independent forecast is no longer pulled across zero by consensus. The reader had no qualified live
two-point sequence at rehearsal, so this is the fail-closed independent starting board rather than an
assumed market correction.

## Validation and prospective gates

Required focused validation:

- unified-score tests prove both weights are 1.0, Total is unchanged, a sub-two-point read cannot
  act, and an already aligned read does not move the score;
- reader tests prove same-book two-sided chronology, persistence, named-book support, target-book
  exclusion, flow matching, reversal/buyback rejection, and evidence-error fail-closed behavior;
- candidate/site tests prove the reader is internal, the display reader does not execute it, and one
  final score owns all three market decisions;
- lock tests prove stored locked payload precedence and writer immutability;
- `npm run verify:model-change`, TypeScript, current-main integration safety and protected PR checks
  must pass before publication.

After October 20, report release-pure Moneyline, Spread, Total, +3 and +6 results by locked timestamp,
plus score MAE, Brier/log loss, closing-line value, reader corrections versus harms, action counts and
the movement-active cohort. Roll back future unlocked computation to r2 if release identity mixes,
the reader synthesizes evidence, locked payloads change, score and picks disagree, or prospective
results show material harm. Rollback cannot rewrite an r3 lock.
