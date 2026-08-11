# MLB member lock priority retry — tracking contract v8

Date: 2026-08-11
Previous tracking contract: `member_facing_lock_v7_locked_only_status_normalized_2026_08_05`
Candidate tracking contract: `member_facing_lock_v8_priority_retry_minute_cadence_2026_08_11`

## Scope

This is an operational lock-timing release. It changes no projection, probability, selected side,
grade, stake, model input, price rule, calibration, or actionable-board eligibility. The existing
MLB `prediction_pipeline` lease remains the single authority for every prediction-writing job.
The authoritative writer and member reader are unchanged.

## Production incident

The 2026-08-11 CHC at WSH game was scheduled for 22:45 UTC and should have entered T-60 at
21:45 UTC. The 21:45 pregame sweep fired, but the MLB run correctly skipped because lineup-watch
still held the shared lease. With the then-current five-minute schedule, the next attempt did not
begin until 21:50. The game locked coherently across all three markets at 21:50:15 UTC under MLB
decision release r34. No side, price, probability, grade, or stake mismatch was found; the defect
was the five-minute visible-open interval.

## Candidate behavior

- Run the targeted lock-only sweep every minute during the existing active windows.
- On shared-lease contention, retry acquisition once per second for at most 20 seconds.
- If contention remains, fail closed and let the next minute sweep retry.
- Keep no-op sweeps targeted: classification and existing small metadata reads only; no full-slate
  model, odds, public-split, grade, or publication refresh runs unless a game is entering T-60.
- Preserve the exact T-60 boundary. No grace window or early lock is introduced.
- Poll the member Daily Edge snapshot every minute so an already-open page observes the published
  lock promptly without triggering a model or provider refresh.

## Paired board impact

The candidate changes zero recommendations: promotions 0, demotions 0, net actionable-board
change 0, and market mix unchanged. For the incident game, the already-stored r34 T-60 output is
the paired prediction evidence; only the acquisition opportunity moves from the next five-minute
tick to a bounded same-run retry or the next minute tick.

## Verification and rollback

Required verification is `npm run verify:model-change`, the focused cron lease retry test, current
refresh-cycle schedule test, pregame safety test, MLB props engine test, production release
coherence audit, and a live observation after the next T-60 transition. Roll back by restoring the
five-minute schedules, removing the pregame lease retry options, and restoring tracking contract
v7. Roll back if minute sweeps create unexpected load, overlapping writers, partial snapshot
publication, or mixed unlocked tracking-contract stamps.
