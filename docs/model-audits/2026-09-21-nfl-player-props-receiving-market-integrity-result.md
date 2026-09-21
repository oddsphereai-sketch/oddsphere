# NFL player-props receiving-market integrity result

Date: 2026-09-21

Candidate: `nfl_player_props_provider_observation_2026_09_21_r10_receiving_market_integrity`

Predeclaration: `docs/model-audits/2026-09-21-nfl-player-props-receiving-market-integrity-predeclaration.md`

## Same-capture replay

The read-only A/B replay fetched Week 2 current and opening payloads once, then passed the
identical raw values through the prior and candidate provider adapters. It made 38 bounded
BALLDONTLIE requests and zero SharpAPI requests.

- Raw rows: 4,015 current and 41,545 opening.
- Proven semantic rejections: 4 current rows and 159 opening rows.
- Normalized observations: 40,887 prior; 40,561 candidate.
- Runtime decisions: 211 prior; 203 candidate.
- Prior grades: 0 Best Angle / 8 Lean / 32 Watchlist / 151 No Play / 20 Held.
- Candidate grades: 0 Best Angle / 8 Lean / 32 Watchlist / 143 No Play / 20 Held.
- Actionable promotions: 0.
- Actionable demotions: 0.
- Retained decision changes: 0.
- Added decisions: 0.

The eight removed decisions are the Over and Under members of four mislabeled FanDuel
receiving-yard offers:

- Blake Corum 54.5 (independent receiving center 3; combined-yard center 52.5).
- Cam Skattebo 67.5 (independent receiving center 11; combined-yard center 67.5).
- Devin Singletary 25.5 (independent receiving center 7; combined-yard center 26).
- Kyren Williams 84.5 (independent receiving center 15.5; combined-yard center 84.5).

Every removed decision was No Play. The ordinary receiving props, all actionables, market
mix, probability/grade behavior for retained decisions, and tracking cohort are unchanged.

## Safety and load

- No new provider call, database query, writer, route, timer, or member request was added.
- Normalization remains slate-level and bounded by the existing payload ceiling.
- The existing writer and `prediction_pipeline:nfl` lease remain authoritative.
- Last-known-good publication, T-60 locking, snapshot size checks, settlement, and tracking
  behavior are unchanged.
- No UI component, copy, label, badge, or layout changed.

## Verification

- `npm run test:football-player-props-foundation`: passed.
- `npx tsx scripts/test-nfl-player-props-production-contract.ts`: passed.
- `npx tsx scripts/test-nfl-player-props-snapshot-store.ts`: passed.
- The remaining repository and protected-PR checks are recorded on the release PR.

## Release decision

The candidate passes the predeclared board-preservation gate. Provider observation, member,
member lifecycle, and writer identifiers advance. Model, calibration, decision, runtime,
board, tracking, and settlement releases remain unchanged because the identical-capture
replay proves zero retained-decision or actionable change.
