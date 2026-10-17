# Daily Edge release and availability audit

Date: 2026-10-17

## Scope

This is the owner-requested read-only audit of every current Daily Edge, plus
the bounded NHL member-availability repair. It does not authorize a prediction,
probability, side, grade, stake, or locked-record rewrite.

## Current production release proof

- MLB: one current game and three unlocked records; all match decision r92,
  rule bundle v77, calibration v38, and grade policy v61. No coherence blocker.
- WNBA: one current game and three unlocked records; all match model v1.7,
  coherent distribution v8, grade policy v12, and record contract v8. No
  coherence blocker.
- NFL: the published Week 6 member snapshot is r38 with fixture r46, member r33,
  and evidence r6. It contains 14 games / 42 markets, all 42 priced, and the
  built-in health audit reports no critical issue or warning.
- CFB: the published snapshot is r52 with fixture r92, member r64, and evidence
  r47. It was less than five minutes old at the audit, contains 95 games / 285
  markets, and has no unavailable prediction or member-presentation health
  error. The only missing prices are the two sportsbook-OFF Moneylines
  documented in the paired cross-division audit.
- NHL: all 14 games / 42 markets use model r18, all three markets exist per game,
  and every market has a current price. Existing unlocked rows still carry the
  inaccurate historical goalie-source label; candidate refresh r11 corrects
  future provenance without changing the selected feature or forecast.
- NBA: the first populated regular-season slate has three games / nine markets
  under model r6 and grade policy r5. All three games have complete reader
  evidence under market marriage r5 and professional reader r5. No market read
  currently qualifies for forecast authority; the reader therefore preserves
  the independent scores instead of forcing a correction.
- EPL: the current member snapshot has 10 games and every public game explicitly
  identifies model r20 and grade policy v25. Older unlocked r19 database rows
  are superseded transition records and are not rendered. The one already
  locked public game retains its immutable r20 tuple.
- UCL: no current member snapshot exists because there is no current published
  board. Runtime constants remain model r8u / grade r10, and the complete UCL
  production, database-lock, winner-accuracy, and homepage-tracker suites pass.
- CBB: no current board exists; it remains planned/inactive and cannot displace
  active models in navigation.

## NHL repair proof

The candidate ESPN availability release
`espn_nhl_availability_2026_10_17_r1_injuries_and_published_goalies` returned
all 14 exact-date matchups, 14 complete published-goalie pairs, 101 injury rows,
and one provider-confirmed starter. Expected and Confirmed are kept distinct.
The collector is bounded to one scoreboard plus at most 20 exact-game summary
requests, four concurrent requests, an eight-second timeout, and a 15-minute
member-reader cache. Missing summary data never means clear, and availability
does not alter the model or grade.

The prediction writer already filtered goalie priors to verified current
rosters. Refresh r11 changes only the stored future-unlocked source label from
`default_most_playoff_gp` to `current_roster_prior_gp`; it never calls that
player a confirmed starter. Existing locked payloads are untouched.

## CFB gap decision

Exact ESPN event and sportsbook payloads prove that DraftKings explicitly
returns `OFF` for both Moneyline sides of Charleston Southern at Clemson and
The Citadel at Texas A&M while publishing Spread and Total. The configured
official conference feeds and exact ESPN summaries publish no injury report
for either matchup. The correct safe behavior is therefore to keep those two
Moneylines held and availability visibly unverified. The candidate makes the
member explanation precise but does not fabricate a price, report, player, or
release change.

## Verification

- Focused ESPN NHL availability and provenance tests: pass.
- Live NHL exact-date collector rehearsal: 14/14 games and goalie pairs.
- NHL regular-model, tracking-boundary, split-fallback, and writer-safety tests:
  pass.
- Daily Edge experience suite: 216 pass, 0 fail.
- TypeScript: pass.
- Full `verify:model-change`, including its preverification suite: pass.

## Rollback and remaining external limitations

Roll back the NHL display collector and r11 provenance tag if exact-matchup
identity, source semantics, request bounds, model isolation, or immutable-lock
precedence fails. CFB report and Moneyline absence cannot be repaired in code
without a real official report or complete eligible two-sided sportsbook quote;
future evidence should be ingested automatically when those sources publish it.
