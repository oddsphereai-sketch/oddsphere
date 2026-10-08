# NFL player props opponent, role, and position rebuild result

Date: 2026-10-08

## Decision

Keep production unchanged. The research found and fixed two real wrong-team joins in the shadow
feature path, built a position-specific opponent model across all seven ordinary prop families, and
produced material historical gains. No candidate satisfies the complete frozen production gates,
and the current 2026 inference substrate cannot populate the new model coherently. Shipping it would
replace market dependence with stale or missing football inputs, not create a strong independent
model.

The independent forecast remains the target architecture. Market movement remains a separate
observer. No projection, probability, side, grade, stake, price, writer, schedule, lock, member copy,
label, or layout changes in this result.

## Confirmed feature-identity defects

Two builders attached the offense's own defense where their contracts said opponent defense:

1. all 21 foundational `prior_opponent_allowed_*` volume fields in the checksum-pinned r1 history;
2. all 42 `matchup_opponent_allowed_*` efficiency/rate fields used by the full-family trainer.

For Arizona at Miami in 2024 Week 8:

- stored `prior_opponent_allowed_passing_yards_ewm`: `276.2957722`;
- Arizona own-defense history: `276.2957722`;
- actual Miami opponent-defense history: `163.1142889`;
- attached advanced allowed yards/attempt EWM: `8.2287009`;
- actual Miami allowed yards/attempt EWM: `6.0347061`.

Backward-compatible corrected helpers and deterministic identity/chronology tests are now present.
Legacy remains the default so the released artifact and prior audits stay reproducible. No stored
dataset or artifact was silently reinterpreted.

## Candidate sequence

### Corrected opponent identity

Correcting only the advanced block produced very small, unstable gains. Correcting both base and
advanced blocks improved 2025 Passing Attempts MAE `7.78303 → 7.70687` and Rushing Yards MAE
`18.94939 → 18.90884`, but both clustered intervals crossed zero and at least one chronological
segment regressed. Explicit role-share × team-volume × efficiency also failed: Rushing Attempts MAE
moved `3.08299 → 3.08037` while RMSE worsened.

### Actual-opponent position buckets

The next candidate aggregated shifted outcomes allowed by each defense to `QB`, `RB/FB`, `WR`, and
`TE`, then added 24 position-specific features to regularized market-specific models. The comparator
was the actual released point family, including the released settlement-aligned Rushing Attempts
head.

| Market | Released 2025 MAE / RMSE | Best selected MAE / RMSE | Material finding | Gate result |
| --- | ---: | ---: | --- | --- |
| Passing Attempts | 8.4292 / 11.4486 | 7.7411 / 10.1190 | clustered CI below zero; fourth segment +0.6313 MAE | reject |
| Passing Completions | 5.6468 / 7.5832 | 5.2311 / 6.7064 | clustered CI below zero; fourth segment +0.3011 | reject |
| Passing Yards | 66.6333 / 88.8176 | 62.4847 / 79.1478 | clustered CI `[-6.899, -1.387]`; fourth segment +3.0425 | reject |
| Rushing Attempts | 3.0545 / 4.1502 | 3.0300 / 4.1653 | MAE CI below zero, but RMSE and bias worsened | reject |
| Rushing Yards | 18.5580 / 27.4685 | 18.2440 / 27.3732 | all four segments improved; bias `-4.262 → -5.552` | reject |
| Receptions | 1.4599 / 1.9282 | 1.4655 / 1.8911 | MAE worsened | reject |
| Receiving Yards | 19.5186 / 27.0056 | 19.3101 / 26.8797 | CI `[-0.258, -0.157]`; all four segments improved; bias worsened | reject |

Training-only mean-residual calibration did not change the selected families. A new selector that
enforced bias constraints on 2023 and 2024 chose a safer Rushing Yards head (`18.48384` MAE,
`26.85862` RMSE, bias `-2.26506`), but its clustered interval crossed zero and its first 2025 segment
regressed. It found no eligible Receiving Yards candidate. Because 2025 had already been inspected,
that last result is labeled opened retrospective evidence, not a fresh holdout.

## Why the remaining failure is not another coefficient problem

The position model extracts the strongest honest matchup split available from current public box
scores. It materially improves three passing heads and both yardage heads, yet the passing family
breaks in the last chronological segment and the yardage median heads trade lower error for systematic
underprojection. That pattern is consistent with unmodeled role transitions and availability rather
than a missing generic defense average.

The live 2026 path confirms the inference gap:

- five shifted offensive-snap percentage fields are not refreshed in season;
- 42 advanced team/opponent rate features are not refreshed in season;
- the 24 new position-opponent fields do not exist in the live feature writer;
- the retained Week 5 context had zero injury games across 675 unlocked rows / 15 games; and
- public nflverse participation data from 2023 onward is published only after the postseason, so it
  cannot supply live role transfer.

The model therefore cannot know, as of prediction time, whether a starter's routes/snaps are being
limited, which teammate inherits vacated opportunity, or whether a historical position allowance
still maps to the expected personnel. Assignment-level CB/WR, route/coverage, box-count, and OL/DL
tracking also remain outside the current provider contract.

## Smallest data addition required

The minimum dependency is not a historical odds feed. It is one timestamped, slate-level football
availability/usage feed with both historical and live coverage:

1. pregame player status, depth position, and expected availability captured at opening, T-24, T-6,
   and T-60;
2. postgame offensive snaps and, for receivers, routes run, keyed to the same player/game identity;
3. a bounded team-level refresh that writes the existing 42 advanced fields plus the 24 position
   allowance fields from completed 2026 games; and
4. explicit source timestamps so only information known before lock enters training or replay.

With that addition, the next frozen model is a starter/backup mixture: participation probability ×
conditional role, team opportunity redistributed only among pregame-available players, then
market-specific efficiency and residual distributions. Validate entirely on this season by replaying
every locked 2026 scope at its lock timestamp, then accumulate at least 100 settled non-push scopes
per market prospectively before a market-specific promotion, demotion, or movement flip.

Assignment-level tracking is a later enhancement, not the smallest blocker. Do not buy or claim
CB/WR or OL/DL features unless the same source can backfill timestamped history and populate live
pregame inference.

## Market observer boundary

The retained Week 5 evidence has real opening/current line and price trails, but only seven sharp-book
observations—every one Circa, none Pinnacle or Bookmaker. That is insufficient to fit a sharp movement
adjustment. Continue prospective same-book, same-line capture; missing sharp evidence is neutral.
Do not blend retail consensus into the independent point model or auto-flip sides to conceal its role
and availability gaps.

## Product alignment

- one independent football projection remains primary;
- one representative line and exact-price grade remain downstream;
- market reading stays separate and earns authority only by market-specific prospective evidence;
- every supported family remains visible; no picks are suppressed to improve an aggregate;
- locked records remain exact; and
- no new provider loop, writer, lease, UI copy, label, or layout is introduced by this research.
