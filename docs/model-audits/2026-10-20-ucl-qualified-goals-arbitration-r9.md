# UCL qualified goals arbitration r9

Date: 2026-10-20

## Decision

Advance future unlocked UCL predictions to
`ucl_goals_coherent_2026_10_20_r9_qualified_goals_arbitration` with coherent
outcome contract
`ucl_coherent_market_outcome_2026_10_20_r5_qualified_goals_arbitration`.
The independent r8u score foundation, Match Result reader, grade thresholds,
stakes, writer, cadence, shared `prediction_pipeline:soccer` lease, member
layout, tracking, and settlement remain unchanged.

This is a production reader improvement, not a shadow model. It applies only
to unlocked and future games. Every previously locked projection remains the
immutable public record and is used here only as read-only evaluation evidence.

## Diagnosed gap

The independent UCL BTTS head predicted Yes on 121 of 126 chronological
selection matches and 61 of 63 confirmation matches. Confirmation accuracy
was 58.73%, but No recall was only 3.85%. The current 18-game board likewise
started with 18 BTTS Yes and 18 Over forecasts. This was a discrimination gap,
not evidence that a fixed number of No or Under picks should be manufactured.

The r4 coherent reader used target-excluded current 1X2 consensus but
deliberately ignored current Total and BTTS vectors. The provider already
supplied complete multi-book goals evidence, so the final product was not
using all of its qualified market reader.

## Fixed arbitration

The evaluated sportsbook is excluded from every forecast consensus. Polymarket
and Kalshi are excluded. An eligible Total or BTTS level requires:

- at least three complete named-book vectors for the exact provider event;
- strictly predecision and pre-kickoff timestamps;
- the exact 2.5 line for Total;
- a complete two-sided no-vig probability;
- stable direction after removing each book in turn; and
- mean absolute book dispersion no greater than six percentage points.

Total can correct only an opposing independent side below 60% confidence and
only when same-book movement does not point back toward the independent side.

BTTS adds a genuinely separate corroboration requirement: target-excluded 1X2
and Total consensus are converted into a score distribution, and its implied
BTTS direction must agree with direct target-excluded BTTS consensus. An
independent BTTS side at 60% or higher is eligible only when model evidence is
thin, the direct market disagreement is at least 20 percentage points, and
same-book movement does not resist the correction.

This is categorical arbitration, not a scalar market weight. When a correction
qualifies, the direct consensus probability becomes the affected target. The
existing mean-preserving solver reconciles it into the one joint PMF while
preserving Match Result, the unaffected goals market, and expected total to
numerical tolerance. Existing symmetric probability, exact-price EV, and grade
rules then apply; no side receives a special promotion or stake.

## Read-only settled evidence

Historical multi-book UCL line history was not retained for completed games.
Twenty-seven immutable locked snapshots did retain one selected-book two-sided
board. This is secondary opened evidence, not a target-excluded multi-book
holdout.

Using a fixed weak-model-disagreement rule on those 27 rows:

| Market | Incumbent accuracy | Candidate accuracy | Incumbent minority recall | Candidate minority recall | Corrections |
|---|---:|---:|---:|---:|---:|
| Total | 81.48% | 85.19% | 0.00% Under | 20.00% Under | 1 |
| BTTS | 74.07% | 77.78% | 12.50% No | 25.00% No | 1 |

Total Brier improved from 0.17322 to 0.17225 and BTTS Brier from 0.20568 to
0.20322. Total log loss improved from 0.53273 to 0.53078 and BTTS log loss from
0.60205 to 0.59712. Both corrections were right. A second Total market
disagreement was correctly rejected because the independent Over probability
was 66.16%; that game finished Over.

The exact production rule is stricter than this historical comparator because
it requires target exclusion, multi-book stability, and movement; BTTS also
requires independent cross-market corroboration. The thin-evidence 20-point
branch has no untouched historical multi-book cohort and is therefore an
owner-approved provisional correctness exception, not a claimed guaranteed
hit-rate improvement.

## Current unlocked board impact

The credential-backed same-input rehearsal captured all 18 fixtures and all
72 markets. Two already-started fixtures, eight market rows, were excluded
from decision impact.

Across the remaining 16 unlocked games and 64 markets:

| Measure | r8u/r4 | r9/r5 |
|---|---:|---:|
| Actionables | 12 | 11 |
| Leans | 12 | 11 |
| Watchlists | 30 | 31 |
| No Plays | 22 | 22 |
| Side changes | — | 1 |
| Promotions | — | 0 |
| Demotions | — | 1 |

The only changed side is Roma-Slovan Bratislava BTTS:

- incumbent: Yes, 74.82%, Lean, +107;
- candidate: No, 53.65%, Watchlist, -133;
- direct target-excluded BTTS, target-excluded 1X2+Total score reconstruction,
  and non-resisting same-book movement all point to No;
- the club-stat/xG evidence is thin, and the direct disagreement exceeds 20
  percentage points.

AEK-Manchester City also has a current No level, but six-book movement shifted
8.45 percentage points toward Yes. The movement veto keeps the independent Yes
forecast. All 18 current Totals remain Over because no Under satisfies the
fixed gate. No quota or board-balancing rule exists.

The one Lean demotion is accepted without fabricating a compensating play. The
same grade path is symmetric: a corrected side can promote when it clears 55%
and positive exact-price EV, but no current row legitimately does so.

## Verification and rollback

Required before publication:

- focused UCL production contracts, including qualified correction, movement
  veto, coherent preservation, and no-shadow assertions;
- TypeScript and `npm run verify:model-change`;
- exact same-input current-board replay;
- clean latest-main integration-safety verification and protected PR checks;
- post-deploy proof of r9/r5 on unlocked rows, one soccer writer/lease, complete
  provider coverage, and byte-for-byte precedence for existing locked rows.

Roll back future unlocked generation to r8u/r4 if target exclusion, exact event
identity, movement veto, PMF coherence, price coverage, actionability, writer
ownership, or lock precedence regresses. Rollback must never rewrite a locked
r9 or earlier payload.
