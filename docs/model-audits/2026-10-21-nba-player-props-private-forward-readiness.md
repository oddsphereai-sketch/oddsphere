# NBA player props private forward-readiness release — 2026-10-21

## Decision

Close every engineering and lifecycle gap that can be closed before elapsed
forward outcomes exist, while keeping NBA player props disabled for members.
This release does not authorize a public route, navigation pill, public tracking
row, stake, or member-request provider fetch.

## Release family

- Frozen model artifact:
  `nba_player_props_frozen_runtime_artifact_2026_10_21_r1_private_forward`
- Forward decision:
  `nba_player_props_forward_decision_2026_10_21_r1_private_disabled`
- Product/snapshot:
  `nba_player_props_product_candidate_2026_10_21_r4_private_forward_ready` /
  `nba_player_props_member_snapshot_candidate_2026_10_21_r4_private_forward_ready_disabled`
- Lifecycle:
  `nba_player_props_lifecycle_candidate_2026_10_21_r3_prelock_observation_only`
- Writer/store/state/tracking/settlement:
  `nba_player_props_private_writer_2026_10_21_r4_bounded_market_chronology`,
  `nba_player_props_private_store_2026_10_21_r4_bounded_quote_chronology`,
  `nba_player_props_current_state_2026_10_21_r2_regular_and_ist`,
  `nba_player_props_private_tracking_store_2026_10_21_r1_immutable`, and
  `nba_player_props_private_settlement_2026_10_21_r1_official_box_revisions`.

## Runtime behavior

- The model never refits in production. A checked-in 236 KB artifact contains
  the frozen fitted models, residual distributions, reliability calibration,
  selected market arbitration, and play-grade policies. Its SHA-256 is checked
  before scoring.
- Each of the eight foundation markets retains its own qualified independent
  model and market-read behavior. FanDuel-confirmed candidates require another
  book to agree. Every evaluated sportsbook is excluded from its own fair-price
  evidence. A qualified disagreement may flip the projection across the listed
  line; the displayed side and projection cannot contradict each other.
- The primary live catalog is BALLDONTLIE. The Odds API is requested only for a
  game whose primary feed has no multi-book complete prop scope. There is no
  provider fetch from a member request.
- Real opening and later observations write to a checksummed, compressed market
  history. Each exact quote scope retains the first, prior, and current distinct
  price state. An unchanged poll refreshes current evidence without growing the
  payload forever; a true price change remains chronological movement. An
  identity collision preserves the earlier observation and reports a conflict.
  The deployed r3 envelope is accepted and migrated rather than discarded.
- Player-level finalized boxes and advanced rows are stored separately from the
  team aggregates used by NBA Daily Edge. Regular-season and NBA Cup rows are
  covered. A bounded one-time prior-season bootstrap is followed by seven-date
  incremental collection; re-observed official stat corrections update source
  state and append a new settlement revision without changing a locked pick.
- Exact ESPN game reports exclude explicitly Out players. A missing or partial
  report is unknown and is never interpreted as healthy.
- The candidate runs only inside the existing `prediction_pipeline:nba` lease
  owned by `/api/cron/nba-daily-refresh`. It has no second cron or writer.
- A populated slate with an empty candidate, less than 80% player-feature
  coverage, a corrupt artifact, or a provider failure cannot overwrite the
  previous last-known-good private snapshot.
- Decisions freeze one hour before start from the last genuinely observed
  pre-cutoff snapshot; a missed pre-lock capture is never invented or backdated.
  Existing locked payloads win byte for byte over recomputation. Internal tracking is append-only. Official full-game
  box scores settle wins/losses/pushes, zero-minute or absent players void, and
  official stat corrections append a new settlement revision without changing
  the locked prediction.
- The first production-private cycle verified 29,789 checksum-decoded market
  observations across all 11 scheduled games. Schedule-to-provider coverage
  canonicalizes ESPN's `GS`, `NO`, `UTAH`, and `WSH` abbreviations to the
  provider's `GSW`, `NOP`, `UTA`, and `WAS` identities before deciding whether
  a scheduled game is missing; genuine missing games still preserve the prior
  private snapshot.

## Historical evidence and board impact

The release freezes the already documented release-pure candidate. Its 133
historical actionables were 84-49 (+20.44 units). Market results were: Points
34-24, Rebounds 5-1, Assists 14-7, Threes 4-3, PRA 16-7, Points+Rebounds 3-1,
Points+Assists 4-3, and Rebounds+Assists 4-3. This is not presented as future
performance. Threes and the slate-relative fallback markets still require
forward proof because their product policies were opened during fallback
development.

Public promotions: 0. Public demotions: 0. Public board rows: 0. The member gate
remains false. Private actionability is intentionally retained so forward
validation measures the designed product instead of a flattened shadow.

## Remaining gate

The only model-quality gate that requires elapsed time is release-pure forward
settlement, especially for Threes and the slate-relative fallback markets. A
separate owner-approved release is required before any member exposure.

The real 2025 bootstrap completed and wrote private state: 1,230 games,
43,268 box rows, 32,202 advanced rows, 603 player identities, and 783 provider
requests. The current 2026 incremental state also exists privately. The private
writer flag is enabled only in production; public product gates remain false.

## Verification

- `npx tsc --noEmit --pretty false --incremental false`
- `npx tsx scripts/test-nba-player-props-production-readiness.ts`
- `npx tsx scripts/test-nba-player-props-foundation.ts`
- `npx tsx scripts/test-nba-player-props-product-preview.ts`
- `npx tsx scripts/test-nba-player-props-lifecycle.ts`
- `npx tsx scripts/operator/nba/audit-nba-player-props-frozen-runtime-parity.ts --input <complete-private-confirmation-payload>`
  (`2,657` expected decisions, `2,657` runtime decisions, `0` mismatches)
- `npm run verify:model-change`
- production build and integration-safety checks

## Rollback

Leave `NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED` unset or false. This stops future
private candidate writes without deleting the immutable market, lock, tracking,
or settlement evidence already captured. Public NBA props remain disabled in
either state.
