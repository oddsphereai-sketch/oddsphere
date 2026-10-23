# NBA player-props market-history capacity repair

Date: 2026-10-23

## Production finding

The NBA refresh completed its line work but preserved the preceding player-props
candidate with `NBA props private payload JSON limit exceeded`. The deployed
market-history envelope contained 100,302 observations and 63,266,114
uncompressed JSON bytes (about 1.27 MB gzip), immediately below the old 64 MB
ceiling. The live candidate therefore remained on decision r6 even though the
rebound-family r7 runtime was deployed.

## Bounded repair

- Advance the private-store release from r4 to r5.
- Raise only the private market-history JSON limit from 64 MB to 96 MB.
- Preserve the existing 150,000-observation and 8 MB gzip hard caps.
- Preserve the exact first/prior/current quote chronology for every logical
  provider/event/player/book/market/line/side identity.
- Preserve r3 and r4 envelope decode compatibility.
- Do not change any model, calibration, decision, grade, provider cadence,
  member copy, labels, layout, or public route.
- Existing locked decisions remain byte-for-byte authoritative.

## Why evidence is not compacted further

A two-state first/current rehearsal reduced the payload to roughly 47.5 MB but
changed current decision evidence, including one actionable row. That approach
was rejected. The selected repair keeps all already-bounded evidence and only
corrects a storage ceiling that was lower than the established row cap permits.

## Release and rollback

Release:
`nba_player_props_private_store_2026_10_23_r5_bounded_market_history_capacity`

Rollback applies only if the authoritative refresh exceeds either remaining
hard cap, the live decision release is mixed, the member board becomes
incomplete, or any locked snapshot hash changes. Rollback must not rewrite a
stored lock.
