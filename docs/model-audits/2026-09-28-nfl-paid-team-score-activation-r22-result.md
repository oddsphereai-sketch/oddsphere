# NFL Paid Team-Score Activation R22 Result

## Result

The candidate passes its fixed activation gates. The paid direct score is the strongest tested
2026 independent NFL score signal, the market overlay is bounded and target-free, every public
surface derives from one final PMF, and the current board retains its actionable count.

## Release-pure settled comparison

| Metric | Preceding independent | R22 direct-score core | Change |
|---|---:|---:|---:|
| Winner accuracy | 27/47 (57.45%) | 31/47 (65.96%) | +4 wins |
| Spread direction | 17/44 (38.64%) | 21/44 (47.73%) | +4 wins |
| Total direction | 21/47 (44.68%) | 26/47 (55.32%) | +5 wins |
| Team-score MAE | 8.4826 | 8.2301 | -0.2525 |
| Margin MAE | 11.1221 | 10.6887 | -0.4334 |
| Total MAE | 12.0518 | 11.5406 | -0.5112 |

The 15-game strict same-book Week 3 movement audit found Spread movement correct on 9/13 moved
non-push games and Total movement correct on 6/15. The fixed direct-score plus Spread-movement
diagnostic is 31/47 winners, 22/44 Spreads and 26/47 Totals, with 8.1556 team-score MAE, 10.5402
margin MAE and 11.5406 Total MAE. Total movement therefore receives zero score-mean weight.

## Exact live-data zero-write replay

The release-refresh dry run at `2026-09-28T17:47:40.862Z` proposed one unlocked PHI-CHI payload,
three evaluated markets, zero writes and zero tracking changes. It produced one Best Angle, one
Lean and one No Play, identical counts to the preceding card.

| Surface | Preceding | R22 candidate |
|---|---|---|
| Representative score | PHI 22 - CHI 20 | PHI 24 - CHI 19 |
| Expected score | PHI 22.0 - CHI 20.4 | PHI 24.47 - CHI 19.46 |
| Moneyline | PHI Lean | PHI No Play |
| Spread | CHI +3.5 Best Angle | PHI -3.5 Lean |
| Total | Over 41.5 No Play | Over 41.5 Best Angle |

The direct provider center was PHI 25.03 - CHI 18.90. Target-free FanDuel movement was available:
Chicago moved from -1.5 to +3.5 and the no-vig price also moved toward Philadelphia. Fresh Circa
money-minus-tickets strongly resisted Philadelphia, so the established Circa-priority bounded
combiner moderated the final margin rather than blindly following either signal. Total movement
from 48.5 to 41.5 was recorded but did not move the paid Total center. The final PMF gives
Philadelphia 64.15% winner probability, Philadelphia -3.5 54.24% cover probability and Over 41.5
54.36% probability. Score, winner and both line-specific sides are coherent.

Board impact is one promotion, two demotions, one Spread side change and zero net actionable-count
change. The full 16-game compact board remains 48/48 priced markets with 6 Best Angles, 12 Leans,
6 Watchlists and 24 No Plays. Fifteen started/locked games retain their immutable prior releases;
only the unlocked game is eligible for r22 refresh.

## Runtime and rollback

The release uses the existing bounded slate-level paid-projection request, existing evidence
table, sole NFL writer and `prediction_pipeline:nfl` lease. It adds no per-card or member request,
stake, copy, label, layout, cron or parallel writer. Missing paid projections fall back to the
preceding coherent weekly football model. Member publication remains ahead of tracking writes and
the last coherent compact snapshot remains available on failure.

Rollback is the complete r21 pressure family: member/model/calibration/decision/grade r21/r18/r17/
r23/r23, weekly outcome r8, fixture r31, compact snapshot r23 and writer r46. Existing r22 rows are
preserved as release-stamped evidence and no locked record is rewritten.
