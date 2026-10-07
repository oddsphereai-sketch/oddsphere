# NBA independent-first regular-season r1

Date: 2026-10-06

## Scope and owner direction

The owner directed Oddsphere to prepare NBA before the October 20 regular-season opener using the
same product contract as the other sport-specific Daily Edge models: a real independent score,
sport-specific market interpretation downstream, one coherent score/side tuple, exact-price grades,
immutable locks, and no member copy, label, or layout changes. The board remains intentionally closed
during preseason.

## Defects found

- October through December requested the calendar-year Basketball Reference row instead of the NBA
  season ending the following year.
- Regular-season games were passed through the playoff context path.
- Early-season game counts admitted non-final and preseason rows.
- The released score path continuously blended toward the market with only 10% independent weight in
  fallback conditions.
- Spread cover probability applied a signed sportsbook line as the result threshold; away from pick'em
  this inverted the cover requirement.
- A Spread or Total side could be calculated against one line while the card displayed another.
- Fair-price construction could pair opposite outcomes from different books or different handicap
  lines.
- NBA had no bounded final T-60 refresh/coherence gate before its tracked rows locked.

## Released behavior

- Model: `nba_v2_independent_first_2026_10_06_r1`.
- Market marriage: `nba_market_marriage_2026_10_06_r1_independent_first`.
- Grade policy: `nba_grade_policy_2026_10_06_r1_coherent_exact_price`.
- Lock coherence: `nba_lock_coherence_2026_10_06_r1_official_and_context_tuple`.

The regular-season projection uses the existing possession, opponent offense/defense, Four Factors,
home-court, rest, and injury-availability architecture without continuously averaging its score into
the betting line. October-November ratings use a regressed prior-season handoff and progressively
transfer authority to current-season evidence. Postseason blending is used only for postseason games.

Market consensus remains sport-specific and downstream. It selects coherent exact lines, prices and
economic comparisons. Complete two-sided no-vig references must come from one sportsbook at one exact
line; books and handicap points cannot be crossed. Spread and Total direction/probability are recomputed
at the exact consensus line, so displayed score, side, line and probability cannot contradict. A missing
selected-side price or coherent fair pair cannot produce an actionable grade. No NBA score flip is
released because no candidate market correction cleared chronological confirmation; the internal audit
records that absence rather than silently applying an unvalidated nudge.

Moneyline and Total remain the existing official tracked markets. Spread remains the existing
member-visible context market (`Sprd*`) and is captured inside both official lock snapshots; it is not
silently promoted into public tracking without its own forward calibration.

At T-60, the existing pregame sweep refreshes only entering NBA events, reruns the sole NBA writer,
requires one unlocked current-release Moneyline/Total tuple with an identical score and a coherent
context Spread, and then locks both official rows together. Any refresh, write, or coherence failure
defers that game's lock rather than freezing a mixed or contradictory tuple. The ordinary writer's
existing direct-lock behavior remains as a fallback; prior locks remain immutable.

## Evidence

The audit-only chronological score-state tournament used only information available before each game.
Parameters were selected on 2024-25 and opened once on the later 2025-26 confirmation season. This is
architecture evidence, not an exact historical replay of every current runtime feature and not a
promised hit rate.

| Confirmation metric (2025-26) | Independent result |
| --- | ---: |
| Games | 1,230 |
| Team-score MAE | 9.6001 |
| Margin MAE | 10.9252 |
| Total MAE | 15.6065 |
| Winner accuracy | 64.80% |
| Spread direction | 48.55% |
| Total direction | 49.82% |

A broad market-winner crossing rule slightly improved winner direction but worsened confirmation score
error, so it was rejected. The old continuous 65% independent / 35% market score blend reduced some
error measures but violated the independent-first product and was not released. The five stored Finals
games provide only a structural runtime check: the independent candidate selected four of five winners;
the sample is too small and its retained later line rows are too contaminated by in-game captures to
serve as grade calibration evidence.

The regular-season board is empty by design on October 6, so current-board impact is zero games, zero
promotions, zero demotions, and zero actionables. This is not treated as proof of future performance or
permission to flatten the October 20 slate. The symmetric grade paths remain unchanged, while incomplete
exact-price evidence fails non-actionable.

## Verification and rollback

Focused tests cover season identity, early-season handoff, regular/postseason selection, signed spread
semantics, exact-line side coherence, same-book no-vig pairing, official/context market scope, bounded
T-60 refresh, two-row atomic lock behavior, and score/pick coherence. Full model-change verification,
production build, latest-main integration safety, protected PR checks, and post-deploy runtime checks are
required before this release is called live.

Rollback is the complete NBA r1 runtime bundle. Never restore only the old continuous market blend or
the spread-sign bug under the new identifier. Existing locked history remains immutable.
