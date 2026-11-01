# NFL locked fixture continuity, November 1

Base: `5450cc1a807dfd08c2b7c2003dc96132d9edf07b`, protected PR912.
The r103 deployed writer completed five unlocked games/15 coherent evaluations
with seven Best Angles, one Lean, three Watchlists and four No Plays. Its member
publication correctly retained the previous snapshot: the fixture builder lacked
the exact preceding r51/r54 tuple and admitted only6/14 games, dropping eight
Sunday locked games from the proposed new fixture. No locked row was mutated.

This follow-up adds that exact preceding pair to locked transition eligibility.
It also makes the first valid immutable T-60 tuple win before release-recency
selection, so a later current unlocked row cannot displace a prior public lock.
An unknown/mismatched release pair or prior unlocked row remains ineligible for a
mixed current board. Original stored fields, probabilities, grades, prices,
stakes, evidence and release labels retain precedence; no reconstruction occurs.

Only reader/fixture identifiers advance: fixture68 and snapshot60 with suffix
`locked_fixture_continuity`. Original r59/fixture67/member52/decision55 member
snapshots remain exact compatible predecessors. Writer103/model47/cal46/
decision55/member52, numerical predictions, grades, provider budgets, cron,
single prediction_pipeline:nfl lease, tracking and stakes remain unchanged.

Required verification: mixed-release reader precedence in both row orders,
duplicate-lock precedence, exact stored locked tuple rendering, no overwrite,
full NFL focused checks, model-change checks, TypeScript, build, actual 14-game
stored-evidence no-write fixture construction, fresh-main integration safety and
protected PR. After deployment, use the normal publication/writer path to verify
snapshot60, the five unchanged member52 games and all nine pre-existing lock
IDs/checksums. Do not claim member-visible success from generated writer rows.
