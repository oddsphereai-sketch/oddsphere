# CFB current split identity completion

Date: 2026-10-24

Status: production candidate; publication and live verification required

## Owner direction and observed defect

The owner reported missing sharp-book/fallback splits on Indiana at Michigan and
Oklahoma at Mississippi State. A live zero-write audit proved that DraftKings
Network published complete Moneyline, Spread, and Total ticket/handle pairs for
both exact games, and the durable production snapshot retained those rows. The
member overlay nevertheless attached zero markets because the centralized CFB
identity resolver rejected the provider's exact school labels `Indiana`,
`Michigan`, and `Oklahoma` as ambiguous prefixes.

This was an identity defect, not a provider-availability gap. Playbook public
splits, exact prices, and all three forecasts were already present on both
cards. Raw SharpAPI `/splits` did not publish either event in the audited wave;
the established DraftKings Network fallback is therefore the correct display
source.

## Bounded repair

Add only abbreviation-scoped exact aliases `IU -> Indiana`, `MICH -> Michigan`,
and `OU -> Oklahoma`. Retain the existing global ambiguity rejection and prove
that those labels cannot attach to Indiana State, Michigan State, or Oklahoma
State. Advance the SharpAPI split identity release to r5 and the sole CFB writer
to r136 because the shared resolver also protects future provider ingestion.

No model equation, calibration, decision threshold, grade, stake, sportsbook
hierarchy, provider cadence, writer, or lease changes. DraftKings Network rows
remain the established lower-authority fallback and do not impersonate Circa.

## Same-input board and lock contract

The current production board before the repair contains 96 games and 288
forecasts, with 95/96 Moneyline quotes, 96/96 Spreads, and 96/96 Totals. The
single missing Moneyline is Murray State at South Dakota State, where every
captured SharpAPI and The Odds API named book currently publishes Spread and
Total but no two-sided Moneyline. No price is synthesized.

For Indiana-Michigan and Oklahoma-Mississippi State, this repair must populate
three fallback split panels per game while changing zero picks, probabilities,
projected scores, grades, promotions, or demotions. Existing locked payloads
remain immutable; future unlocked evidence continues through the sole writer
and `prediction_pipeline:cfb` lease.

## Current price, injury, and grade audit

The same live audit found 4 Moneyline Best Angles, 6 Moneyline Leans, 81
Watchlists, and 5 No Plays. The board is selective, not uniformly flat. The
short-favorite lane is active: Southeast Missouri State at -260 is a Lean and
Idaho State at -489 is a Lean because each has a positive target-excluded edge
and nonnegative exact-price EV. Indiana at -295 remains Watchlist: its 70.89%
forecast probability is below its 72.48% target-excluded fair probability and
the evaluated quote is -5.07% EV. Promoting it solely as a parlay leg would
violate the current exact-price actionability release and worsen calibration.

The latest production evidence has verified reports for 33 of 96 games from
official conference or exact ESPN reports. Oklahoma-Mississippi State has a
current exact ESPN report in the stored evidence. A zero-write read of all 12
official conference sources at 14:07Z returned no exact Indiana-Michigan report
and no provider failures; the collector therefore cannot truthfully invent an
injury list for that game. The next due unlocked writer cycle retains the same
exact-source and last-known-report behavior.

## Acceptance gates

- Exact identity unit tests pass, including all three state-school collision
  rejections.
- The DraftKings overlay test attaches all three markets to both exact games.
- A live zero-write overlay rehearsal shows both current cards populated and
  reports zero forecast/grade changes.
- Focused CFB tests, TypeScript, `npm run verify:model-change`, clean latest-main
  integration safety, protected PR checks, and post-deploy live verification
  pass before declaring success.
