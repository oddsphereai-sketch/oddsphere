# NFL personnel-evidence eligibility predeclaration — 2026-10-15

## Objective

Stop future NFL decisions from becoming actionable when the exact-game injury report, expected
quarterback, or selected quarterback identity is not verified enough for the existing model to
use. This is a correctness and data-safety repair, not an accuracy claim.

## Defect established before implementation

- The evidence writer already emits `injury_report_unavailable` and
  `expected_quarterback_unavailable`, but the r6 health boundary classifies both as context rather
  than blockers.
- The quarterback substitution path reads the injury-report status but ignores the current roster
  snapshot's `injuryStatus`, allowing an expected starter marked Out there to remain selected when
  the separate report omits him.
- A replacement quarterback without an exact historical identity receives generic fallback
  features and can continue into the production decision path.
- Consequently, collection success and decision eligibility are not the same contract, and the
  production board can fail open even while the stored evidence discloses the gap.

## Bounded candidate

- Add missing exact-game injury evidence and missing expected quarterbacks to the existing
  game-level blocking reasons.
- Treat Out or Doubtful status from either verified source as unavailable. Select the highest
  healthy depth-chart replacement using both sources.
- Block the game when the selected starter is missing/unknown or has no exact historical model
  identity. Do not block merely because the provider labels an otherwise identified starter
  projected rather than confirmed.
- Persist the effective decision blockers in `coverage.healthHolds` and publish no evaluated bets
  for a held game. The diagnostic projection can remain stored and labeled.
- Bump the decision, grade-policy, member, collector, and sole-writer releases. Do not change the
  forecast model/calibration or the frozen r6 artifact release because their mathematics are
  unchanged.

## Explicit non-goals

- No threshold search, feature-weight tuning, market-reader change, probability adjustment, score
  adjustment, retrospective lock rewrite, provider-call expansion, or second writer.
- No assertion that removing ineligible bets improves model accuracy. Held rows are incomplete
  evaluations, not wins.

## Acceptance gates

1. Focused tests prove missing reports, missing expected quarterbacks, unavailable roster-status
   starters, unavailable backups, and unmatched replacements fail closed; a verified matched
   replacement remains eligible.
2. Writer tests prove effective blockers are persisted and the sole `prediction_pipeline:nfl`
   lease remains authoritative.
3. Same-input current-board rehearsal reports games/markets held, promotions, demotions, side,
   probability, and score changes. Any contraction must be explainable by a named evidence gap.
4. `npm run verify:model-change`, affected focused suites, clean current-main integration safety,
   protected pull-request checks, and post-deploy live verification pass.
5. Existing locked payloads and reader precedence remain byte-for-byte authoritative.

## Next experiment, kept separate

After this repair passes, one fixed shadow-only independent-score challenger may be evaluated with
chronological development/confirmation separation. It must declare its features and thresholds
before results are opened and beat the incumbent on score error and proper probability scoring
without hiding board contraction. Failure ends that candidate; it does not trigger iterative live
threshold fiddling.
