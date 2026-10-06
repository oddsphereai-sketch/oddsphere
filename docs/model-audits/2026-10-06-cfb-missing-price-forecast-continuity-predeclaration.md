# CFB missing-price forecast continuity — predeclaration

Date: 2026-10-06

## Problem

The current 86-game member snapshot contains a complete independent score and Moneyline forecast
for every game, but 31 FCS-only games have no verified spread or total quote. The reader converts
those 62 internal `market_data_unavailable` states into the literal labels `Spread prediction
unavailable` and `Total prediction unavailable`, hiding the score-derived outlook already present
on the same card. Separately, the bounded 24-game SharpAPI fallback selector always favors the
same earliest games when no canonical event ID exists, so deferred missing-price games can be
starved across refreshes.

## Proposed repair

1. Keep every exact-price contract unchanged. A game without a verified quote remains No Play;
   no sportsbook, odds, market line, edge, EV, actionability, grade, stake, lock, or ROI is invented.
2. On prediction-only surfaces, fall back to the authoritative expected-score output: show the
   projected scoring margin for Spread and projected game total for Total. These are explicitly
   model projections, not line-specific betting selections.
3. Rotate never-attempted/deferred games ahead of already-attempted games inside the existing
   24-game SharpAPI fallback budget. Do not increase provider request caps or add another writer.
4. Replace the six-hour far-slate source cadence with an hourly cadence for every unlocked game.
   A compact republish must not be mistaken for a new provider observation.
5. Retain an exact game's last verified Playbook line/splits and SharpAPI split fallback when a
   later response omits them, preserving the original provider timestamp. Retention protects the
   member section from disappearing; it does not make old evidence eligible for model arbitration.

## Release and safety contract

- Shared presentation: `daily_edge_member_presentation_2026_10_06_r23_cfb_score_outlook_continuity`.
- CFB collector / sole writer: `cfb_forward_evidence_collector_2026_10_06_r43_hourly_market_freshness` /
  `cfb_forward_evidence_writer_2026_10_06_r96_hourly_market_freshness`.
- The authoritative independent score, joint PMF, probability, market-reading, decision, grade,
  fixture, snapshot, lock, and tracking releases do not change.
- The existing `prediction_pipeline:cfb` lease and single append path remain authoritative.
- Provider ceilings remain 24 fallback games and 192 requests per collection run.

## Validation gates

- Existing CFB production and Daily Edge experience suites pass.
- A no-line CFB fixture renders score-derived margin and total outlooks and never renders a
  synthetic price or grade.
- A 30-game selector fixture proves deferred games rotate ahead of prior attempts without changing
  the 24-game cap.
- Current-board audit reports no prediction-surface health errors after applying the reader mapper.
- `npm run verify:model-change` and integration safety pass before publication.

## Board impact

There are zero promotions and zero demotions. Exact-price Best Angle, Lean, Watchlist, and No Play
counts are byte-for-byte unchanged. Only the 62 currently suppressed model-outlook labels become
visible; all 62 remain exact-price No Plays until a verified quote arrives.
