# NFL player props Anytime TD scoring-channel source audit

Date: 2026-10-15  
Scope: approved, already-retained football sources only; no sportsbook input

## Finding

The retained nflverse play-by-play is sufficient to test an honest three-channel Anytime TD model
now. It identifies `pass_touchdown`, `rush_touchdown`, `return_touchdown`, `td_player_id`,
`td_team`, `qb_scramble`, `qb_kneel`, `qb_spike`, `rush_attempt`, `pass_attempt`, credited rusher
and receiver IDs, `yardline_100`, and `goal_to_go` for 2016-2025 and the retained 2026 Weeks 1-5.

It does **not** contain routes run, route participation, formation-level route assignment, or
player-level pre-snap alignment. Those fields are also absent from the retained snap-count, weekly
player-stat, NGS receiving, PFR advanced receiving, and FTN charting schemas. The model may use
offensive snap share and target share as honest role/opportunity variables, but may not call either
one route participation.

## Available contract by requested field

| Requested signal | Retained source | Coverage and safe use | Status |
|---|---|---|---|
| Scoring-channel identity | nflverse PBP | 2016-2025 plus 2026 Weeks 1-5; explicit pass/rush/return TD and scorer ID | available |
| Red-zone targets | nflverse PBP | Target credited to receiver with `yardline_100 <= 20`; strictly lagged by player/game | derivable |
| Goal-line targets | nflverse PBP | Target with `yardline_100 <= 10` or `goal_to_go`; strictly lagged | derivable |
| Red-zone/goal-line carries | nflverse PBP | Rush credited to rusher under the same field-position rules | derivable |
| QB scrambles | nflverse PBP | Explicit `qb_scramble` | available |
| Designed QB runs | nflverse PBP plus roster position | QB rush attempts excluding scrambles, kneels, and spikes | derivable proxy |
| QB sneaks | FTN charting | Explicit `is_qb_sneak`, but only 2022 onward and delivered after games | available but incomplete history |
| Player active/role survival | weekly rosters, injuries, depth charts, snap counts | Existing pregame availability plus strictly lagged postgame snap share | available |
| Routes/route participation | none of the retained sources | No authentic retained field | missing |

The designed-QB-run value is deliberately labeled a proxy: nflverse PBP does not provide a
complete designed-run flag. It is nonetheless stronger than pooling all quarterback rushes because
explicit scrambles, kneels, and spikes can be separated. FTN's explicit sneak flag is not used as a
required feature because it begins in 2022 and is postgame charting; adding it without a missingness
contract would change the information set across eras.

## Coverage evidence

Across 2016-2025, the checksum-pinned PBP contains 2,761 games, 484,254 plays, 8,407 pass TDs,
4,964 rush TDs, and 9,897 explicit QB scrambles. Every offensive touchdown row in the audit had a
non-null credited `td_player_id`. The retained 2026 file contains 79 games through Week 5, with 246
pass TDs, 153 rush TDs, 12 return TDs, and 337 explicit scrambles. Week 5 features must be shifted
from Weeks 1-4; Week 5 outcomes can only grade the frozen replay.

FTN describes its public subset as postgame manual charting, available from 2022 onward and normally
published within 48 hours. nflverse's current workflow publishes parsed PBP after games and refreshes
recent games for corrections. Neither source is a target-week pregame event feed. Their safe use is
therefore to update lagged state for the player's next game, never to infer target-game outcomes.

Primary source contracts:

- [nflverse data access and FTN timing/license](https://github.com/nflverse/nfl_data_py#usage)
- [official FTN public-field dictionary](https://github.com/nflverse/nflverse-ftn/blob/main/ftn_data_dictionary.csv)
- [official nflverse refresh schedule](https://github.com/nflverse/nflverse-data/blob/main/workflows.md)

## Smallest safe ingestion to close the route gap

The smallest useful new source is a licensed player-game route table with stable GSIS player/game
IDs and these fields:

- routes run and team dropbacks;
- route participation rate;
- red-zone routes and end-zone targets;
- slot/wide/tight alignment counts;
- source timestamp and correction timestamp; and
- explicit confirmation that the record was available before the next game's lock.

It should be ingested as an immutable, checksum-pinned postgame fact table and shifted one completed
game before modeling. No browser-scraped estimate, target-to-route reconstruction, or fabricated
route count is an acceptable substitute.

