# CFB complete tracking denominators

Date: 2026-09-04

This is a tracking-publication correction. It does not change a forecast, PMF,
probability, selected side, grade, stake, price, provider request, or lock.

The read-only production audit found 45 settled CFB prediction records across
17 games: 12 Moneyline, 17 Spread, and 16 Total. On the September 3 slate the
visible mismatch was 6 Moneyline, 10 Spread, and 9 Total. Five games lacked a
Moneyline record and one of those also lacked a Total record because official
tracking serialized only `evaluatedBets`; price-unavailable `heldMarkets` were
omitted even when the immutable T-60 payload retained a model-owned market
outlook.

Tracking r14 serializes each available held outlook as a locked `No Play` with
the model forecast side/probability and reference line. Exact price, market
probability, edge, EV, stake, and Best Angle status remain absent. The ordinary
grader therefore counts its directional prediction while ROI and recommendation
performance remain price-qualified. Existing `(game, market)` rows are never
replaced; the sole writer's market-scoped idempotency naturally adds only the
missing rows from retained immutable T-60 evidence.

Acceptance requires 3/3 market records for every eligible T-60 payload whose
three model outlooks exist, null economics on held records, no changes to any
existing row, and equal per-market accuracy denominators. Roll back writer r43
and tracking r14 if a held row gains a synthetic price/EV, an existing tuple is
rewritten, or a market without a valid forecast side/reference line is inserted.
