# NFL cross-market winner coherence r28 predeclaration

Date: 2026-10-05

Scope: NFL Daily Edge joint score, Moneyline, Spread, Total, and downstream exact-price grades.

Writes during audit: zero.

## Failure being tested

The active r27 release starts from the paid independent team-score projection and may rebuild the
margin distribution around verified Spread movement. A Spread correction can currently cross zero
and therefore replace the independent Moneyline winner without requiring Moneyline-specific
evidence. The resulting joint distribution is internally coherent, but the cross-market authority
is too broad: evidence about covering a point spread is being allowed to decide the outright winner.

The first release-pure r27 cohort contains 14 settled Week 4 games. Four published Moneyline winners
differ from the paid independent winner. The published flips are 1-3; the independent winners on
those exact games are 3-1. Across all 14 games, the published margin MAE is 7.5731. Preserving the
independent winner on those four games while retaining the active final Total reduces margin MAE to
5.7677. This is forward evidence for the current release, not a promised future hit rate.

## Frozen candidate

The paid independent joint-score forecast remains primary. Existing Spread and Total market
reading remains sport-specific and is recomputed from the independent base on every refresh.

A Spread-driven margin correction may cross zero and change the Moneyline winner only when the
proposed winner is independently corroborated by Moneyline evidence:

1. a strictly same-book opening/current Moneyline no-vig probability move of at least 1.0
   percentage point supports the proposed winner;
2. either a fresh named sharp-book Moneyline money-minus-ticket gap of at least 10 percentage
   points, or the lower-trust Playbook Moneyline gap of at least 8 percentage points, supports the
   same winner; and
3. a fresh named sharp-book Moneyline gap at or beyond 10 percentage points does not oppose it.

When those conditions do not hold, the final margin returns to the independent calibrated margin;
the market layer cannot manufacture a different outright winner from Spread evidence alone. This is
not a permanent independent-model lock: a real Moneyline flip remains possible when the required
Moneyline evidence qualifies, and the decision reverses when that evidence reverses or disappears.

Total direction, Total mean, Total grade behavior, exact-price selection, provider cadence, writer,
lease, tracking, and member presentation are outside the candidate and must remain unchanged.

## Evaluation gates

- Replay the exact 14-game r27 settled cohort through the production functions and compare the
  incumbent and candidate from identical immutable evidence.
- Moneyline accuracy, Brier/log loss, team-score MAE, and margin MAE may not decline.
- Spread and Total accuracy may not decline. Total sides, probabilities, expected Total, and grades
  must remain byte-identical.
- One joint distribution must still generate expected scores, representative score, Moneyline,
  Spread, and Total. Literal score/side contradictions must remain zero.
- Report every side flip, corrected flip, harmed flip, actionable promotion, actionable demotion,
  and market grade count. A flatter board is not an acceptable hidden effect.
- Locked rows remain immutable. The candidate applies only to newly generated unlocked and future
  T-60 rows under one versioned authoritative writer.

If these gates fail, the active r27 release remains authoritative and this candidate is rejected.
