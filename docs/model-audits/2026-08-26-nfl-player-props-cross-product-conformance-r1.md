# NFL Player Props cross-product conformance candidate r1

Date: 2026-08-26
Starting production base: `40ad046cab7f96d2368182d4591e51f8b37fec3d`
Scope: member presentation and evidence payload only; no model, calibration, projection, probability, grade, tracking, settlement, lock, lease, cron, or feature-input change.

## Immutable release boundary

- Model: `nfl_player_props_distribution_model_2026_08_25_r2_shared_context` (unchanged)
- Calibration: `nfl_player_props_distribution_calibration_2026_08_25_r2_shared_context` (unchanged)
- Decision: `nfl_player_props_decision_2026_08_25_r2_exact_price_shared_context` (unchanged)
- Runtime scorer: `nfl_player_props_runtime_2026_08_25_r2_shared_context` (unchanged)
- Board DTO: `nfl_player_props_board_2026_08_26_r3_conformance_evidence` (new payload contract)
- Member snapshot: `nfl_player_props_member_2026_08_26_r5_conformance_evidence` (new payload contract)
- Writer: `nfl_player_props_writer_2026_08_26_r6_conformance_evidence` (new payload contract)
- Tracking and settlement: unchanged.

The best-price decision continues to be selected exactly as before. The winning decision now retains the already-collected exact-price evidence for every same-player, same-market, same-line, same-side sportsbook observation. Each evidence item contains sportsbook, provider, current price/time, and same-book opening price/time when that opening genuinely exists. Opponent and scheduled game start come from the already-built inference feature row and exact offer. No additional provider request is introduced.

## Member conformance changes

- Coverage copy now says `Current graded board`, `Available NFL markets`, and the exact number of market families currently graded. It no longer says `All NFL props`, `All props`, or `Every market`.
- The member coverage disclosure renders raw offers, completed evaluations, incomplete line/price offers, no-independent-benchmark outcomes, stale outcomes, missing-context outcomes, and current market-family count. Internal identity/role alerts and recovery counters are not serialized to the member component.
- Held is an internal operational exception, not a member grade. The stored audit payload separately reports operational exceptions and unlocked exceptions eligible for recovery before T-60. The public DTO contains only Best Angle, Lean, Watchlist, and No Play decisions, and contains no Held filter, card, reader, or count. Exceptions can re-enter the member board only after a later coherent identity/role evaluation. They are never converted to a public grade and never receive a fabricated identity.
- Internal `No Play` remains the stored and member grade. The final candidate follows the universal Daily Edge vocabulary and does not relabel it.
- Board and reader expose opponent, scheduled start, sportsbook, provider, exact line/side/price, and observed time.
- The reader renders all genuinely available exact competing-book prices and conditionally renders same-book opening/current movement. It does not synthesize movement when production collection contains no opening observation.
- Existing stored snapshots remain readable: absent conformance fields fall back to the winning sportsbook row and visibly unavailable matchup/start context until the next natural writer cycle.

## Exact 2026 Week 1 non-writing measurement

A production-equivalent, non-writing collection ran at `2026-08-26T13:15:12.491Z` using the existing bounded collection path and stored NFL forward evidence.

- Provider calls: 25 total (`balldontlie`: 20, `sharpapi`: 5)
- New calls attributable to conformance fields: **0**
- Stored-context calls: 0
- Exact offers: 2,214
- Feature rows: 232
- Board: **1 Best Angle / 0 Lean / 12 Watchlist / 29 No Play / 2 Held**
- Member rows: 42
- Promotion/demotion or probability change: **0**
- Retained competing-book evidence entries: 136 across 44 audit decisions
- Maximum exact books on one decision: 4
- Genuine opening evidence entries in this cycle: 0; therefore movement panels correctly remain absent for this cycle
- Legacy-equivalent serialized payload: 79,832 bytes
- Candidate serialized payload: 129,789 bytes
- Incremental payload: **49,957 bytes (+62.58%)**
- Production call ceilings remain 30 before settlement and 48 with settlement.

The candidate remains well below the existing snapshot-size safety boundary. The size increase is bounded by the already-collected exact-book set and creates no per-card, per-reader, or per-member request.

## Live Held visibility check

The natural production snapshot generated at `2026-08-26T13:21:11.593Z` contains 46 audit decisions: 42 completed member decisions and four unlocked operational exceptions. The exceptions are the over/under outcomes for two unmatched player identities (`Jadarian Price` and `De'Zhaun Stribling`). Production `memberDecisions` contains **zero Held rows**, and browser inspection found zero member cards or reader entries labeled Held. The four exceptions remain audit-only and recovery-eligible on a later coherent pre-T-60 identity/role cycle; no player identity is inferred and no exception is converted to a public grade.

## Required publication proof

Focused runtime and production-contract tests must prove evidence retention, truthful copy, diagnostic completeness, unchanged decision fields, one-writer/T-60/tracking semantics, and backward-compatible rendering. TypeScript, model-change verification, production build, visual QA, and integration safety must pass again after rebasing any newer `origin/main` before publication.
