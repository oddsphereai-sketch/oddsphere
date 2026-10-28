# NBA player-props market-history capacity repair

Date: 2026-10-28

## Production finding

The NBA player-props writer preserved its last-known-good r8 snapshot after the
bounded market archive reached 142,905 observations. The stored history occupied
95,600,192 uncompressed bytes against a 96,000,000-byte guard, while its actual
compressed database envelope was only 2,309,172 bytes against the independent
8,000,000-byte hard cap. The next refresh exceeded the 150,000-observation guard
before the deployed exact movement-endpoint writer could publish.

## Bounded repair

- Advance the private-store release from r5 to r6.
- Raise the market-history observation guard from 150,000 to 250,000.
- Raise the uncompressed in-process JSON guard from 96 MB to 192 MB.
- Keep the compressed database-envelope hard cap unchanged at 8 MB.
- Preserve the existing first/prior/current compaction for every logical quote.
- Preserve r3-r5 envelope decode compatibility.
- Do not change projections, probabilities, sides, prices, grades, stakes,
  actionability, provider cadence, member copy, labels, or layout.
- Do not rewrite or reinterpret locked decisions.

## Capacity basis

The live 12-game archive averaged roughly 669 uncompressed bytes per retained
observation. At the new 250,000-row ceiling, the same shape remains below the
192 MB JSON guard. Linear compression remains well below 8 MB, but the unchanged
compressed cap still fails closed if the evidence shape changes materially.

## Release and rollback

Release:
`nba_player_props_private_store_2026_10_28_r6_expanded_bounded_market_history_capacity`

Rollback applies if the refresh exceeds either hard cap, member coverage drops,
the exact evaluated movement endpoint regresses, or any locked payload changes.
Rollback must never rewrite a stored lock.
