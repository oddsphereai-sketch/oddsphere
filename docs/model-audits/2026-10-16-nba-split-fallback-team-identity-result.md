# NBA split fallback team identity result — 2026-10-16

## Outcome

The NBA split capture and direct SharpAPI matching paths now resolve database/provider aliases through the shared NBA team registry before matching games. This removes the identity mismatch that accepted `BOS@DET` but rejected games stored with ESPN abbreviations such as `PHI@NY` and `OKC@SA`.

The correction covers all six live ESPN abbreviations that differ from the canonical registry:

- `GS` → `GSW`
- `NO` → `NOP`
- `NY` → `NYK`
- `SA` → `SAS`
- `UTAH` → `UTA`
- `WSH` → `WAS`

The full 30-team database abbreviation set is covered by a focused registry test. Unknown teams still fail closed.

## Release identifiers

- NBA unified model: `nba_professional_unified_2026_10_16_r6_canonical_split_identity`
- NBA market marriage: `nba_market_marriage_2026_10_16_r5_canonical_split_identity`
- NBA professional market reader: `nba_professional_market_reader_2026_10_16_r5_canonical_split_identity`
- Market-intelligence capture: `market_intelligence_v2_shadow_capture_2026_10_16_r4_canonical_nba_team_identity`
- NBA grade policy: unchanged at `nba_grade_policy_2026_10_16_r5_market_specific_accuracy`

## Read-only validation

Against the live provider payload and current NBA schedule, the repaired matcher produced:

- 16 canonical games from October 20 through October 22
- 32 accepted in-window split rows (DraftKings and BetMGM representations for all 16 games)
- all three October 20 opening games accepted
- zero cross-game matches
- zero rejected team identities

A full capture rehearsal with writes disabled produced:

- 28 games loaded for October 16 through October 22
- 36 SharpAPI rows fetched
- 144 split observations built
- 2,473 price observations built
- zero rejected SharpAPI rows
- zero database writes

The local rehearsal did not call Playbook because the isolated worktree does not contain a local `PLAYBOOK_API_KEY`. Production Playbook coverage already exists in the observation store; this change does not alter that source or its fallback precedence.

## Prediction and board impact

The same-board comparison covered 16 games and 48 moneyline, spread, and total markets. With the current stored market inputs, the candidate produced:

- zero pick-side changes
- zero promotions
- zero demotions
- zero actionable-count changes
- zero meaningful projected-score changes

The repaired opening-slate reader still applies no final-score correction for the three October 20 games because the available movement/evidence does not meet the existing qualified-reader thresholds. The change restores complete provider evidence and makes future reader decisions eligible; it does not force a market lean or fabricate a play.

## Locked-record safety

No locked prediction payload is rewritten or reconstructed. The capture path only appends/updates unlocked observation inputs, and the model/reader releases apply to future unlocked snapshots and future locks. Existing locked projections, probabilities, picks, grades, prices, stakes, and evidence remain authoritative and unchanged.

## Rollback

Rollback is the prior release set:

- `nba_professional_unified_2026_10_16_r5_market_specific_grades`
- `nba_market_marriage_2026_10_16_r4_independent_first_total_disagreement`
- `nba_professional_market_reader_2026_10_16_r4_total_disagreement_authority`
- `market_intelligence_v2_shadow_capture_2026_10_16_r3_paginated_nba_price_window`

Rollback removes the alias correction and therefore reintroduces incomplete split capture for the affected abbreviations.
