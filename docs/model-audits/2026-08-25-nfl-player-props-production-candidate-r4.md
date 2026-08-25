# NFL player props production candidate r4

Date: 2026-08-25
Status: production-qualified, unpublished, owner-design approval hold

## Scope and immutable releases

This candidate changes only NFL player-props probability/grade policy, portable runtime,
private member reader, and the already integrated props branch of the single NFL writer. It does
not alter NFL Daily Edge probabilities or grades, add a cron, publish a member snapshot, enable a
feature flag, or write production data.

- Model/calibration: `nfl_player_props_distribution_model_2026_08_25_r2_shared_context` / `nfl_player_props_distribution_calibration_2026_08_25_r2_shared_context`
- Runtime/decision: `nfl_player_props_runtime_2026_08_25_r2_shared_context` / `nfl_player_props_decision_2026_08_25_r2_exact_price_shared_context`
- Lane evidence: `nfl_player_props_actionable_lane_evidence_2026_08_25_r3_production_release`
- Snapshot/writer: `nfl_player_props_member_2026_08_25_r4_shared_context_load_bound` / `nfl_player_props_writer_2026_08_25_r5_bounded_settlement`
- Tracking/settlement: `nfl_player_props_tracking_2026_08_25_r4_regular_t60_shared_context` / `nfl_player_props_settlement_2026_08_25_r3_bounded_finality`
- Single writer/lease: `app/api/cron/nfl-forward-evidence/route.ts` / `prediction_pipeline:nfl`
- Lock/tracking: official T-60, immutable exact price/probability/release tuple

## Why the private board collapsed and what changed

The original provisional board graded a provider row against its own no-vig probability, retained
multiple prices for the same outcome, and treated stale/incomplete/single-book data as Held. Its
one Best Angle therefore did not represent the best executable target price against a separate
same-line market benchmark. The portable runtime correctly switched to best executable price and
target-excluded consensus, which left 0 Best Angles / 0 Leans and mislabeled 337 rows Held.

r4 keeps the stricter market-reading semantics. It excludes incomplete and stale quotes before
benchmark construction; requires at least one other same-line book; and deduplicates to the best
executable outcome price. A missing independent benchmark is explicitly unavailable. Only genuine
role/player-identity ambiguity can become Held. On the exact current input, 335 outcomes are now
unavailable, not recommendations, and only two De'Zhaun Stribling reception sides remain Held for
historical identity mismatch.

## Chronological exact-price gates

Models train through 2024. The price evaluation uses 2025 exact opening offers with selection
through October 31 and confirmation beginning November 1. The target book is excluded from the
same-line market probability, and return is scored at that target book's exact American price.
Candidate rows are clustered by game for uncertainty; release gates require positive selection and
confirmation ROI, at least 30 Best Angle or 50 Lean bets in each period, largest-win independence,
calibration gap at most 0.05, exact prices, and coherent runtime role evidence. No count quota exists.

| Market lane | Selection | Confirmation | Confirmation calibration | Release |
|---|---:|---:|---:|---|
| Receiving yards Under, Best Angle | 103 bets / 45 games, +16.18% ROI | 67 / 43, +10.79% | Brier 0.25004, log loss 0.69324, gap 0.04121 | Best Angle + Watchlist |
| Receptions Under, Best Angle | 119 / 66, +16.93% | 113 / 76, +20.40% | Brier 0.24028, log loss 0.67343, gap 0.04659 | Best Angle + Watchlist |
| Rushing attempts, Lean | 218 / 95, +10.60% | 182 / 107, +6.95% | Brier 0.24812, log loss 0.68930, gap 0.04430 | Lean + Watchlist |

The receiving/reception exclusive lower bands were nonpositive in confirmation, so they cannot
be Leans. Passing attempts/completions/yards and rushing yards failed market-specific calibration
or two-period value evidence and remain No Play. Anytime TD is separate rare-event price value:
its confirmation Watchlist was 466 bets, +23.03 units, +4.94% ROI, but stronger bands lost; TD is
Watchlist-only and never actionable from raw hit rate.

Uncertainty remains material. Receiving-yards confirmation game-cluster bootstrap ROI is
[-17.75%, +38.33%], receptions is [+0.52%, +40.85%], and rushing attempts is
[-7.54%, +20.91%]. The gates intentionally do not demand impossible certainty, but the product
must retain explicit forward-monitoring risk in the release audit. The production scorer, board,
member snapshot, and tracking rows emit only the production release tuple above; historical
`*_shadow_*` identifiers survive solely as checksum-pinned source provenance. Exact 2025 CLV cannot be reconstructed
because paired target-book closes are absent. The forward T-60 contract captures same-book closes
and evaluates CLV by decision release and locked timestamp.

## Current 2026 Week 1 board and impact

Input captured at 2026-08-25T12:22:00Z: 16 games, 4,017 observations, 2,148 normalized offers,
352 complete grade-eligible offers, 250 feature rows, and 231 score-eligible feature rows.

- Board: **1 Best Angle / 0 Leans / 10 Watchlists / 21 No Plays / 2 Held**; 34 audit decisions,
  32 normal member rows, one actionable promotion, zero actionable demotions.
- Unavailable: 335 outcomes without a separate exact-line benchmark, 264 incomplete raw offers,
  zero stale outcomes, and zero missing feature-context outcomes.
- Best Angle: Christian McCaffrey receiving yards Under 36.5, NoVig +117; projection 29.7528,
  participation 92.08%, independent-market probability 50.00%, calibrated probability 53.75%,
  edge +3.75pp, expected value +16.63%.

The previous private runtime was 0 / 0 / 8 / 24 / 337. r4 therefore adds one genuine action,
adds two net Watchlists, removes three No Plays, and reclassifies 335 market-availability rows out
of Held. It does not manufacture a Lean when the current board has no rushing-attempt offers.

## Operations and safety

The member reader makes zero provider calls and reads one stored complete snapshot. Recurring
production collection requests only the current player-prop slate and player identities; it does
not refetch grade-irrelevant opening props. Production inference reuses checksum-verified roster,
injury, and all-book main-market bundles already stored by the authoritative NFL writer, so its
incremental context request budget is zero. The direct-provider context collector remains available
only for local research. Playbook remains context-only because it has no documented NFL player-prop
price endpoint. Provider failure retains the last coherent props snapshot and cannot suppress NFL
Daily Edge.

The checksum-backed adapter parity replay matched all 250 feature rows and every board decision
exactly: **1 / 0 / 10 / 21 / 2** before and after the adapter change. It reduced the current context
provider budget from 41 calls to zero, with no promotion, demotion, probability, projection, or grade
change. The recurring writer also omits 16 grade-irrelevant Week 1 opening-prop requests.

The props writer runs sequentially inside the existing NFL forward-evidence cron under the same
lease. Unlocked role/line/price changes recompute; the authorized pre-lock tuple freezes at T-60;
only locked Best Angle/Lean rows enter idempotent tracking. Same-book closes populate CLV when
observed. The production collection circuit breakers allow at most 30 props-owned provider calls:
one schedule, 18 current game-prop calls, three player-identity pages, and eight Sharp pages. The
current 16-game Week 1 plan is 25 calls; inference context remains zero. Settlement covers attempts,
completions, yards, receptions, pushes, and combined rushing/receiving/return/fumble touchdowns from
final exact-game/player stats. It reads at most 1,000 eligible rows and processes the oldest 18 games
per cycle, reporting any deferred games. It does not call the stats provider until at least five
hours after the record's T-60 lock and still requires final game status. The total props-owned
incremental provider ceiling is 48 calls in a settlement cycle. Publication and tracking
remain disabled until owner approval and the final clean-main integration checks pass.

## Publication-delta audit and launch coverage

The final publication audit rebases this candidate onto protected main
`1d687335bc61cafe008eaec94eb6fee0e1af9cce`, which contains the CFB launch and its bounded
team-scoped quarterback hotfix. The only overlapping file was this repository's release registry;
both the active CFB section and this NFL props section are preserved. No CFB route, reader, lease,
tracking, model, or migration file is modified by the props delta.

Migration `schema-migration-v39-nfl-player-props-tracking.sql` is additive and service-role-only.
Protected main already contains the independent CFB v40 migration; the numbering does not create a
schema dependency. V39 must be applied and verified before either props flag is enabled. It creates
the idempotent `(tracking_key, decision_release)` ledger, enables RLS, denies member/anonymous
access, and grants only the service role the required table/sequence permissions. This private
candidate does not execute the migration.

| Launch requirement | Authoritative coverage |
|---|---|
| Timestamped provider normalization, exact game/player identity, bounded pagination | `scripts/test-football-player-props-foundation.ts` |
| Exact line/side prices, no-vig pairing, material changes, latest authorized T-60 observation | `scripts/test-nfl-player-props-market-board.ts` |
| Checksum-backed as-of roster/injury/main-market reuse with zero duplicated context calls | `scripts/test-nfl-player-props-inference-context.ts` and `scripts/operator/compare-nfl-player-props-shared-context.ts` |
| Portable TypeScript/Python scorer parity, exact-price EV, independent-book benchmark, Held semantics, production release IDs | `scripts/test-nfl-player-props-runtime.ts` |
| Market-specific chronology, calibration, TD rare-event opportunity inputs, promotions/demotions | `scripts/test_nfl_player_props_baseline.py`, `scripts/test_nfl_player_props_recalibration.py`, and `scripts/test_nfl_player_props_market_decision.py` |
| One cron/lease, exact-string flags, MLB/NFL pill routing, migration security, T-60 immutability, idempotent actionable tracking, CLV | `scripts/test-nfl-player-props-production-contract.ts` |
| Five-hour finality, exact-game final status, pushes/TD settlement, 1,000-row/18-game cycle bounds | `scripts/test-nfl-player-props-settlement.ts` |
| Historical leakage/release contract | `scripts/test-nfl-player-props-history-contract.ts` |
| Cross-model safety and route/build integration | `npm run verify:model-change`, `npx tsc --noEmit`, `npm run build -- --webpack`, and `node scripts/verify-integration-safety.mjs --base-ref=origin/main` |

The production member page reads one stored snapshot and makes zero provider calls. The main Player
Props navigation continues to enter MLB; the MLB page shows the NFL league pill only when
`NFL_PLAYER_PROPS_MEMBER_ENABLED` is exactly `true`. `/player-props?league=nfl` otherwise redirects
to MLB. The production writer runs only when `NFL_PLAYER_PROPS_ENABLED` is exactly `true`, once and
sequentially inside the existing `/api/cron/nfl-forward-evidence` route under
`prediction_pipeline:nfl`. No separate props cron, lease, refresh timer, or per-user fetch exists.

## Rollback and publication hold

Both `NFL_PLAYER_PROPS_ENABLED` and `NFL_PLAYER_PROPS_MEMBER_ENABLED` must remain disabled. The
private review route is `/dev/nfl-props-preview`. The preserved pre-actionable checkpoint is
`f57188f3a9c9c20f23fa17e9429d491f2e96c3e2`. No PR, push, merge, deployment, feature-flag change,
or production write is authorized before the owner approves the MLB-style board and reader.
