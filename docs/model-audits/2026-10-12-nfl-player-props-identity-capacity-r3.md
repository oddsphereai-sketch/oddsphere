# NFL player-props regular-season identity-capacity repair r3

Date: 2026-10-12
Starting production base: `1839de6ffa3e897daad3f126025c1a387ce13727`
Status: provider-backed candidate validated; pending protected publication

## Production incident

Natural `nfl_forward_evidence` cycles at 16:21, 16:36, 16:51 and 17:06 EDT all
retained the last-known-good player-props snapshot because the collector received 612-613 unique
provider player identities and opened the existing 512-player aggregate circuit breaker. The
independent 64-player per-game guard did not open. The NFL Daily Edge writer continued normally,
but the player-props writer could not publish, settle, update closing prices, or populate the new
private full-board archive.

## Candidate boundary

- Provider observation release:
  `nfl_player_props_provider_observation_2026_10_12_r11_regular_season_identity_capacity`
- Sole writer release:
  `nfl_player_props_writer_2026_10_12_r49_regular_season_identity_capacity`
- Aggregate unique-player ceiling: 512 to 768.
- Deterministic player-identity batch size: 100, unchanged.
- Per-game player ceiling: 64, unchanged.
- Maximum games: 18, Sharp pages: 8, collection concurrency and provider endpoints: unchanged.
- Declared maximum collection requests: 51 to 53; total incremental cycle maximum: 101 to 103.

The 768 ceiling is a bounded full-slate capacity envelope, not a relaxed identity-integrity rule.
It admits the observed 613-player regular-season catalog with 155 identities of headroom, remains
below the theoretical 18-game by 64-player contamination boundary, and preserves the independent
per-game guard that catches one malformed fixture before aggregate volume can legitimize it.

No model, calibration, residual distribution, projection, probability, forecast side, grade,
threshold, stake, market-reading rule, cadence, provider source, lock, settlement, public copy,
layout or official tracking semantic changes. Existing locked rows and the newly written private
research archive remain immutable.

## Required evidence

1. Unit coverage accepts 613 distinct identities, rejects 769, and still rejects 65 identities in
   one game.
2. The production contract proves the exact 53-request collection and 103-request total ceilings,
   r49 writer and r11 provider releases.
3. A provider-backed no-write current-week replay completes within those budgets and reports its
   exact games, identities, observations, decisions, grades, promotions, demotions and board-count
   impact against the last coherent member snapshot.
4. The focused NFL props contracts, private-tracking contract, TypeScript, ESLint and
   `npm run verify:model-change` pass.
5. The candidate is integrated from latest `main`, published only by protected pull request, and a
   natural production cycle proves the r49 writer, one shared `prediction_pipeline:nfl` lease,
   healthy board publication, unchanged stored locks and a private archive row.

## Candidate replay result

The 17:30 EDT provider-backed, no-write Week 5 replay completed on the same 613-identity catalog
that production rejected at 17:21. It consumed 46 total bounded calls against the declared
103-call ceiling and produced 41,934 observations, 1,704 exact offers, 1,926 feature rows, 437
score-eligible features, and 253 member rows. The resulting board contained 3 Best Angles, 5
Leans, 60 Watchlists, 318 evaluated No Plays, 81 operational Holds, and 8 actionables.

Against the exact prior member snapshot, 152 rows still offered by providers matched, 101 rows
were newly offered, and 1,345 old unlocked rows no longer served after their games passed were
removed through the existing lifecycle. There were zero matched-row forecast-side changes, zero
promotions, and zero demotions; four matched rows remained actionable. The candidate preserves
124 already-locked rows and exposes two official tracking rows without rewriting either. The
separate preceding-Receptions comparison remains the already-released model audit—not an effect
of this capacity repair—and also records zero actionable promotions or demotions on this replay.

The only replay findings were existing explicit coverage telemetry: unknown provider markets,
the documented lack of a Playbook player-prop price endpoint, and SharpAPI pagination reaching its
separate eight-page ceiling. None was introduced or relaxed by this repair.

## Rollback

Rollback future unlocked collection to the r10 provider / r48 writer / 512-player / 51-request
family. Never delete or rewrite any locked member record, official tracking row, market-observer
artifact, or private full-board archive created by r49.
