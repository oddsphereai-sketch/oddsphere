# NFL projected-QB score context r11 predeclaration

Date: 2026-08-25

## Question

Does replacing the Week 1 score model's last-completed-game quarterback-room proxy with the
timestamp-valid projected quarterback already captured in the authoritative forward evidence make
the current score forecast more football-specific without changing the frozen historical model,
using a market input, or creating an incoherent score/probability tuple?

## Frozen candidate

- Preserve the qualified r10 football-only ensemble, drive/scoring-event law, distribution
  calibration, and representative-score policy.
- For the current unlocked Week 1 scenario only, resolve each projected quarterback through the
  immutable r6 quarterback history map. Fail closed unless the exact name is matched and the
  forward row says the quarterback is projected or confirmed.
- Replace only the five existing quarterback-room inputs: EPA, CPOE, sack rate, turnover rate, and
  log dropbacks. Apply the same offseason carry and experience shrinkage used by the existing
  forward scorer. Do not add the market spread, total, moneyline, price, fair probability, split,
  or movement to the score head.
- Refit the unchanged selected r10 component models on their frozen historical feature rows and
  recompute the full current joint score distribution. No threshold, coefficient, ensemble weight,
  or grade rule may be selected from the current slate.

## Integrity and structural gates

- Exact 16-game/32-quarterback identity; all projected quarterbacks must resolve to history.
- No post-kickoff, final-score, current-game snap, realized injury, or realized weather input.
- Finite expected scores and probabilities, with expected points, margin, total, winner, Spread,
  and Total probabilities still derived from the same joint score law.
- Team-score SD at least 2.0, margin SD at least 3.0, total SD at least 2.0, both Over and Under
  forecast directions present, no representative-score winner contradiction, and no duplicate
  identity.
- Per-team expected-score movement is capped at 3.0 points and margin movement at 5.0 points. A
  larger change is a failed extrapolation, not evidence of greater conviction.

## Decision boundary

This is additive shadow research. The current evidence has projected, not confirmed, quarterbacks,
and comparable historical as-of starter-designation snapshots do not exist. Therefore this pass
cannot itself promote a production score model, grade, stake, writer, tracking rule, or member
reader. It can either (a) qualify as a bounded forward scenario to collect alongside r10, or (b)
fail and preserve r10 unchanged.
