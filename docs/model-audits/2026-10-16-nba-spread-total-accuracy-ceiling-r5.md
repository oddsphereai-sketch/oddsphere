# NBA Spread and Total accuracy ceiling r5

Date: 2026-10-16

Status: research complete; no production forecast or grade change

## Owner question

Can the current independent-first NBA final product move Spread and Total accuracy closer to 60%
without restoring the rejected fixed market blend or promoting a fitted historical slice that will
collapse live?

The answer is different by market:

- **Spread:** yes, the existing categorical reader already contains a materially stronger subset.
  When a reader move of at least four points actually corrects a disagreeing independent side, the
  historical proxy is 58.25% on 103 selection decisions and 61.00% on 100 confirmation decisions.
  This is a strength tier for the released r3 side, not a new pick rule.
- **Total:** there is a real model weakness, but not a validated 60% tier. Independent Total
  disagreements of five points or more are anti-predictive in both seasons. A selection-only
  categorical correction improves the complete board and Total MAE again in confirmation, but only
  from 51.80% to 52.12%. The selection-winning high-confidence slice falls from 57.78% to 51.67%, so
  it fails promotion.

No live score, side, probability, grade, stake, action count, release identifier, lock, writer, or
member snapshot changes in this audit.

## Reproducible chronology

Operator: `scripts/operator/audit_nba_accuracy_ceiling.py`

- independent model: frozen 75-feature ratings/schedule margin-and-Total ridge;
- final forecast: released r3 independent-first categorical Spread proxy;
- selection: 2024-25 regular season, 1,224 games;
- historical confirmation: 2025-26 regular season, 1,224 games;
- market proxy: public multibook consensus opening and closing lines;
- minimum selection cohort: 100 settled decisions;
- Spread strength selection: at least 55% on the selection season;
- Total challenger gate: more corrections than harms plus selection improvements in both direction
  accuracy and Total MAE;
- confirmation recipes are carried forward unchanged.

The confirmation season is fixed and release-pure, but it is not described as epistemically pristine:
prior Oddsphere NBA audits have already examined that season. This pass prevents direct confirmation
retuning by encoding the candidate ranking on 2024-25 only and reporting the carried recipe.

## Released r3 baseline

| Market | 2024-25 | 2025-26 | 2025-26 record |
|---|---:|---:|---:|
| Spread, full board | 51.68% | 52.94% | 648-576 |
| Total, full board | 48.08% | 51.80% | 634-590 |
| Total MAE | 14.824 | 15.237 | — |
| Team-score MAE | 9.262 | 9.539 | — |

## Spread finding: the reader corrections are the edge

The loss ledger separates an applied categorical correction from a movement read that merely agrees
with the independent side.

| r3 Spread cohort | 2024-25 | 2025-26 |
|---|---:|---:|
| Reader corrected a disagreeing side | 199-175 (53.21%) | 194-144 (57.40%) |
| Reader confirmed the existing side | 52-52 (50.00%) | 51-50 (50.50%) |
| Reader inactive | 381-364 (51.14%) | 403-382 (51.34%) |

Movement strength then separates the applied corrections:

| Minimum consensus move | 2024-25 corrected cohort | 2025-26 corrected cohort |
|---|---:|---:|
| 2 points | 199-175 (53.21%) | 194-144 (57.40%) |
| 3 points | 122-90 (57.55%) | 113-81 (58.25%) |
| **4 points** | **60-43 (58.25%)** | **61-39 (61.00%)** |
| 5 points | 23-19 (54.76%) | 31-18 (63.27%) |
| 6 points | 12-11 (52.17%) | 18-11 (62.07%) |

The four-point threshold wins the declared selection rule with at least 100 decisions. Its 2025-26
Wilson 95% lower bound is 51.20%; the observed 61% is promising, not a guarantee that the true rate
is 60%. At flat -110 it is +11.55 units in selection and +16.45 units in confirmation, but exact
historical selected-book prices are unavailable.

This result does **not** authorize a second Spread forecast. The r3 side already contains the
correction. It supports prospectively distinguishing especially strong applied reads from ordinary
reader confirmations after authentic same-book qualification.

## Total finding: large independent edges are overextended

The raw independent Total residual has the wrong sign more often than not once its disagreement with
the market reaches five points:

| Absolute independent Total edge | 2024-25 raw accuracy | 2025-26 raw accuracy |
|---|---:|---:|
| Under 3 | 48.32% | 55.04% |
| 3 to under 5 | 50.36% | 53.05% |
| **5 to under 8** | **45.77%** | **45.82%** |
| **8 or more** | **47.47%** | **47.10%** |

That stable failure is the most important new independent-model diagnosis. More displayed model edge
is not more Total confidence. The current grade policy must not promote a Total merely because the
independent score is far from the line.

The selection-winning shadow recipe is categorical rather than a blend:

1. preserve the independent Total and residual magnitude;
2. reverse the residual when its absolute edge is at least four points;
3. when opening-to-close Total movement reaches three points, use that movement's direction;
4. reconstruct both team scores from the unchanged final margin and the candidate Total.

| Metric | 2024-25 baseline | 2024-25 candidate | 2025-26 baseline | 2025-26 confirmation |
|---|---:|---:|---:|---:|
| Total direction | 48.08% | **52.82%** | 51.80% | **52.12%** |
| Total MAE | 14.824 | **14.461** | 15.237 | **15.068** |
| Team-score MAE | 9.262 | **9.120** | 9.539 | **9.458** |
| Side corrections-harms | — | **381-323** | — | **317-313** |

The candidate confirms a small score and direction improvement, but its confirmation correction
margin is only four games. Its selection-winning 4-to-6 point Over tier goes 78-57 (57.78%) and then
62-58 (51.67%). That failed tier is why the Total challenger remains shadow-only instead of being
presented as the requested near-60% solution.

## Decision

1. Keep the production r3 forecast unchanged.
2. Treat an applied four-point-or-stronger qualified Spread correction as the first prospective
   high-strength cohort. Do not infer it from consensus history on the live board; the existing
   target-book-excluded, same-book evidence contract still has to qualify.
3. Record and score the Total challenger prospectively from the already stored independent score,
   opening/current line and reader chronology. Do not let raw Total edge magnitude promote a grade.
4. Require authentic release-pure locks, exact-price ROI, corrections versus harms, score MAE and
   meaningful sample coverage before Total authority or a stronger Spread grade is released.

## Why production remains unchanged

Historical consensus opening/closing snapshots cannot replay the live reader's same-book sequences,
target-book exclusion, source identity, reversal/buyback handling, exact decision timestamp, or
source-specific splits. Those are precisely the facts needed to distinguish market reading from
market dependence. The stored forward payload already contains enough evidence to score both signals
after regular-season games settle, so no second writer or new lock field is required.

Locked member snapshots remain immutable and retain unconditional precedence.
