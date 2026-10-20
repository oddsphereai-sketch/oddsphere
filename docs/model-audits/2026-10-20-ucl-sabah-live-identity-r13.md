# UCL Sabah live market identity r13

Date: 2026-10-20

## Scope and predeclaration

- Competition: UEFA Champions League only.
- Input affected: exact SharpAPI event identity for Sabah FK.
- Markets affected: current Match Result, Double Chance, regulation Total 2.5,
  and regulation BTTS price availability for the exact Sabah-Dortmund fixture.
- Active model remains
  `ucl_goals_coherent_2026_10_14_r8u_elo_late_consensus`.
- Calibration advances from
  `ucl_grade_policy_2026_10_19_r12_exact_team_identity_coverage` to
  `ucl_grade_policy_2026_10_20_r13_sabah_live_identity` because restored exact
  prices can change a future-unlocked grade.
- Sharp identity advances from
  `ucl_sharp_market_identity_2026_10_19_r4_exact_team_alias_coverage` to
  `ucl_sharp_market_identity_2026_10_20_r5_sabah_live_identity`.
- The sole writer remains `ucl-daily-refresh` under
  `prediction_pipeline:soccer`; the targeted `ucl-pregame-lock` route retains
  the same shared lease and immutable four-market lock verifier.
- No model equation, probability, projected score, side, threshold, stake,
  provider call budget, cadence, writer, reader layout, or stored lock may
  change.

## Observed defect

The current Sharp event catalog no longer exposes the main Sabah event as the
previously observed `Sabah`. Its 85-market canonical event uses `Sabah
Masazir`, while a separate nine-market bucket uses `Sabah Baku FK`. The exact
UCL identity registry did not recognize either string. BALLDONTLIE still
supplied Match Result, but fresh Sharp Double Chance, Total and BTTS disappeared
and production had to preserve the prior complete same-book tuple.

The repair adds only those two authenticated current provider strings as exact
Sabah aliases. It does not enable substring or fuzzy matching.

## Same-input board impact

| Measure | r12/r4 incumbent | r13/r5 candidate |
|---|---:|---:|
| Fixtures | 18 | 18 |
| Selected current prices | 69/72 | 72/72 |
| Complete outcome prices | 173/180 | 180/180 |
| Held markets | 3 | 0 |
| Fresh actionables | 14 | 15 |
| Nonpositive-EV actionables | 0 | 0 |
| Incoherent games | 0 | 0 |

Fresh Sabah-Dortmund Double Chance remains No Play, Total advances from a data
hold to Watchlist, and BTTS advances from a data hold to its already-qualified
positive-EV Lean. This is one actionable recovery and zero actionable
demotions. The existing public last-known-good snapshot already contains the
same Sabah Total Watchlist and BTTS Lean, so the identity repair does not itself
change either public Sabah side or grade. Other board grades may still move
normally when a later refresh captures genuinely newer prices.

## Verification and rollback

Publication requires the focused UCL production/immutability suite, exact live
readiness replay, TypeScript, `npm run verify:model-change`, latest-main
integration safety, protected pull-request checks, and post-deploy proof of
72/72 current selected prices, 180/180 outcomes, the r13/r5 release pair, one
shared writer lease and unchanged locks.

Roll back future-unlocked input selection to r12/r4 if either new identity
matches a non-Sabah club, fresh four-market coverage regresses, provider calls
grow beyond the existing bound, the public board contracts unexpectedly, a
mixed release appears, or any locked field changes.

## Separate BTTS health finding

The same audit found that the current 18-game slate selects BTTS Yes in all 18
games. The probabilities are not duplicated (54.93% to 76.85%), but the frozen
chronological replay also selects Yes in 182 of 189 selection/confirmation
games while only 106 actually land Yes. A train-only Platt calibration improves
selection proper scores but worsens confirmation Brier and log loss; fitting
through selection improves confirmation direction by one game while still
worsening both proper scores. No BTTS probability or grade change is therefore
authorized by this operational repair. The skew requires a separate coherent
score-model audit rather than an outcome-blind threshold or forced No quota.
The read-only readiness audit now emits the existing soccer BTTS distribution
warning so a similarly skewed future UCL slate cannot pass unnoticed.
