# NHL T-60 market refresh r10

## Finding

The r9 model and production deployment were healthy, but live verification at
the September 29 CHI-VGK T-60 boundary found zero r9 rows. The scheduled sweep
locked three coherent r7 rows at `2026-09-30T01:30:42.584Z`. Root cause: NHL's
sole prediction writer ran in the once-daily refresh; the shared pregame sweep
reran the final model only for MLB and merely propagated locks for NHL.

## Repair

- Release family advances to r10; r9 equations and grades are unchanged.
- The existing pregame sweep and shared `prediction_pipeline` lease remain the
  only T-60 lifecycle owner.
- When an NHL game enters T-60, SharpAPI refresh is scoped to that exact game,
  public split observations refresh through the existing cached fallback lane,
  and the existing NHL writer rebuilds only that game.
- The writer defers its lock until a three-market coherence gate proves that
  Moneyline, Total, and puck line share the same current-release feature and
  model payload and their stored picks equal the unified output.
- Only after a complete r10 tuple exists are older unlocked r9/r7 rows retired.
  Locked rows are never deleted or rewritten.
- The shared sweep then applies the lock and republishes the existing Daily
  Edge snapshot. Any failure defers the lock for the next minute.

## Model and board impact

The independent score, 20% Moneyline no-vig sanity input, named same-book
movement equations, public-split trust policy, probabilities, exact-price grade
rules, and stakes are unchanged. Therefore a paired r9/r10 calculation has zero
side changes, promotions, demotions, or actionable-count changes. Scores retain
full internal precision and member-facing tenths; all three markets derive from
one final joint distribution.

Favorite `-1.5` remains eligible rather than quota-driven. On the untouched
2025 exact-price confirmation, the only reliable high-confidence band was at
least five percentage points of no-vig edge: 10-4 (71.43%) across 14 favorite
`-1.5` selections. The broader favorite puck-line cohort was materially weaker,
so r10 does not manufacture margin dispersion merely to increase `-1.5` volume.

## Verification contract

- focused NHL model, reader, transition, and lock-coherence tests;
- TypeScript, lint, production build, and `npm run verify:model-change`;
- clean current-main integration-safety check and protected pull request;
- next unlocked slate must show three r10 rows per game;
- the next T-60 run must show fresh targeted line history, exactly three locked
  r10 markets, a coherent decimal score/pick tuple, a refreshed member snapshot,
  and no superseded unlocked transition rows;
- prior locked r7 rows remain unchanged and eligible for tracking.
