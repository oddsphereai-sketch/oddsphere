# NFL preseason publication candidate r14

Date: 2026-08-20  
Scope: genuine 2026 NFL Preseason Week 2 public-product rehearsal  
Official tracking, stakes, settlement, and lifetime-result writes: disabled

## Outcome

The NFL Daily Edge now has a production-shaped, fail-closed publication path without turning preseason into official performance. The current package is the real 16-game Preseason Week 2 slate, contains all 48 moneyline/total/spread predictions, and uses the existing signed-in Daily Edge reader rather than a separate product. The package was refreshed before the first kickoff, passed the production build and mandatory model-change suite, and was written to the existing `lab_response_snapshots` substrate under `nfl::current-week` with a successful checksum/release readback.

The web release remains independently gated by `NFL_DAILY_EDGE_ENABLED=true`. Snapshot writes require `NFL_DAILY_EDGE_PUBLICATION_ENABLED=true`, the r1 publication release, a healthy evidence audit, and ownership of the shared `prediction_pipeline:nfl` lease.

## Releases and immutable package

- Publication: `nfl_daily_edge_preseason_publication_2026_08_20_r1`
- Member snapshot: `nfl_daily_edge_local_member_snapshot_2026_08_20_r3`
- Decision: `nfl_regular_pipeline_preseason_dry_run_decision_2026_08_20_r3`
- Model: `nfl_pregame_real_local_current_refit_2026_08_19_r3`
- File: `nfl_daily_edge_2026_preseason_week_2_f5c290ebcac4f462.json`
- SHA-256: `f5c290ebcac4f4628f347ecfb97094a066c7ccba13298717ac66d6d71247629e`
- Provider observation: `2026-08-20T22:48:23.153Z`
- Published snapshot key: `nfl::current-week`

## Launch health

- Schedule: 16/16 real BALLDONTLIE games
- Predictions: 48/48, exactly three per game
- Current prices: 48/48
- Injury/depth availability: 16/16 games
- Operational Opening-to-current trails: 16/16 games, all three markets
- Minimum same-book observations: four per market
- QB1 historical-state matches: 32/32
- Public splits: unavailable for this preseason slate; visible as unavailable and not fabricated
- Member request provider cost: zero
- Publication lease: `prediction_pipeline:nfl`, acquired on the first attempt
- Readback: exact publication release, source SHA-256, and publication timestamp matched

## Board-count impact

The refreshed package has five Leans, eight Watchlists, 35 No Plays, zero Cautions, and zero Best Angles. Relative to the earlier package, one Watchlist moved to No Play; there were zero actionable demotions. The five Leans are HOU moneyline +106, JAX +1.5 -105, BUF +2.5 +102, LAR +2.5 -115, and CHI/CIN Over 36.5 -110. These labels are preseason rehearsal outputs only.

## Hard boundaries

- `trackingEligible` is false in the stored contract.
- The exact preseason exclusion reason is required by the publication audit.
- No prediction record, official grade, stake, settlement, or lifetime row is written by publication.
- The existing NFL lifetime baseline is unchanged.
- Official NFL tracking remains future-dated to 2026-09-10 and requires regular-season launch approval plus an actual pre-kickoff lock.
- Once a displayed game reaches kickoff, future weekly publications preserve its prior game snapshot; later provider refreshes cannot rewrite that prediction.
- Missing prices, injuries, Opening trails, checksum, current release, or freshness fail publication closed.

## Verification

- `npm run readiness:football-nfl-launch`
- `npm run test:football-production-publication`
- `npm run test:football-daily-edge-member`
- `npx tsc --noEmit --pretty false`
- `npm run build`
- `npm run verify:model-change`

The production build compiled all 101 static pages and the dynamic NFL health route. The full model-change suite passed, including 342 prediction-record checks, NFL publication safety, tracking lifecycle, official market registry, and player-prop leakage contracts.

## Remaining production operation

The snapshot is in the production data store, but member visibility still requires deployment of the exact reviewed commit and the server-only `NFL_DAILY_EDGE_ENABLED=true` environment gate. The preseason data/model refresh remains an operator-run pipeline because the fitted Python/joblib scorer is intentionally not bundled into the Next.js request runtime. A separate automated regular-season writer, lock capture, settlement, and forward CLV/calibration program must be completed before Week 1 becomes official.

## Rollback

Set `NFL_DAILY_EDGE_ENABLED=false`. This removes the production reader without touching any prediction record or historical result; the isolated `nfl::current-week` snapshot can safely expire.
