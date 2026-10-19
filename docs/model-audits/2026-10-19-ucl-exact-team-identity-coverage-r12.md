# UCL r12 exact team-identity coverage

Date: 2026-10-19  
Scope: future unlocked UEFA Champions League rows only  
Candidate calibration: `ucl_grade_policy_2026_10_19_r12_exact_team_identity_coverage`  
Candidate Sharp identity: `ucl_sharp_market_identity_2026_10_19_r4_exact_team_alias_coverage`

## Problem

The current 18-fixture UCL slate had complete Sharp events and four-market books for eight fixtures that the adapter could not associate with Ball Don't Lie fixture names. The failures were exact naming variants, not missing odds: examples included `Sabah FK`/`Sabah`, `Roma`/`AS Roma`, `PSV Eindhoven`/`PSV`, `SSC Napoli`/`Napoli`, and `FC Shakhtar Donetsk`/`Shakhtar`.

The production result was 10/18 fixture matches, 51/72 selected prices, 131/180 complete outcome prices, and 21 held markets.

## Repair

Add only the observed exact aliases to the existing UCL identity table. Substring matching remains disabled, blank events remain rejected, kickoff tolerance is unchanged, and wrong-club guards such as Inter versus Inter Club d'Escaldes remain in the contract tests.

No model coefficient, probability, projected score, selected side, market-reader formula, grade threshold, stake, provider cadence, writer, lease, member copy, or layout changes.

## Same-day read-only validation

The provider catalog contained 42 rows, including futures shells and the 18 scheduled match events. The repaired matcher produced:

- fixture identity: 18/18;
- selected-price coverage: 72/72;
- complete outcome-price coverage: 180/180;
- held markets: 0;
- grade distribution: 13 Lean, 36 Watchlist, 23 No Play;
- nonpositive-EV actionables: 0;
- incoherent score distributions: 0;
- current-price collapse or unlocked regressions: 0.

This is an evidence-availability repair. It restores evaluation of the existing forecast against the correct exact price; it does not force a promotion. The actionability policy still independently decides whether each restored market is Lean, Watchlist, or No Play.

## Immutability and rollback

Locked records remain byte-for-byte authoritative and are neither rewritten nor reconstructed. The new identity/calibration identifiers apply only to unlocked and future records. Rollback is r11 calibration plus r3 Sharp identity; rolling back would restore the 21 current evidence holds and is therefore appropriate only if a verified wrong-event match appears.
