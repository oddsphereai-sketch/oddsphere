# Football near-toss-up coherence predeclaration (r28)

Date: 2026-08-28

Status: predeclared before implementation after the untouched 19:39Z CFB writer cleared the repaired Sharp request phase and then failed on shared cross-market assertion for provider game `458220`.

## Starting point

- Clean worktree: `/private/tmp/oddsphere-football-near-tossup-coherence-r28-20260828`
- Branch: `codex/football-near-tossup-coherence-r28-20260828`
- Exact production base: `a5a0473bebe2670879ea404c112cb2051884d8e1`
- Shared coherence release: `football_cross_market_coherence_2026_08_28_r1_event_containment`
- Sole writers: `runCfbForwardEvidenceWriter` and `runNflForwardEvidenceWriter` under their existing sport-scoped `prediction_pipeline` leases.

## Incident and frozen correction

The exact failing CFB forecast had expected home margin `+0.1757457846952022` and home win probability `0.49448767833981844`. A discrete joint PMF can legitimately have a mean margin within a fraction of a point on one side of zero while its win/tie-mass probability is within a fraction of one percentage point on the other side. The existing sign-only assertion treats that mathematically valid near-toss-up shape as a fatal contradiction even when the PMF independently reproduces the published expected scores and win probability and the representative reachable score follows the probability winner.

The correction is limited to the shared audit gate:

1. Retain fatal score/winner disagreement for every material mismatch.
2. Permit a sign mismatch only when a supplied joint/marginal distribution exists, absolute expected margin is at most 0.5 points, and the home-away win-probability gap is at most 2 percentage points (home probability within 49%-51%).
3. Keep PMF mass, PMF expected-score/win identity, representative-winner direction, decision/quote/EV/side identity, actionable-value, market count, and Moneyline/Spread event containment fully fatal.
4. Do not modify any PMF, expected score, probability, representative score, selected side, exact price, grade, threshold, stake, split, lock, or tracking row. This is an assertion classification repair, not a prediction override.

## Release and board impact

- Shared gate becomes `football_cross_market_coherence_2026_08_28_r2_distribution_tossup`.
- CFB writer becomes `cfb_forward_evidence_writer_2026_08_28_r17_distribution_tossup`.
- NFL writer becomes `nfl_forward_evidence_writer_2026_08_28_r13_distribution_tossup`.
- All model, distribution, probability, decision, grade, evidence-schema, collector, member, and fixture releases remain unchanged.
- Expected grade impact: zero promotions, zero demotions, zero selected-side or probability changes. The only operational change is that a valid complete slate is no longer rejected by a false-positive near-toss-up assertion.

## Required proof

- Exact `458220` margin/probability shape with a self-consistent PMF passes.
- The same mismatch without distribution identity fails.
- A material score/winner mismatch remains fatal.
- Full shared football coherence, CFB/NFL writer, CFB production, TypeScript, `npm run verify:model-change`, webpack, diff, and integration-safety checks pass before protected publication.
- Production acceptance requires an untouched natural CFB cycle and signed-in current-board QA; no cron/provider/writer/database mutation is authorized.

## Rollback

Rollback restores coherence r1, CFB writer r16, and NFL writer r12. Immutable evidence and locked/tracking rows are never changed.
