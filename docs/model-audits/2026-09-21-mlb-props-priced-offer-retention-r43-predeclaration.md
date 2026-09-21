# MLB Player Props priced-offer retention r43 predeclaration

Date: 2026-09-21

## Defect

The authoritative MLB Player Props writer receives and maps valid Ball Don't Lie pitcher offers for confirmed probable starters, but `buildDashboardRows` currently discards every offer whose research bundle has no recent MLB game log. This erases the entire pitcher board for a game when a confirmed starter lacks enough current MLB history, even though the prices, player identity, game identity, and probable-starter assignment are valid.

The September 21 WSH-DET slate reproduced the defect. Ball Don't Lie supplied 53 normalized pitcher-family price rows for confirmed starters River Ryan and DJ Herz, including 32 strikeout rows and eight outs rows. The model correctly failed closed because the required independent features were incomplete, but the member snapshot published zero pitcher rows for that game.

## Candidate

- Retain a valid, fresh, supported pitcher offer when player identity, game identity, price, and probable-starter mapping are verified even if recent MLB logs are absent.
- Keep the offer nonactionable with zero units on the existing `RESEARCH` or `PENDING_DATA` path. When no active scored model candidate exists, projection and model/final probabilities remain null with the existing `MARKET_RESEARCH_ONLY` reason. When the established conservative pitcher scorer has a probability-backed output but required member research is incomplete, preserve that output while the existing member-readiness gate retains `PENDING_DATA` and zero units.
- Continue requiring recent history for hitter rows and for every probability-backed pitcher prediction.
- Permit a null projection only on an explicitly held `RESEARCH` or `PENDING_DATA` row; reject it everywhere else.
- Render the existing dash/unavailable state rather than inventing a projection or adding member copy, labels, badges, or warnings.
- Preserve the exact price, book, line, freshness gate, best-price selection, main-line selection, writer, shared lease, provider budgets, tracking lock policy, and last-known-good publication behavior.

## Safety and expected board impact

The candidate cannot promote or demote a prediction because retained rows have no probability, edge, EV, fair odds, or stake. Expected actionable impact is zero promotions, zero demotions, and zero side changes. Board count may increase only by real supported pitcher offers that the provider already supplied and the product previously dropped.

The active release is `mlb_props_2026_09_05_r42`; any production candidate must publish as `mlb_props_2026_09_21_r43` and keep r42 as the rollback release. Historical and locked rows are immutable.

## Acceptance

1. Focused tests prove no-history pitcher offers survive as held research rows while no-history hitter offers remain excluded.
2. Validation accepts null projection only for held rows and continues to reject non-finite required values.
3. Equal-input live dry runs show zero actionable, side, probability, grade, or stake changes to previously published rows.
4. The WSH-DET reproduction retains real pitcher prices without fabricating a model output.
5. `npm run verify:model-change`, typechecking, focused lint, build, integration safety, protected PR checks, and live release verification pass.

Rollback restores r42's publication behavior without rewriting any historical snapshot or tracking record.
