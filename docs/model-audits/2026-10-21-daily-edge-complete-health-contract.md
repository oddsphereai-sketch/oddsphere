# Daily Edge complete-health certification contract

## Purpose

Daily Edge used separate sport audits with different coverage vocabulary. The
legacy all-model report omitted NFL and CFB entirely, so an operator could not
honestly certify the complete product from one checklist. This is monitoring
fragmentation, not a reason to replace sport-specific predictive logic with a
generic market weight.

## Contract

Release `daily_edge_complete_health_contract_2026_10_21_r1_all_active_models`
covers MLB, WNBA, NBA, NFL, CFB, NHL, and the soccer family. Every active game
must prove the same dimensions: schedule, statistics, availability, fresh
paired prices, same-book opening/current history when movement is used,
provider-published split handling, active release identity, market-reader
trace, projection/pick coherence, lock lifecycle, and tracking. Each sport
retains its own source hierarchy and qualified reader.

Missing provider data is not inferred. A sport with no active games is
`inactive`, not red. An active source credential, quote, or evidence dimension
that is absent is red. Splits are required only when the contracted provider
publishes them; no split, wager size, bettor identity, or private limit may be
fabricated from line movement.

The database readiness audit now derives its markets from this registry and
includes NFL and CFB. Football is evaluated over a weekly board window rather
than incorrectly treating a Tuesday with no kickoff as an empty product.

## Current read-only evidence

At 2026-10-21 12:57Z, WNBA had 1 game / 3 complete records, NBA 11 / 33, NHL
2 / 6, soccer 9 / 108, NFL 14 / 42 with zero missing prices or trails, and CFB
96 / 288 with fresh publication. CFB's 56 FBS-involved games had current odds;
40 FCS-only games had no current market from any configured provider and were
correctly held. The CFB national injury credential was not configured in the
local production-equivalent environment. Therefore complete Daily Edge cannot
yet be certified all-green.

This contract changes no prediction, probability, projection, side, grade,
stake, price, model input, writer, cadence, lock, or stored record. It prevents
future audits from silently omitting an active model or evidence dimension.
