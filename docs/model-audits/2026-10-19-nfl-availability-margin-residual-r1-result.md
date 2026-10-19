# NFL availability margin residual r1 — result

Date: 2026-10-19

Status: rejected research candidate; production forecast unchanged.

## Decision

Do not promote the bounded generic availability residual. It improved the reserved 2022 margin
MAE from `9.09298` to `9.07938` and improved the 37-game last-quarterback-designated subset from
`8.06038` to `7.59196`, but it failed the frozen gates:

- confirmation RMSE worsened from `11.98249` to `12.03776`;
- Moneyline improved from `175-94-2` to `177-92-2`, while Spread regressed from `134-127-10`
  to `130-131-10`; and
- completed 2026 regressed from `60-31-1` to `59-32-1` Moneyline and from `49-37-6` to
  `47-39-6` Spread.

The combined opened 2023–2025 stress window did improve margin MAE from `10.21861` to `10.13896`,
but an opened stress result cannot override the failed final-confirmation and direction gates. The
candidate therefore has zero score, side, probability, grade, promotion, demotion, board-count,
tracking, or locked-record effect.

## What the loss audit established

Carolina–Philadelphia was not an injury-collection miss. The stored report marked Jalen Hurts out,
the availability-adjusted depth selected Tanner McKee, and the player-aware projection favored
Carolina. A target-excluded professional Moneyline read and the market anchor also favored Carolina.
The r11 exact-provider independent score favored Philadelphia, and the established r29 guard did not
authorize a Moneyline flip without separately qualified Spread agreement. The target-exclusion
resolver consequently returned the market-free independent fallback.

That is a real arbitration gap, but the historical evidence does not justify replacing it with a
generic injury coefficient or deleting the cross-market guard. The generic residual tested here made
the complete product's key side metrics worse.

## Prospective shadow

Future unlocked payloads may record an internal zero-authority shadow only when all of these are true:

1. the verified injury report changes the provider's expected quarterback;
2. the player-aware score and target-excluded professional Moneyline authority agree; and
3. their agreed winner conflicts with the exact-provider independent winner.

The shadow stores the exact independent score separately from the final forecast, so later audits can
attribute a miss to the independent model, player-aware layer, market reader, or guard without
mislabeling one as another. It cannot change a score, probability, side, grade, actionability, stake,
tracking tuple, member card, or locked row. Promotion requires a separately versioned candidate with
prospective release-pure outcomes and full promotion/demotion accounting.

