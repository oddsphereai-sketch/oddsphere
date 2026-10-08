# NFL game-designation injury continuity

Date: 2026-10-08  
Owner direction: restore verified injury reports for tonight and future NFL games, preserve silent fallbacks and last-known-good continuity, change no member copy/labels/layout, and verify the live reader after release.

## Scope and authority

- Sport / surfaces: NFL Daily Edge evidence and the shared NFL Player Props inference context.
- Sole authoritative writer: the existing leased `nflForwardEvidenceWriter` under `prediction_pipeline:nfl`.
- Preceding writer / inference context: `nfl_forward_evidence_writer_2026_10_07_r55_injury_continuity` / `nfl_player_props_inference_context_2026_09_29_r7_injury_feed_continuity`.
- Candidate writer / inference context: `nfl_forward_evidence_writer_2026_10_08_r56_game_designation_continuity` / `nfl_player_props_inference_context_2026_10_08_r8_game_designation_continuity`.
- The evidence schema, independent score model, probability/calibration/decision/grade releases, target exclusion, stake, cadence, lock, settlement, tracking denominator, member fixture/snapshot, copy, labels, and layout do not change.

## Confirmed failure

The production collector queried the legacy league-wide `player_injuries` endpoint with one eight-page ceiling. The current Week 5 slate contains 918 legacy rows across ten pages. Page eight therefore caused the collector to reject the entire otherwise valid response, making every current game appear injury-unavailable. Exact-game last-known-good retention could not help a game that had never received a successful current-week payload.

The paid BALLDONTLIE `player_designations` endpoint is the correct primary source. It is scoped by season, week, season phase, team, and provider game ID and supplies practice participation, injury/reason, game status, active/participation state, and provider update time. A direct exact-game read for TB-DAL returned 154 designation rows over two pages; the strict member normalization retained ten currently listed players and excluded full-practice/no-current-designation roster rows.

## Repair contract

1. Query `player_designations` first with the exact season, week, regular/post/preseason phase and slate team IDs.
2. Partition team IDs into bounded eight-team batches, process at most eight 100-row pages per batch, and require both exact teams for every exact provider game before accepting the primary response.
3. Retain only a current game status, inactive/did-not-play status, reported injury/reason, or the latest non-full practice status. Full-practice rows with no current injury or game status remain absent from the member report.
4. Preserve the provider's exact `updated_at`, team identity, player identity and position. Never attach a row from another game, week, season phase or team.
5. If the designation endpoint fails, is malformed, exceeds its bounded pagination, or omits an exact game/team, silently fall back to the legacy `player_injuries` feed. The legacy fallback now uses the same bounded team batching, so a ten-page league total can no longer erase the slate.
6. Merge the result with the newest verified exact-game prior payload. A failed, empty, or partial later response cannot clear a previously verified team unit or relabel it as fresh.
7. Existing valid T-60 locks remain immutable. Newly verified availability may affect only future unlocked computation through the already released injury/role paths.

## Load and failure bounds

- Full current slate: 15 games, 30 teams.
- Direct candidate proof: 15 exact reports and 267 currently listed players.
- Actual primary requests in the full-slate proof: 26.
- Hard maximum: 64 requests (four batches × eight primary pages plus four batches × eight legacy pages only if the primary fails).
- Requests are slate-level and cached/writer-owned, never per card or per member. Four bounded batch chains run concurrently, below the paid provider's documented 600-request/minute ceiling.
- Any incomplete collection preserves the preceding coherent published snapshot.

## Same-input product impact

This release adds no prediction equation, market-reading rule, grade threshold, or promotion/demotion rule. Daily Edge's authoritative score/probability/decision path does not consume this repaired designation collector; the separate existing injury-aware research/shadow context does. Therefore the same-input public Daily Edge side, score, probability, quote, grade, stake and actionable counts have zero forced changes: zero promotions and zero demotions.

NFL Player Props continues to apply the existing game-scoped out/inactive hold and role-allocation behavior. The repair supplies the verified input that behavior was already designed to consume; it does not create a new threshold or action sleeve. Existing locked props remain immutable, and ordinary unlocked rows recompute under their existing releases rather than being relabeled.

The read-only current production-path run at simulated `2026-10-08T21:14:09.425Z` completed all 15 games / 45 Daily Edge markets with 14 Best Angles / 6 Leans / 11 Watchlists / 14 No Plays and zero Held games. It performed zero writes. The counts are evidence outcomes, not quotas.

## Required verification and live acceptance

- Focused designation pagination/fallback/exact-game tests.
- NFL forward writer and injury-aware shadow tests.
- NFL Player Props inference-context tests.
- TypeScript, `npm run verify:model-change`, affected production suites, latest-main integration safety and protected PR checks.
- After merge, run the ordinary leased NFL writer, then prove the live TB-DAL evidence has `coverage.injuries=true`, no `injury_report_unavailable` hold for that game, current provider timestamps, a rendered report, unchanged copy/layout, one writer/lease, coherent 45-market board, and unchanged existing locks.

Rollback is the r55 writer / r7 inference context while retaining all already-written immutable evidence. Roll back on exact-game/team leakage, pagination-budget breach, mixed release authority, board loss, lock rewrite, writer overlap, reader failure, or an unexpected actionable collapse.
