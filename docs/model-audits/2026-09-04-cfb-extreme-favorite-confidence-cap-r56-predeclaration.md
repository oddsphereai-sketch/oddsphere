# CFB extreme-favorite confidence cap r56 — predeclaration

Date: 2026-09-04

Status: outcome-blind implementation candidate; production publication requires the full model-change and protected-PR gates.

## Problem

The active CFB holistic-confidence policy correctly separates sportsbook price and EV from the underlying prediction, but that separation is too absolute for the member-facing tier. Georgia State is currently selected at -4000 with a 96.01% model probability and a target-excluded 95%+ market fair probability. The prediction can reasonably remain Georgia State and the exact quote should remain visible, but labeling heavily priced favorites `Best Angle` overstates their useful differentiation for members.

This correction must not restore the old behavior in which an ordinary negative-EV quote or one book's modest price change abruptly turns a Best Angle or Lean into a No Play.

## Predeclared policy

For a selected CFB moneyline favorite only, apply this graduated ceiling to the confidence grade after the continuous model/evidence score is evaluated:

1. -200 or better remains eligible for every tier;
2. worse than -200 through -499 cannot exceed `Lean`;
3. -500 or worse cannot exceed `Watchlist`.

This is a tier ceiling, not a veto:

- side, model probability, projection, quote, EV and evidence score remain unchanged;
- `Lean` remains actionable;
- `bet` versus `shop` remains a separate execution judgment using the attached quote;
- no stake logic changes;
- plus-money selections, spreads, totals and moneylines priced -200 or better remain governed by the continuous holistic-confidence policy.

## Predeclared evaluation

The candidate must be tested on the identical current production board and fixtures before any publication. Report:

- every grade transition and its full decision tuple;
- Best Angle / Lean / Watchlist / No Play counts before and after;
- actionable count and `bet` / `shop` counts before and after;
- side, probability, projection, quote, EV and stake differences;
- boundary fixtures proving -200 remains uncapped, -201 is capped at `Lean`, -499 remains eligible for `Lean`, and -500 is capped at `Watchlist`;
- non-moneyline fixtures proving the cap cannot affect spread or total confidence.

Acceptance requires Georgia State -4000 to become a `Watchlist` without becoming a `No Play`, zero side flips, zero probability/projection/quote/EV/stake changes, and no transitions outside the predeclared moneyline bands. The result must separately disclose the actionable-count change caused by `Lean`-to-`Watchlist` ceilings; a materially broader impact remains shadow-only for review.

## Release and rollback

The candidate will receive new CFB confidence, market-grade, decision, evidence, member, writer, fixture/outcome, snapshot and tracking release identifiers in the same commit. Rollback is the prior r54/r55 publication set documented in `docs/current-model-releases.md`; immutable locked records retain their original release identifiers.
