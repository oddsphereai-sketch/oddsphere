# NFL player props professional model and market marriage — predeclaration (2026-09-28)

## Scope and production base

- Production base: `f0c8af6ed29c7fdd0cc579a54f6c2b5190ac206e`.
- Sport/model: NFL player props only.
- Markets: passing yards/completions/attempts, rushing yards/attempts, receiving yards/receptions, and anytime touchdown.
- Runtime, distribution, calibration, decision, board, member, writer, lifecycle, tracking, and reader releases will advance together if a candidate qualifies.
- The sole authoritative write path remains the existing NFL forward-evidence writer and NFL player-props production writer under `prediction_pipeline:nfl`. No new timer, writer, provider request, member copy, label, layout, or stake is in scope.

## Defects established before candidate editing

1. The live PHI–CHI board can combine a fresh expected-quarterback/depth snapshot with an older injury report and allow the older `inactive` status to veto the current starter role. Case Keenum consequently received a reserve-scale passing projection. Current role evidence must not be overridden by older contradictory availability evidence.
2. The member forecast can take a median of quote-specific projections while retaining the probability from a different quote-specific row. That can display a projection above the line with an Over label but an Over probability below 50%. Projection, side, probability, expected value, and grade must come from one canonical posterior.
3. Release-separated settled evidence through the preceding release family is 52–53 overall. Best Angles are 23–12 while Leans are 29–41; Overs are 17–7 while Unders are 35–46. The most recent settled release is 15–4 for Best Angles and 8–19 for Leans. This is diagnostic opened evidence, not a guaranteed future rate.

## Candidate families

1. **Role/availability chronology.** Resolve starter/depth and injury evidence by identity and capture chronology. A current confirmed/projected starter may supersede an older contradictory injury designation; current or newer `out`/`inactive` evidence still holds the row.
2. **One canonical posterior per player/market/line.** Build one independent distribution and one target-excluded, multi-book market comparison for the scope. Individual sportsbook quotes remain execution prices only. The published projection and its Over/Under probability must be mathematically coherent.
3. **Evidence-conditioned market reading.** Evaluate same-book line/price movement, cross-book consensus, and sharp-reference books as source-separated evidence. A sufficiently supported conflict may change the forecast side; there is no cosmetic fixed nudge or split-only flip. Missing evidence remains unavailable.
4. **Balanced grade calibration.** Preserve the historically stronger Best Angle lane. Any demotion of weak Lean cohorts must be paired with tested promotions from eligible positive-EV Watchlists, with explicit board-count and market-mix reporting. No quota or flat-board target is permitted.

## Evaluation chronology and acceptance gates

- Existing 2016–2024 development and 2025 chronological artifacts remain the historical foundation.
- 2026 settled rows are evaluated by exact decision release and lock timestamp. Weeks 1–2 may select diagnostics; settled Week 3 rows are confirmation only where their pregame evidence is fully stored. The still-unsettled PHI–CHI game is prospective and cannot select parameters.
- Report direction accuracy, Brier/log loss where reconstructable, calibration gap, exact-price ROI/units, cluster-aware game/player counts, promotions, demotions, net actionables, and market mix.
- Reject any candidate that fabricates evidence, changes locked rows, loses a current game/market, produces projection/side/probability contradictions, adds provider requests, creates a second writer, or materially flattens the board without validated replacements.
- Before publication: focused tests, candidate comparison, `npm run verify:model-change`, clean latest-main integration proof, protected PR, deployment, writer proof, live release proof, freshness/coverage proof, and member-page coherence proof.

