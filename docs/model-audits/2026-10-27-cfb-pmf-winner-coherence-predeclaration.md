# CFB PMF winner-coherence repair — predeclaration

Date: 2026-10-27

Status: predeclared candidate; not production authority

Scope: future unlocked CFB forecasts only. Stored locked payloads remain byte-for-byte authoritative.

## Reported defect

The current Delaware–Western Kentucky forecast publishes Delaware as the Moneyline winner at
50.49% while its same authoritative joint PMF publishes expected points of Delaware 27.20 and
Western Kentucky 27.45. The football-only forecast favors Western Kentucky, the retained
same-book trail records resistance against Delaware, and the frozen diagnostic coordinator's
learned and combined probabilities favor Western Kentucky. The Moneyline correctly remains No
Play at its exact price, but the final winner and expected-score direction are not semantically
coherent.

The defect is not a team-identity failure. The exact DEL@WKU public split row is current. The
optional SharpAPI split endpoint returned zero NCAAF rows league-wide during the incident audit,
so its missing named-sharp row is provider availability, not an abbreviation mismatch.

## Root-cause hypothesis

The current reader may produce a narrow verified-PMF mean/median crossing: expected margin and
winner probability can land on opposite sides of 50% inside the existing 0.5-point publication
tolerance. The compatibility release correctly prevents the historically harmful r2 coordinator
from broadly replacing the reader forecast. Separately, the diagnostic coordinator defines its
incumbent winner boundary from a sigmoid of expected margin rather than the actual PMF winner
probability, so the would-apply telemetry can report `same_winner_side` even when its learned side
opposes the published Moneyline side.

## Candidate boundary

The candidate will not reactivate the broad r2 coordinator and will not create a second market
reader. It will test one narrow downstream invariant:

1. Detect a future-unlocked authoritative PMF whose expected-margin side and actual PMF winner-
   probability side disagree inside the existing 0.5-point tolerance.
2. Reconcile that same PMF with the smallest margin tilt that preserves total-by-margin mass and
   makes expected score, representative score, and winner probability agree with the expected-
   margin side.
3. Rebuild Moneyline, Spread, probabilities, exact-price economics, and grades from the one
   reconciled PMF. Total ownership remains unchanged.
4. Correct diagnostic coordinator boundary comparison to use the actual incumbent PMF winner
   probability. Coordinator output remains diagnostic-only under the compatibility release.

No fixed Delaware/WKU exception, public-split threshold, favorite/underdog quota, arbitrary score
adjustment, or automatic market-movement flip is permitted.

## Required evidence before publication

- Exact stored-lock audit of every available current-reader Moneyline, reporting mismatch count,
  corrections, harms, segment results, and named game rows.
- Complete release-pure replay where available, including Moneyline, direct Spread, Spread +3,
  Spread +6, Total, score error, probability scoring, and exact-price actionability.
- Same-input current-board rehearsal with side, score, probability, grade, promotion, demotion,
  and actionable-count changes. Delaware–Western Kentucky must become coherent without being
  manufactured into an actionable wager.
- Explicit tests for PMF mass, total preservation, minimum necessary tilt, Moneyline/Spread/score
  coherence, diagnostic boundary semantics, and immutable locked-reader precedence.
- Release identifiers advance in one atomic production family. The existing sole writer and
  `prediction_pipeline:cfb` lease remain unchanged.
- `npm run verify:model-change`, focused CFB tests, TypeScript, current-main integration safety,
  protected pull-request checks, and post-deploy live verification all pass.

Reject the candidate if it loses net resolved winner decisions, worsens broader score/probability
quality beyond noise, silently flattens the actionable board, changes Total direction, mutates or
reinterprets a stored lock, or depends on unavailable sharp splits.
