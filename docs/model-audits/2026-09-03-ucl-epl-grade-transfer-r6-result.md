# UCL EPL-grade transfer r6 result

Date: 2026-09-03
Candidate grade release:
`ucl_grade_policy_2026_09_03_r6_owner_approved_epl_v23_transfer`

## Outcome

The owner-approved transfer passes its frozen current-board replay. The UCL
model, PMF, expected scores, probabilities, and forecast sides are unchanged.
The grade implementation is a UCL-owned copy of the EPL v23 hierarchy rather
than a runtime call into EPL.

The read-only replay used the current 18-game / 72-market Matchweek 1 board and
the latest complete append-only exact quote for each game/market through
`2026-09-03T20:47:42.010Z`. It invoked no provider and changed no database row.
Exact quote coverage was 51/72; the other 21 rows remained operational No Play.

| Market | Best Angle | Lean | Watchlist | Caution | No Play |
|---|---:|---:|---:|---:|---:|
| Match Result | 2 | 1 | 5 | 0 | 10 |
| Double Chance | 0 | 0 | 4 | 0 | 14 |
| Total | 0 | 7 | 5 | 0 | 6 |
| BTTS | 0 | 9 | 2 | 0 | 7 |
| **All markets** | **2** | **17** | **16** | **0** | **37** |

Relative to r5's 72 No Plays, this is 35 tier promotions, zero demotions, zero
forecast-side changes, and 19 actionables. All 19 actionables have positive
exact-price EV; no quota or target count was used. The current board has no
settled outcomes, so this is an outcome-free economic/coherence replay, not an
accuracy or ROI claim. Forward reporting must remain separated by the exact r6
calibration release and immutable T-60 timestamp.

## Product and failure behavior

- Missing or incoherent current prices remain No Play and never become a
  synthetic grade.
- A complete refresh with zero current prices cannot replace a prior priced
  UCL member snapshot. The cycle fails publication and preserves LKG.
- The shared Soccer Daily Edge layout is unchanged. UCL now supplies explicit
  ESPN-family crest IDs and primary colors for all 36 clubs in the current
  field, matching the existing EPL presentation pattern.
- Rollback restores r5 for future unlocked rows. Existing r6 rows and locks
  remain immutable, archived, and release-separated.
