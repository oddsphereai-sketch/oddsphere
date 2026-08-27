# CFB strict SharpAPI named-book price fallback (r7)

Date: 2026-08-26

Status: production release candidate; production provider, cron, writer, and database state were not mutated during diagnosis or replay.

## Root cause and frozen correction

The latest production CFB wave contained eight games and 24 markets. Twenty-one exact-price decisions were coherent; all three SJSU-USC markets were Held because BALLDONTLIE returned no current or opening odds for provider game `457612`. The schedule identity itself was correct and unique: San José State (`101`) at USC (`63`), 2026-08-29 19:00 UTC. Playbook independently matched that exact game and supplied SJSU +38.5, USC -38.5, Total 60.5, all three split sets, and projected quarterbacks Luke Weaver and Jayden Maiava.

Bounded read-only provider verification proved that the public market was not absent. SharpAPI exact event `ncaaf_sanjosestatespartans_usctrojans_2026-08-29_b2` returned 143 rows, including current main-line two-sided Spread and Total quotes from named books. BetMGM supplied USC -38.5 -110 / SJSU +38.5 -110 and Over/Under 60.5 -110. Onexbet and theScore Bet supplied same-line Spread consensus; Bally Bet, BetOnline, Goldrush, Onexbet, and Pinnacle supplied same-line Total consensus. No coherent two-sided target-book Moneyline was present. The failure was therefore missing strict exact-bucket SharpAPI price ingestion in the CFB writer—not event aliasing, a duplicate game, an extreme-Moneyline sibling-market drop, stale cadence, or absence of Spread/Total markets.

The correction was frozen to these boundaries:

1. Keep BALLDONTLIE authoritative for the schedule and primary named-book price feed. For only planned games lacking a complete three-book same-line tuple, the existing sole CFB writer performs bounded exact-event SharpAPI reads; it never scans an unbounded league feed.
2. Require exact start time within 15 minutes, exact home/away identity, non-live active main-line rows, and reject alternates, props, stale prices, incomplete two-sided pairs, inverted spreads, unsupported books, pagination overflow, and request-budget overflow before the single append.
3. Only supported US target books may become the evaluated display quote. Other trusted named books may contribute to target-excluded same-line consensus but cannot become the displayed offer.
4. Evaluate markets independently. Missing extreme Moneyline may hold Moneyline only; it cannot suppress a coherent Spread or Total. Existing T-60, official tracking, model, calibration, grade policy, and stake rules remain unchanged.

The BALLDONTLIE normalizer also now accepts the documented `opened_at` timestamp for opening rows, falling back from `updated_at`; a regression proves this field contract.

## Shared Daily Edge / MLB parity

MLB remains the mature reference for shared Daily Edge behavior. This candidate does not modify the common Daily Edge route, DTO types, reader shell, sport-switch navigation, modal behavior, or presentation components. CFB continues to adapt its sport-specific immutable evidence into the shared `DailyEdgeGameDto` / `MarketEdgeDto` contract.

Parity regressions establish:

- per-market completeness: a missing Moneyline cannot suppress coherent Spread/Total siblings;
- forecast-versus-grade separation: an internally unavailable market always retains its independent outcome confidence and score context, while the public Bet grade is No Play and the evaluated sportsbook side/price, market-fair probability, EV, and actionability are absent;
- movement: first/material-change/current stops are chronological, exact-book, and never mixed across books;
- release freshness: a complete prior wave remains authoritative until one complete current-release wave is atomically available;
- split freshness: each market uses the timestamp from its own latest immutable row and the declared CFB writer cadence;
- locking/tracking: the existing T-60 boundary, maximum lag, official tracking record shape, and one-writer lease are unchanged;
- sport switching and responsive reader behavior remain covered by the shared Daily Edge experience suite rather than a CFB fork.

Explicit CFB-specific differences are data/league semantics, not separate UI rules: the weekly Thursday-through-Monday slate window; football Spread carried through the shared legacy third-market DTO slot and labeled Spread by the existing football reader; unavailable timestamped injury/weather and SharpAPI betting-split feeds labeled as unavailable; and the strict SharpAPI named-book fallback used only for current prices. None changes the common visual hierarchy or interaction model.

## Current exact-price replay

A one-request read-only replay against the real exact SharpAPI event reconstructed seven trusted named books. The qualified r3 PMF remained unchanged: SJSU 16.08 expected points, USC 39.42, USC margin +23.33, total 55.50, USC win probability 92.06%.

- Moneyline: internal exact-price exception / public No Play; no complete two-sided eligible target quote and target-excluded exact consensus. The independent USC winner probability and score forecast remain visible.
- Spread: BetMGM USC -38.5 -110, 51.50% calibrated model probability versus 49.46% target-excluded fair probability, +2.04 percentage-point edge, -1.68% EV, **No Play**.
- Total: BetMGM Under 60.5 -110, 57.20% calibrated model probability versus 49.64% target-excluded fair probability, +7.56 percentage-point edge, +9.21% EV, **Best Angle**.

Paired board impact from the latest checksum-valid eight-game production wave:

- before: 1 Best Angle / 2 Lean / 11 Watchlist / 7 No Play / 3 Held;
- candidate writer evidence: 2 Best Angles / 2 Leans / 11 Watchlists / 8 evaluated No Plays / 1 internal unavailable market;
- candidate member presentation: 2 Best Angles / 2 Leans / 11 Watchlists / 9 No Plays / 0 Held;
- promotions from Held: SJSU-USC Total to Best Angle and Spread to No Play;
- demotions or changes to any previously evaluated market: zero.

This is price-availability correction, not a new forecast or looser grading rule. The Total Best Angle uses the already-qualified Total policy at the real exact offer; no quota or manual override is involved.

## Release boundaries and operational safety

- BALLDONTLIE slate normalizer: `balldontlie_ncaaf_slate_2026_08_26_r2_opened_at`
- SharpAPI price fallback: `cfb_sharpapi_named_book_fallback_2026_08_26_r1`
- score/model/distribution/probability/grade policy: unchanged
- decision schema / decision: `cfb_v1_exact_price_decision_tuple_2026_08_26_r2_provider_source` / `cfb_v1_daily_edge_decision_2026_08_26_r7_sharpapi_price_fallback`
- evidence schema / collector / member: `cfb_forward_evidence_snapshot_2026_08_26_r2_price_provenance` / `cfb_forward_evidence_collector_2026_08_26_r5_sharpapi_price_fallback` / `cfb_v1_member_release_2026_08_26_r4_price_provenance`
- writer / fixture: `cfb_forward_evidence_writer_2026_08_26_r5_sharpapi_price_fallback` / `cfb_v1_member_fixture_2026_08_26_r5_price_provenance`
- official tracking: unchanged, `cfb_official_tracking_record_2026_08_25_r1_t60`

The exact-event fallback is capped at 96 planned games and 96 HTTP requests per run, tries the empirically verified `b2` bucket first, and fails closed before the sole append if identity, pagination, or request limits fail. The sole route still owns one `prediction_pipeline:cfb` lease. Unlocked evidence is never officially tracked; a game missing any one of the existing required three T-60 tuples retains the pre-existing tracking hold.

## Rollback

Rollback restores decision r5, evidence r1, collector r3, member r2, writer r3, fixture r3, and BALLDONTLIE slate r1. Immutable evidence and tracking rows are never rewritten or deleted. The independent CFB score model and calibrated probability heads do not change in either direction.
