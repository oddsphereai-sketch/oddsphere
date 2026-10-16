# NFL player props private-tracking health — 2026-10-16

## Scope

Operational monitoring only. This change does not alter projections,
probabilities, sides, grades, stakes, prices, provider calls, cadence, member
copy, layout, official tracking, settlement, or any locked record.

## Live read-only verification

- Week 6 private history decoded with a valid checksum and the expected
  `nfl_player_props_private_tracking_2026_10_12_r1_full_locked_board` schema.
- The Thursday game retained 215 exact locked offers: 136 canonical main-line
  offers and 79 alternates, all under decision release
  `nfl_player_props_decision_2026_10_15_r32_independent_rushing_yards`.
- The official actionable ledger retained four Week 6 records under the same
  decision release.
- The 12 most recent `nfl_forward_evidence` runs were successful with no error
  message at the time of the audit.

Weeks 1–4 remain honestly unavailable as complete full-board archives. Week 5
and every subsequent captured week remain immutable forward evidence.

## Repair

`NFL_PLAYER_PROPS_PRIVATE_TRACKING_CAPTURE_FAILED` is now part of the sole NFL
cron's critical player-props health set. A private archive failure therefore
marks the run partial and persists the failure in normal cron health instead of
remaining visible only inside the nested writer details.

The private archive remains last, failure-isolated, append-only, and outside
the member-facing product. No second writer or timer is introduced.
