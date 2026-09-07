# NFL player-props Week 1 identity-capacity correction r2 — 2026-09-07

## Predeclared scope

This candidate is limited to the NFL player-props provider observation and its
single production writer inside `nfl-forward-evidence`. The authoritative write
path remains `runNflPlayerPropsProductionWriter`, sequenced after NFL Daily Edge
under the existing `prediction_pipeline:nfl` lease.

Current production identifiers and limits:

- provider observation:
  `nfl_player_props_provider_observation_2026_09_03_r7_week_one_identity_capacity`
- writer: `nfl_player_props_writer_2026_09_03_r19_forecast_authority`
- aggregate player-identity limit: 400
- per-game player-identity limit: 64
- deterministic player-identity batch size: 100
- maximum collection calls: 49

Candidate identifiers and limits:

- provider observation:
  `nfl_player_props_provider_observation_2026_09_07_r8_week_one_identity_capacity`
- runtime: `nfl_player_props_runtime_2026_09_07_r11_out_of_support_hold`
- board: `nfl_player_props_board_2026_09_07_r14_out_of_support_hold`
- member: `nfl_player_props_member_2026_09_07_r17_out_of_support_hold`
- writer: `nfl_player_props_writer_2026_09_07_r20_identity_capacity`
- aggregate player-identity limit: 512
- per-game player-identity limit: 64, unchanged
- deterministic player-identity batch size: 100, unchanged
- maximum collection calls: 51

No model, calibration, residual, probability, projection, forecast-side,
grade-threshold, stake, lock, tracking, settlement, snapshot-storage,
member-reader, cron-schedule, or provider-pagination rule is in scope.

## Production incident evidence

Natural `nfl_forward_evidence` run 118039 began at
2026-09-07T16:21:09.743Z and completed partial at 16:21:34.962Z with
`NFL props player-identity circuit breaker opened at 475 players.` The NFL core
writer remained available and the props writer correctly retained its last
coherent snapshot. The independent 64-player-per-game guard did not open, so
the failure was the aggregate full-slate ceiling rather than a single-fixture
identity explosion.

The observed 475-player catalog fits the candidate 512 ceiling and requires
five 100-ID identity requests. The declared worst case permits six requests,
two more than the current four-request ceiling, while all 18 game calls,
openings, eight Sharp pages, concurrency, and per-game contamination guard stay
bounded.

## Pre-publication scope expansion

The first provider-backed, no-write replay reached the previously blocked
current catalog and exposed 14 DraftKings `receptions` over/under offers whose
lines were 12.5 through 27.5 catches. The provider's own raw response confirms
those exact market encodings. At those lines, the immutable receptions
residual distribution assigns an endpoint probability of exactly zero or one,
which is outside the existing coherent-posterior contract and caused the whole
board builder to throw.

This candidate will not add a line threshold and will not clamp those endpoint
probabilities into artificial confidence. Before the runtime edit, scope is
expanded to one data-integrity behavior: an exact offer whose independent
empirical probability is not strictly inside `(0, 1)` is unavailable for model
evaluation, counts in the existing unavailable model/feature-context
diagnostic, and cannot emit a prediction or grade. Every supported offer keeps
the identical model math and decision thresholds. Runtime, board, and member
identifiers are bumped because the writer now completes rather than failing on
this invalid provider input; model, calibration, and decision identifiers stay
unchanged because no decision is produced for the rejected row.

## Required candidate evidence

Before publication, the candidate must:

1. accept a 475-identity multi-game fixture and reject 513 identities;
2. continue rejecting 65 identities within one game;
3. retain deterministic deduplication and 100-ID batching;
4. prove the collection ceiling is exactly 51 and the combined writer plus
   settlement ceiling is exactly 69;
5. complete a current provider-backed, no-write Week 1 collection/board replay;
6. compare the candidate board with the last coherent production snapshot,
   reporting coverage, grades, promotions, demotions, sides, and locked-row
   preservation without treating ordinary price movement as model lift;
7. prove out-of-support offers cannot abort the board, cannot emit a grade, and
   are reflected in unavailable-input diagnostics;
8. pass focused NFL props tests, `npm run verify:model-change`, production
   build, and latest-main integration safety.

## Rollback and live acceptance

Rollback restores the r7 provider observation, r19 writer, 400 aggregate cap,
and 49-call ceiling for future cycles while preserving every locked record and
stored snapshot. Production acceptance requires the exact candidate tree on
protected main, a successful Vercel production deployment, a natural
`nfl_forward_evidence` cycle with no identity-capacity error, a released NFL
prediction lease, coherent current member coverage, and unchanged locked rows.

## Candidate replay result

The final provider-backed, no-write replay ran at
2026-09-07T16:57:29.110Z against the complete BALLDONTLIE Week 1 primary
catalog. Optional Sharp enrichment was omitted from this replay after two local
network failures; it remains independently bounded and is required to recover
normally in the natural production acceptance cycle.

- Schedule: 16 games.
- Normalized provider observations: 41,547.
- Unique player identities: 475; maximum within one game: 36.
- Primary-feed calls: 38, below the candidate 51-call collection ceiling.
- Exact offers entering the board: 17,043.
- Out-of-support outcomes omitted: 28 from the 14 verified offers.
- Candidate decisions: 2,250; 2,098 member rows.
- Candidate board: 7 Best Angles / 57 Leans / 251 Watchlists /
  1,783 No Plays / 152 Held; 64 actionables.
- Stored last-known-good board from 2026-09-06T15:06:09.330Z:
  4 / 37 / 174 / 1,380 / 114; 41 actionables.
- Shared exact rows: 1,397; new exact rows: 853; expired/replaced exact rows:
  312. Within shared exact rows, the time-separated replay contained 80 tier
  promotions and 33 demotions plus 11 forecast-side changes.
- Current production snapshot had zero locked rows; focused lifecycle tests
  separately prove prior locked tuples remain byte-identical.
- Candidate snapshot size: 9,642,740 JSON bytes and 507,756 gzip bytes, below
  the existing 12,000,000 / 1,000,000 limits.

The count differences are not attributed to the capacity or invalid-input
rules: the production snapshot was more than a day older, current offers and
prices had changed, and the replay intentionally lacked optional Sharp rows.
They are reported to prevent ordinary market/catalog movement from being
misrepresented as predictive lift. The policy delta itself creates no
promotion or demotion: it makes the current catalog reachable, and it emits no
decision for mathematically unsupported offers instead of aborting all valid
rows.
