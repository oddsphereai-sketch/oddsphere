# NFL player props canonical main-line result — 2026-09-25

## Frozen production replay

The release was replayed read-only against the Week 3 production snapshot generated at
`2026-09-25T11:36:09.747Z`.

| Measure | Existing member snapshot | Candidate member snapshot |
|---|---:|---:|
| Member rows | 2,817 | 1,913 |
| Already-locked rows retained | 526 | 526 |
| Unlocked rows | 2,291 | 1,387 |
| Alternate unlocked rows removed | 0 | 904 |
| Player/category scopes retained | 975 | 975 |
| Unlocked scopes with more than one line | present | 0 |
| Actionable exact-price rows | 56 | 42 |
| Actionable player/category scopes | 48 | 36 |
| Grade promotions | 0 | 0 |
| Grade demotions | 0 | 0 |
| Retained-row mutations | 0 | 0 |
| Actionable projection/line contradictions | 0 | 0 |

The twelve actionable scopes removed from the member action count were actionable only at an
alternate ladder rung. They were not demoted or rewritten; the true consensus main-line rows retain
their original grades. This reduction is the requested removal of duplicate alternate-line products,
not a hidden grade threshold or board quota. The complete internal board, immutable locks, official
tracking records, and settlement evidence remain unchanged.

Representative consensus passing lines selected by the frozen replay included Josh Allen 238.5,
Justin Herbert 222.5, Bryce Young 220.5, Deshaun Watson 189.5, Geno Smith 223.5, and Jared Goff
255.5. Each retained both exact Over and Under rows. Price balance was used only to identify each
sportsbook's main-line vote; it did not change a price, probability, projection, side, grade, or stake.

## Release contract

- Member: `nfl_player_props_member_2026_09_25_r24_canonical_main_line`
- Member lifecycle: `nfl_player_props_member_lifecycle_2026_09_25_r6_canonical_main_line`
- Writer: `nfl_player_props_writer_2026_09_25_r27_canonical_main_line`
- Model, calibration, decision, runtime, board, tracking, settlement, collector, cron, provider-call
  ceilings, and the shared `prediction_pipeline:nfl` lease are unchanged.

The selector groups by game, team, suffix-normalized player identity, and category. Per-book balanced
two-sided lines vote on the main line; their median anchors selection of one actually offered line.
All alternate observations remain stored internally. Existing locked member rows retain exact
precedence until normal rollover; every new scope is canonical before lock and remains canonical
after it locks.

## Verification

Verification results are recorded in the release commit and protected pull request. Production
acceptance requires a successful writer cycle reporting the new writer/member releases, a fresh
member snapshot, zero unlocked multi-line scopes, unchanged internal exact-offer coverage, a released
NFL pipeline lease, and a responsive member route.
