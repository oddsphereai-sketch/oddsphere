# NFL Player Props projection context r1

Date: 2026-08-27
Starting production base: `8310f7c0828a593255b81e78270216d81d3fbb95`
Scope: board/reader evidence and presentation only. Model, calibration, probability, side, grade, threshold, stake, tracking, settlement, lock, provider calls, and feature inputs remain unchanged.

## Predeclared decision

The existing qualified NFL Player Props runtime already contains enough timestamp-valid information to explain its forecast without inventing a new signal: empirical residual distributions, projected participation, rolling player production, role/opportunity shares, opponent allowance, expected-quarterback status, injury-report state, team implied scoring, opponent identity, scheduled start, and exact multi-book observations. This change serializes a bounded subset of those existing inputs and makes the stat forecast visibly distinct from the exact-price Bet grade. It does not inspect outcomes or alter a threshold.

## Historical forecast audit

The portable distribution heads were trained through 2022, selected in 2023, confirmed in 2024, and evaluated in 2025. On the 2025 holdout, every supported volume-market projection head beat its declared historical baseline on MAE with a game-clustered interval below zero:

| Market | n | Model MAE | Baseline MAE | Clustered MAE delta (95% CI) |
|---|---:|---:|---:|---:|
| Passing attempts | 671 | 8.956 | 10.693 | -1.756 [-2.198, -1.290] |
| Passing completions | 671 | 5.800 | 6.717 | -0.925 [-1.163, -0.657] |
| Passing yards | 671 | 68.178 | 77.428 | -9.336 [-12.221, -6.501] |
| Rushing attempts | 1,942 | 3.278 | 3.521 | -0.243 [-0.309, -0.180] |
| Rushing yards | 1,942 | 18.740 | 20.130 | -1.385 [-1.779, -0.989] |
| Receptions | 3,594 | 1.522 | 1.638 | -0.115 [-0.135, -0.095] |
| Receiving yards | 3,594 | 19.960 | 21.465 | -1.508 [-1.807, -1.221] |

The 2025 participation head recorded Brier 0.09197, log loss 0.31343, AUC 0.93656, and calibration gap 0.00999 over 13,441 player-games, versus baseline Brier 0.12122. Its clustered Brier improvement was -0.02930 [-0.03233, -0.02619]. Empirical 80% ranges are generated from the same released residual distribution used by the probability head and are explicitly labeled uncertainty, not guarantees. Market-specific interval coverage is imperfect and remains visible as a declared limitation rather than a reason to fabricate precision.

The existing exact-price action lanes remain unchanged: receiving-yards and receptions Under Best Angles plus rushing-attempt Leans are the only qualified actionable volume lanes; anytime touchdown is Watchlist-only; all other categories stay nonactionable unless the released policy already says otherwise.

## Product contract

- MLB and NFL remain inside one shared Player Props product shell with one league-pill row and the same responsive modal, focus trap, Escape/backdrop dismissal, scroll containment, and focus return.
- NFL exposes only market families that exist on the current coherent member snapshot. It never claims every NFL prop family is modeled or available.
- Each row preserves opponent, scheduled start, exact evaluated line/side/book/price/time, other available exact-book observations, and genuine same-book opening/current evidence when it exists.
- The reader leads with the projected stat (or touchdown probability), empirical range, calibrated probability against the exact line, participation, recent production, role/opportunity, opponent allowance, expected quarterback, injury report state, and team scoring environment. The exact-price Bet grade is separate.
- Missing context remains visibly unavailable. It is never converted to zero, a healthy status, a price, or a fabricated model reason.
- Member vocabulary remains Best Angle, Lean, Watchlist, and No Play. Internal Held/recovery diagnostics stay out of the member DTO.

## Board impact and rollback

Paired promotions: 0. Paired demotions: 0. Probability, projection, side, grade, stake, and tracking impact: 0. Provider-call impact: 0. The payload is bounded by the existing player decision and exact-book set. Roll back board DTO r4/member r6/writer r7 together to the prior r3/r5/r6 evidence tuple; the immutable model and decision releases do not change.
