# NFL Player Props sharp-reference cadence alignment — October 20, 2026

## Incident and authority

The existing NFL forward-evidence cron remains the only player-props writer and
runs under the shared `prediction_pipeline:nfl` lease. The preceding writer is
`nfl_player_props_writer_2026_10_19_r57_stale_reference_retry`; the candidate is
`nfl_player_props_writer_2026_10_20_r58_reference_age_aligned_capture`.

Production's Week 7 member snapshot was fresh at `2026-10-20T12:21:10Z`, but
its separate qualified-reference cache was still the `07:06:10Z` capture with
59 complete Pinnacle/NoVig offers across two games. The props cadence is based
on elapsed time from the preceding completed snapshot and had become anchored
near minute 21. The reference collector admitted ordinary pulls only in UTC
minutes 0 through 14. A healthy hourly writer could therefore repeatedly skip
the only ordinary reference-capture window.

## Verified upstream evidence

Credential-backed, read-only provider collection at approximately `12:50Z`
returned:

- 390 exact reference observations: 50 Pinnacle and 340 NoVig.
- 139 complete Over/Under pairs: 25 Pinnacle and 114 NoVig.
- 251 exact reference offers, of which 139 were complete.
- Exact-event matches on 13 of the 14 Week 7 games.
- Zero writes.

This proves the missing production coverage was a scheduling defect, not an
empty provider or a team/event normalization failure.

## Repair

At each already-authorized props-writer wake, the reference gate now compares
the current evaluation time with the newest retained qualified offer. It runs
the existing bounded reference collector when that evidence is at least 60
minutes old. Missing, future-dated, or too-old evidence still retries; a fresh
capture suppresses duplicate pulls; and any game 45–90 minutes from kickoff
still receives the existing final pre-lock pull.

No endpoint, cron, writer, timer, source, page budget, call ceiling, model
formula, market-reader rule, probability, projection, side, grade threshold,
stake, lock, tracking, settlement, or UI behavior is added or changed.

## Board impact and safety

A forced fresh-source Week 7 no-write replay made 44 provider calls under the
declared 113-call ceiling and recovered 115 effective qualified reference
offers. Against the independent fallback on that same capture, only Receptions
changed: 66 projections and four forecast sides, with zero actionable
promotions and zero demotions. Same-input r57 and r58 outputs are identical;
the release changes only when already-authorized fresh evidence is collected.

Existing locked member and tracking rows remain byte-for-byte authoritative.
Rollback only the writer cadence gate to r57 if ordinary reference pulls occur
more than hourly, provider ceilings are exceeded, lock precedence changes, or
the live cache does not expand beyond the stale two-game state.
