# MLB corroborated Total opposition r90 — result

Date: 2026-10-05

## Chronological replay

The fixed pre-result selector found 58 settled Total rows. The incumbent side
went 20-38; the corrected side went 38-20 (65.52%). Results by time block:

| Segment | Rows | Incumbent | Corrected |
| --- | ---: | ---: | ---: |
| Through 2026-07-31 | 15 | 4-11 | 11-4 |
| 2026-08-01 through 2026-08-31 | 20 | 9-11 | 11-9 |
| 2026-09-01 through 2026-09-18 | 13 | 5-8 | 8-5 |
| 2026-09-19 onward | 10 | 2-8 | 8-2 |

These are retrospective estimates from opened evidence, not a promised future
hit rate.

## Projection accuracy and coherence

The coherent score rule retains an already-corrected-side Total and otherwise
reflects the incumbent Total across the exact listed line while preserving the
home-away margin. Total MAE improved in every chronological segment:

| Segment | Incumbent Total MAE | Corrected coherent Total MAE |
| --- | ---: | ---: |
| Through 2026-07-31 | 3.5096 | 2.8782 |
| August | 2.8693 | 2.5152 |
| September 1–18 | 3.8139 | 3.5611 |
| September 19 onward | 3.3346 | 1.9409 |

The focused pure/writer suite passed 83/83 checks. It proves the rule fails
closed without the independent forecast, opposing two-sided price, continuous
same-book adverse trail, independent corroborator, opposite-side quote, and
score inputs. It also proves the immutable record carries the corrected side,
quote, probability, score, Total, and release metadata together.

## Board impact

The retrospective cohort contained 17 actionables: one Best Angle and 16 Leans.
All 17 have non-negative corrected exact-price edge under the conservative
probability. The correction rule cannot promote a Best Angle; the historical
Best Angle becomes at most Lean, while Lean continuity still must pass ordinary
gates. The October 5 production audit contains no current MLB Total qualifying
for the rule, so same-input current-board side changes, promotions, demotions,
and actionable-count changes are 0 / 0 / 0 / 0. The release affects only a
future unlocked row that later develops the complete qualifying evidence.

## Operational impact

The release adds no provider request, schedule, writer, database loop, or UI
surface. It reuses the existing model probability, target-excluded no-vig pair,
same-book trail, public/internal sharp evidence, and prediction-record writer.
Locked rows remain immutable.
