# MLB T-60 failed-economics lock coherence r3

**Date:** 2026-09-02
**Release:** `mlb_lock_coherence_2026_09_02_r3_failed_economics_tuple`
**Disposition:** narrow operational correction; no forecast or grade change

## Incident

CWS at HOU (`game_id=59193`) was scheduled for 2026-09-03 00:10 UTC. From
23:19 UTC through the final 00:09 UTC pregame sweep, the final model/member
sync completed but the lock coherence gate rejected the game on every pass.
The raw Moneyline builder proposed a Best Angle, while the already-finalized
public row correctly stood it down to No Play because its exact evaluation
identity was incomplete (`incoherent_exact_price`; evaluated sportsbook and
observed time were null). The gate understood the distinct tuple retained for
a pending promotion, but not the terminal failed-economics tuple produced by
the same action-stability contract.

The repeated error was exact and limited to the intended public action fields:
raw `play_grade=best_angle`, `best_angle=true`, `no_bet=false` versus finalized
`play_grade=null`, `best_angle=false`, `no_bet=true`. At first pitch the normal
started-game guard stopped all further prediction writes, so the game remained
unlocked rather than accepting in-game data.

## Read-only integrity proof

- `game_predictions.computed_at` and all three public-record `published_at`
  values are 2026-09-03 00:09:46.475 UTC, before the 00:10 start.
- The final replacement captured in record history is 00:09:50.520 UTC, also
  before first pitch. No prediction tuple changed after the game started.
- There is no lock audit row and no grading row for the game because
  `locked_at` remained null.
- The member DTO classified the started game as locked but carried
  `lockedAt=null`. Later response snapshots retained the pregame prediction and
  recommendation price while rehydrating newer split context, so it was not a
  truly immutable T-60 member snapshot.
- The failure was present before and independent of the r80 full-game forecast
  release. r80's first eligible scheduled game published coherently in the
  next natural writer cycle.

## Correction contract

The gate recognizes a failed-economics difference only for Moneyline and only
when all of the following are exact:

1. The raw candidate is Lean or Best Angle, while the stored public tuple is
   strictly No Play (`play_grade=null`, `best_angle=false`, `no_bet=true`).
2. Pick, side, line, exact American price, confidence, model probability,
   market probability, edge, and publication time match.
3. Stored and expected evaluated sportsbook, odds, and observed time match.
4. The action-stability state has the current contract release, the canonical
   game/market/side/line/forecast identity, the same candidate grade, no
   qualifying cycles, null qualification times, and status
   `failed_economics`.
5. The terminal decision is No Play with null actionable grade, matching
   candidate/final grades, and reason `incoherent_exact_price` or
   `exact_price_economics_failed`.
6. An incoherent-price reason is accepted only when the expected exact quote
   actually lacks a valid book/time/price identity. An economics-floor reason
   is accepted only when the recomputed offered-price EV is below the stored
   non-null floor.
7. No pending candidate payload remains. Any unrelated mismatch still fails
   closed.

The lock then freezes the already-finalized public No Play tuple. It does not
promote the raw candidate and does not manufacture a grade, side, price, or
tracking record.

## Scope and rollback

There is no model, probability, projection, grade, stake, provider, query,
writer, cron, lease, timing, tracking, or reader change. The only runtime
change is the versioned lock-coherence predicate. Roll back
`MLB_LOCK_COHERENCE_RELEASE` and its predicate to r2 to restore the prior gate;
already locked rows remain immutable either way.
