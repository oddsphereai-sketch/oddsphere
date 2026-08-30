# CFB market-dominant sharp forecast predeclaration

Date: 2026-08-30

Status: owner-authorized live candidate; frozen before source edits

## Objective

Improve CFB score, margin, total, and side prediction accuracy after the active r42 release
missed six of seven Aug. 29 Totals and four of seven Spreads. This is a forecast change, not a
grade-only response and not an outcome reversal rule.

The owner explicitly rejected a shadow-only disposition on Aug. 30 and authorized a live,
versioned market-reading and sharp-money-focused release. Historical evaluation remains a
safety and stress input rather than the sole advancement threshold.

## Frozen forecast mechanics

1. Build the same canonical current market joint PMF already used by the sole CFB writer.
2. Mix exactly 25% immutable independent-football PMF mass with 75% canonical market PMF mass.
3. Use only strictly identified Circa `sharp_adjacent` splits captured no later than the writer
   evaluation timestamp and no more than 120 minutes earlier.
4. A Spread Circa split may affect the anchor only within 0.5 points of the canonical home line.
   A Total split may affect it only within 0.5 points of the canonical Total.
5. A signed money-minus-ticket gap must exceed 10 percentage points. Strength reaches its cap at
   20 points. The maximum pre-mixture anchor adjustment is 1.5 points for home margin and 1.5
   points for game total.
6. Missing, stale, future-dated, ambiguous, or line-mismatched split evidence contributes zero.
7. Do not separately add opening-to-current movement to the forecast. The current canonical line
   already contains that movement, so adding it again would double count the same information.
8. Recompute one coherent PMF and every expected score, reachable score, probability, side,
   exact-price EV, decision, and public field from it. No reader override is permitted.

## Authority and immutability

The existing `prediction_pipeline:cfb` leased forward-evidence writer remains the sole writer.
There is no new cron, provider call, table, retry path, or reader-side prediction. Existing T-60
locks, prediction records, settlements, and tracking results remain immutable and release-stamped.

## Evidence and acceptance framework

The candidate is assessed using four distinct inputs, none treated as the only threshold:

- the frozen 2023-2025 synchronized projection audit showing that the current independent-heavy
  mean blend increased Total and Margin MAE relative to the market benchmark;
- mechanism checks proving exact timestamp, source, game, market, side, and line identity;
- same-board before/after projection, side, probability, grade, and actionable-count impact;
- untouched natural writer cycles and T-60 locks after deployment, separated by release.

The Aug. 29 outcomes may be reported as diagnosis but may not be used to select a side-specific
or matchup-specific reversal. Roll back on mixed releases, missing current prices presented as a
normal evaluation, a writer/reader failure, tracking incoherence, or a material live projection
contract mismatch.

