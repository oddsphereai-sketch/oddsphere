# NFL player-props Week 5 outcome identity repair

Date: 2026-10-15

Scope: 2026 Week 5 immutable private full-board archive
Mode: read-only evidence supplement; no locked-record mutation

## Result

All 42 exact offers previously reported as unmatched are now classified:

- 37 offers across 16 player-market identity scopes were confirmed participants with an official outcome of zero in the offered market;
- 5 offers across 5 player-market identity scopes were confirmed nonparticipants (four inactive, one cut) and are excluded from settled model-accuracy calculations;
- 0 offers remain genuinely unresolved.

The earlier “26 scopes” count used forecast/line decision scopes. Removing side/line duplication produces 21 player-market identity scopes, which is the level used by the repair.

The repair is deliberately a separate supplement. Stored BALLDONTLIE state, locked projections, probabilities, prices, grades, and outcomes were not edited. A stored official outcome always has precedence. The supplement is consulted only when the existing official player-stat row is absent.

## Root cause

The reporter assumed that every valid participant would have a BALLDONTLIE player-stat row. That is false for players who took snaps but recorded no passing, rushing, receiving, or touchdown statistic.

Examples confirmed in the retained official evidence:

- Kenneth Gainwell played 26 offensive snaps but had no rush or target event;
- Ted Hurst played 33 offensive snaps but had no target or touchdown event;
- Konata Mumpfield played 6 offensive snaps but had no target or touchdown event;
- Tyler Goodson played 3 offensive snaps but had no rush or touchdown event;
- Ko Kieft played 1 offensive snap and recorded no touchdown;
- Jackson Hawes and Keleki Latu had explicit zero-valued nflverse player-stat rows even though the retained BALLDONTLIE state omitted them.

The nonparticipants were Camden Brown (inactive), Emari Demercado (cut), CJ Daniels (inactive), DJ Moore (inactive), and Max Klare (inactive). They had no official player-stat row, no offensive snap, and no play-by-play mention in the exact game. They are not assigned a mathematical zero because participation-specific sportsbook settlement rules are not reconstructed here.

## Evidence and precedence rules

The supplement uses retained nflverse player stats, snap counts, weekly rosters, and play-by-play for the exact matchup/week. Identity is normalized within the exact game and tolerates name suffix differences such as “Ted Hurst” versus “Ted Hurst III.”

A missing-stat row is settled to zero only when participation is independently proven by at least one official player-stat row, offensive snap, or play-by-play mention, and the retained official stats/PBP contain no event for the audited market. A row with no participation evidence is excluded only when the weekly roster state independently says `INA` or `CUT`; otherwise it remains unresolved.

Scripts:

- `scripts/operator/audit-nfl-player-props-unmatched-outcomes.ts` exports the missing-official-row identities from immutable private history and current-season state;
- `scripts/operator/resolve_nfl_player_props_unmatched_outcomes.py` produces the read-only nflverse evidence supplement;
- `lib/services/football/nflPlayerPropsOutcomeSupplement.ts` validates the read-only, zero-write, zero-mutation contract and guarantees stored-outcome precedence;
- `scripts/operator/report-private-player-props-tracking.ts` accepts the supplement only through the explicit `--nfl-outcome-supplement` argument;
- `scripts/test-nfl-player-props-outcome-supplement.ts` proves that a stored outcome cannot be overwritten, a confirmed zero can fill an absent field, and a nonparticipant is excluded rather than assigned zero.

## Corrected Week 5 ledger

| Measure | Before repair | After repair |
|---|---:|---:|
| Captured exact offers | 451 | 451 |
| Settled exact offers | 409 | 446 |
| Confirmed nonparticipants excluded | 0 | 5 |
| Unresolved exact offers | 42 | 0 |
| Canonical/main-line records | 135 | 149 |
| Canonical record | 69-66 | 70-79 |
| Canonical exact-price units | -0.274u | -12.356u |
| Canonical exact-price ROI | -0.20% | -8.29% |
| Independent Brier | 0.21305 | 0.21592 |
| Market Brier | 0.20710 | 0.20771 |
| Final Brier | 0.20542 | 0.20659 |

The repaired evidence makes the product diagnosis less flattering but more accurate. The omitted zero outcomes had disproportionately been losses for the offered sides. This strengthens, rather than weakens, the decision to keep Anytime TD actionability disabled and to avoid promoting Receiving Yards changes without better route inputs.

Corrected main-line family results materially affected by the repair:

| Family | Record | Units | Independent Brier | Market Brier | Final Brier |
|---|---:|---:|---:|---:|---:|
| Anytime TD | 11-40 | -22.956u | 0.10913 | 0.09356 | 0.09445 |
| Receiving Yards | 18-13 | +3.060u | 0.28475 | 0.29165 | 0.28802 |
| Receptions | 17-14 | -1.131u | 0.25374 | 0.26009 | 0.25605 |
| Rushing Yards | 7-9 | -2.794u | 0.33329 | 0.28379 | 0.28977 |

The full-board archive begins in Week 5; Weeks 1-4 remain absent rather than reconstructed. Thus the Week 5 captured board is fully classified, but the season-to-date archive is not complete.

## Release-pure loss-ledger update

The corrected loss ledger contains 149 settled canonical scopes and zero unresolved exact offers. It continues to identify role/share and matchup failures in the receiver families:

- Receptions losses show repeatable separation on participation/role harm, player-share harm, and matchup harm within this one-week board;
- Receiving Yards losses show repeatable participation/role and efficiency separation;
- Anytime TD losses show repeatable player-share and matchup separation.

These are diagnostic leads, not deployment authority. Week 5 is the first complete private board, and the missing route fields still block an honest test of the intended receiver-role architectures.

No model release, calibration release, grade, stake, production writer, public reader, or site behavior changed.
