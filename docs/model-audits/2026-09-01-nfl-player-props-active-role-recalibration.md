# NFL Player Props active-role recalibration

Date: 2026-09-01
Base: `b6585fac90a30e31b2f484e09891df5a92216e8b`
Predeclaration: `docs/model-audits/2026-09-01-nfl-player-props-active-role-recalibration-predeclaration.md`

## Decision

Promote the active-role projection model and, under the product owner's explicit production
authorization, apply the existing cross-market grade ladder to both sides of all seven modeled
volume/yardage markets. Preserve the anytime-touchdown model as Watchlist-only. The owner-approved
amendment follows the initial frozen receptions-only qualification and is recorded as a narrow
forward-monitoring exception in both the predeclaration and model-safety policy.

The incident was systemic, not limited to quarterback passing yards. Production's frozen player
state treated non-participation roster weeks as statistical zeroes and runtime did not enforce the
market support contract used in training. The replacement uses prior participating games for
production/opportunity features, retains every roster week for participation-history features, and
enforces position/prior-participation/minimum-role support at runtime.

## Projection evidence

The checksum-recorded 2016-2025 rebuild retained 138,860 rows, 2,639 games, 3,104 player identities,
109 model features, and 99.217% outcome-player roster identity coverage. Training ends in 2022;
2023 selects architecture; 2024 selects calibration; 2025 is the locked projection evaluation.

| Market | Challenger 2025 MAE | Incumbent EWM MAE | Challenger bias |
| --- | ---: | ---: | ---: |
| Passing attempts | 6.39 | 16.18 | +0.33 |
| Passing completions | 3.91 | 9.60 | +0.20 |
| Passing yards | 44.90 | 102.58 | +2.95 |
| Rushing attempts | 2.19 | 3.84 | +0.01 |
| Rushing yards | 12.20 | 18.93 | -0.13 |
| Receptions | 1.21 | 1.75 | +0.10 |
| Receiving yards | 15.67 | 21.65 | +1.08 |

All seven point heads selected the predeclared HGB candidate through the frozen selection and
confirmation process. The improvement is not a grade-threshold change.

## Exact-price evidence and lane disposition

A read-only provider recovery produced 272 2025 regular-season games, 125,278 raw opening rows,
183,182 normalized side observations, 616 player identities, and no rejected/unknown market rows.
It joined 46,771 exact opening offers to the locked 2025 outcomes. The market-residual weight was
selected before the 2025-11-01 confirmation boundary.

Only receptions qualified on the later confirmation partition: model/market residual Brier
0.2410 versus raw-model 0.2528 and market 0.2425, calibration gap 0.0462. On that untouched period,
receptions Best Angle candidates returned +7.98% on 158 bets/91 games and Lean candidates +8.25%
on 164 bets/98 games. Receptions Under was positive in both chronological halves at the frozen
thresholds; the Over side was not.

Passing attempts, passing completions, passing yards, receiving yards, rushing attempts, and
rushing yards failed at least one frozen market-residual/calibration or chronological-side test.
That limitation is not concealed: the owner explicitly accepted the forward risk and authorized
their production grade path. The release therefore relies on the materially improved active-role
projection, exact target price, target-excluded market benchmark, role support, and bounded
opening-to-current movement while it accumulates release-separated forward evidence.

## Same-capture current-board impact

The read-only 2026 Week 1 capture at 2026-09-01 13:03 UTC contained 16 games, 18,422 observations,
7,228 exact offers, 262 current player feature rows, and 239 score-eligible players. On the exact
same 184 independently confirmed volume/yardage outcomes:

| Grade | Incumbent | Candidate |
| --- | ---: | ---: |
| Best Angle | 0 | 5 |
| Lean | 22 | 21 |
| Watchlist | 29 | 19 |
| No Play | 133 | 139 |
| Actionable | 22 | 26 |

That table records the originally qualified receptions-only challenger. The owner-approved final
decision was then replayed on the same 184 independently confirmed outcomes using the real
cross-line opening attached to all 7,228 exact offers. The final result is **4 Best Angles / 23
Leans / 43 Watchlists / 114 No Plays**, or 27 actionable outcomes. Relative to the receptions-only
challenger it creates **10 promotions, 9 demotions, 149 unchanged outcomes, and net +1 actionable**.

Market impact is balanced and explicit: passing yards has zero promotions and zero demotions
(one No Play becomes Watchlist); receiving yards has six promotions and zero demotions; receptions
has two promotions and nine demotions; rushing yards has two promotions and zero demotions. No
passing-attempt, passing-completion, or rushing-attempt offer exists in this frozen current capture,
so the release does not manufacture one. Adverse movement produces 23 Watchlists and 19 No Plays
with zero actionable grades; neutral movement contains 4 Best Angles and 13 Leans; supported
movement contains 10 Leans. Passing-yards projections on the matched cohort are 166.0-245.6 yards
rather than the incident-era 35-260 range; rushing-yards median rises from 17.2 to 34.8.

The final movement rules were frozen before this replay: side-supporting line movement can use the
bounded 3% EV / 1.5-point Lean and 7% EV / 3-point Best Angle thresholds; a flat-line price change
must move implied probability by at least 2.5 points; adverse movement caps the grade at Watchlist;
missing or immaterial movement is neutral. Standard exact-price, independent-book, participation,
role, divergence, freshness, and positive-economics gates remain in force. There are no quotas and
no stake changes.

The final TypeScript production scorer independently reproduced the 4 Best Angles / 23 Leans on
the frozen provider, context, and exact-board inputs. Across the complete visible board it produced
4 Best Angles / 23 Leans / 77 Watchlists / 879 No Plays / 57 Held. The larger Watchlist and No Play
counts include one-book exact offers and anytime-touchdown outcomes outside the 184-row paired
comparison; 631 outcomes truthfully report missing independent same-line confirmation. All 7,228
exact offers carry a real same-book opening line, 966 are grade-eligible exact offers, and the
production scorer makes no provider or database call.

## Boundaries and rollback

The sole `nfl-forward-evidence` writer and `prediction_pipeline:nfl` lease remain unchanged. The
provider call ceiling, schedules, exact-price/same-line confirmation, six-hour quote freshness,
T-60 freeze, tracking, settlement, stake behavior, UI vocabulary, and other sports are unchanged.
The frozen touchdown model is byte-preserved.

Rollback restores the prior runtime artifact and r4/r7/r10/r12 scorer/board/member/writer releases.
Already locked tracking rows remain immutable.
