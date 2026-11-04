# Daily Edge and player-props operational health — November 4

Starting production base: `23f140f8b7aaa89258e569f015dcd8c183767734`.
Audit window begins 12:17 UTC (07:17 America/New_York). This is source,
refresh, publication, price-provenance and settlement verification, not a
new accuracy/backtest claim. No historical locked payload is repaired.

## Verified production inputs

| Product | Evidence at capture |
| --- | --- |
| NBA Daily Edge | 14 current-day games /42 predictions, all priced; current lines at12:12 UTC. The rolling board contains53 games. |
| NBA stats |107 finalized2026-season games,2,894 player boxes,3,265 advanced rows; current-state refresh11:30 UTC. The independent game-input store also has107 games. Latest included games started Nov3 UTC (Nov2 ET); the official ESPN Nov3 ET scoreboard has zero games. Old legacy `nba_team_ratings.updated_at` is not evidence that this active professional input store is stale. |
| NBA props |14 games /1,226 canonical rows across eight market families; full stored-input replay has zero zero/negative projections.37 actionable rows. |
| NFL Daily Edge | Week9:15 games /45 markets, all priced, all opening trails present; dedicated90-minute source/publication audit passes. Original quote-change time is distinct from the time an unchanged quote was checked. |
| NFL stats | Complete through Week8:121 final games,7,906 player-stat rows,242 team-stat rows. All14 Week8 games have player stats, including Monday's game. |
| NFL props | Natural12:21 UTC refresh:1,068 member rows, all15 games; no member quote older than six hours and no unavailable stale-quote or feature-context diagnostic.156 role/identity exceptions and575 missing independent benchmarks remain explicitly separate from completed evaluations. These counts are not fabricated forecasts or a claim of complete coverage for every offered player. |
| NHL | Four games /12 priced markets; active r25 at capture.2026 MoneyPuck team-stat rows refreshed11:47 UTC. Current-season games, roster priors and goalie inputs are present; morning goalie assignments remain explicitly assumed rather than claimed confirmed. |
| CBB | Current training includes139 games through Nov4 03:00 UTC, receipt updated09:02 UTC. Published rolling member board has11 games /33 markets (ten current-day plus one future game). Schedule-only games are not silently counted as evaluated models. |
| CFB |108 weekly games, including two started games.83 have current prices; all25 unpriced games are FCS-only. Zero missing-price FBS-involved games. Original quote timestamps on locked games are intentionally historical. |
| EPL | Stored upcoming board contains ten fixtures and current model prices; regular half-hour writer succeeds. |
| UCL | Nine current fixtures; statistics/history sources ready. Repeated production publication blocks for non-positive-EV actionables preserve the previous board. This is an outstanding sport-owned repair, not a green freshness certification. |
| MLB/WNBA | No current games. Empty active-day reads cannot establish next-season model quality; off-season absence is not missing odds for a real game. |

The SELECT-only Nov2–3 lock/grade join found no unsettled final records among
45 NBA,45 NHL,393 CBB,40 soccer,3 NFL and6 CFB final locked rows. This is a
bounded recent check, not a claim about every historical lock or CLV field.
Supabase returns the grade relation as a one-to-one object; treating it as an
array would incorrectly flag every record as unsettled.

Memory at12:28 UTC:4,009,758,720 bytes physical RAM;1,581,129,728 available;
3,856,420,864 committed;432,238,592 swap occupied; zero OOM kills and pool
timeouts. Exporter starts remain unchanged since the owner resize. Swap is
not zero; cumulative page counters are not a current paging-rate measurement.

## Corrections in this release

1. The protected deep audit includes CBB and the actual separate soccer Double
   Chance DTO. Failed/error board reads cannot certify a healthy empty slate;
   one failed sport no longer prevents reports for the others. The audit uses
   CBB's existing `whyLine` economic reasons and legitimate college-favorite /
   Double Chance odds ranges rather than applying an unrelated generic cap.
2. NBA props `bootstrap_required` /`last_known_good_preserved` outcomes persist
   a partial refresh and a specific summary even when the writer did not throw.
   This does not block a healthy Daily Edge publication or change retry cadence.
3. MLB props classifies the exact combination of an official empty schedule,
   zero member/source rows and only `PROP_ODDS_UNAVAILABLE` as inactive. A real
   game, extra validation error, missing schedule or unmatched source row still
   raises a partial alert. No empty replacement snapshot is published.
4. NBA props comparison prices previously used newest book/side rows from the
   entire historical archive, collapsing the primary retail and secondary Owls
   lanes. Three evaluated prices were absent from their comparison ladders.
   The new display-only helper uses the captured current cycle, the incumbent
   retail-primary/Owls-reference distinction, and the actual target in its own
   slot. It excludes openings, live rows, unsupported one-way Yes offers and
   unresolved player identities. No model input, quote selection, point
   forecast, probability, pick, grade, stake or provider request changes.

Frozen live replay at12:38 UTC:44,247 current observations,14 games,
1,226 decisions. Missing exact evaluated prices3→0;1,194 ladders differ as
obsolete/secondary rows are replaced by current authorized rows. Every other
decision field hashes identically; source snapshot hash unchanged. Promotions,
demotions and side changes0/0/0; actionable count37→37. Only writer release
advances r10→`nba_player_props_private_writer_2026_11_04_r11_member_quote_authority`;
frozen runtime r13 /forward decision r14 /model r16 /calibration r15 remain.
Existing locked ladders retain their exact old payload through lifecycle
precedence; no migration or historical update is performed.

## Verification and remaining boundaries

### Additional NFL props settlement gap

The props-specific ledger check at12:47 UTC found208 pending NFL records in28
completed games:194 missing player IDs and14 populated IDs. Null-ID games were
consuming the18-game settlement allowance before newer usable-ID games could
run. MLB has zero pending prop records. This finding is distinct from the
already-settled Daily Edge record join above.

Settlement r4 excludes null IDs before pagination and game budgeting; unresolved
historical identities are counted by an exact metadata query and persisted as a
specific refresh-health warning. The same sole writer r67 captures missing IDs
for new tracking inserts only from one unique same-game/start/team/name roster
record observed before T60, with provenance beside the unchanged decision.
Tracking r41 remains insert-only; it cannot repair an existing legacy null ID.
The model/calibration/member/decision releases and all forecast fields remain
unchanged. No extra provider request is added; routine settlement avoids the
unresolvable28-game historical scan and can reach the six usable-ID games.

The recovery operator delegates to the same bounded settler under the existing
`prediction_pipeline:nfl` lease. It is read-only by default. Apply requires the
owner-approved audit's exact SHA256, restricts updates to the reviewed record
IDs, rechecks each official outcome/identity against that audit before writing,
and verifies every protected locked field hash before and after. It updates
only result, actual value and settlement timestamps: even the original null
provider IDs and complete snapshot JSON stay unchanged. Historical recovery
is never enabled by ordinary cron calls.

The actual28-request official dry run proposes171 outcomes and leaves23
unmatched records untouched. Audit artifact:
`/private/tmp/oddsphere-nfl-props-settlement-owner-review-20261104.json`, SHA256
`9daef9f56184503c05478bf3af24cd064845f51da31a138fd48a05f118ee3e6d`.
The separate current-state check matches13 of14 populated-ID records; the
remaining player has no official stat row and is not assigned an invented zero
or void. Historical recovery requires explicit owner approval, requested in
the model-health chat; this document does not assert that it has run.

Focused coverage includes more than a full page of null IDs before usable
records, exact same-game/team/name identity, duplicate names, wrong teams,
wrong games, nonfinal status, pre/post-cutoff roster timestamps, original-ID
precedence, read-only previews, outcome-only update fields and complete legacy
insert-only precedence.

Required full model-change verification; TypeScript; focused deep-audit,
actual mocked MLB route, refresh telemetry, NBA current-price provenance,
production readiness, private tracking and complete locked-ladder precedence
checks are required before publication. The expanded frozen board audit covers
208 games /643 markets with zero critical findings. Its117 missing-price
warnings are39 future NBA games at the three-market level; the25 unpriced
FCS games are separately held and are not part of that warning count.
Current-day NBA and all FBS-involved CFB games are priced. This count includes
the rolling future schedule, not just today's slate.

UCL's publication guard remains a real open item; NHL and CBB model-reader
reviews are owned by their already-active model chats. This patch must not
replace those changes. Fresh-main integration and all overlapping hunks must be
reconciled before merge. After production deployment, verify the new writer
source stamp and exact-price presence after the next natural NBA refresh,
MLB's inactive result, all nine deep-audit sport reports and locked precedence.

Rollback removes these display/telemetry changes for future unlocked refreshes.
It never rewrites a stored lock or restores superseded model behavior.
