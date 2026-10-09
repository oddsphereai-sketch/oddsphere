# NFL market-state and score-marriage r29 predeclaration

Status: resolved as the narrower r28 identity release. This record is not the r29 professional-authority
qualification record; see `2026-10-09-nfl-professional-market-authority-r29-predeclaration.md`.

Date: 2026-10-09

Starting production base: `41cb2fc88d6c601d77a4932dbb1adcd1aaebfd93`.

## Scope

This candidate is limited to NFL Daily Edge Moneyline, Spread, and Total. The paid team-score
projection remains the independent starting opinion. The candidate may change an unlocked projected
score, probability, side, or grade only through the one downstream market-evidence path. It does not
change provider cadence, stake behavior, member copy, layout, the sole NFL writer, the
`prediction_pipeline:nfl` lease, or any locked payload.

The current champion is the r27 named-sequence family documented in
`2026-10-08-nfl-named-market-sequence-r27.md`. The rejected October 9 confidence-reflection candidates
remain rejected and are not production predecessors.

## Frozen defects being addressed

1. Same-book number movement, same-number price movement, hold change, and cross-book displacement are
   currently collapsed or mislabeled.
2. A SharpAPI DraftKings or BetMGM fallback can corroborate a sequence under a named-sharp description.
3. Retail following can be counted after the first named mover instead of after the complete two-book
   named lead exists.
4. Named authority is built before the evaluated sportsbook family is known, forcing a blanket follower
   tax and allowing the evaluated family to remain in the authority calculation.
5. Split pressure with a flat or contrary price response is not represented as resistance.
6. Contrary Spread and Total direction can inherit conviction that belonged to the independent side;
   same-winner Spread expansion can inflate Moneyline conviction without Moneyline corroboration.

## Frozen implementation sequence

### A. Observational market-state ledger

For each market and sportsbook family, retain separate time-safe fields for:

- opening and current number;
- no-vig first-side probability at the opening and current quote;
- raw two-sided hold at the opening and current quote;
- number delta, no-vig price delta, and hold delta;
- first material price move, first material number move, their order, and elapsed minutes;
- directional persistence, reversal depth, buyback-to-opening state, and last economic move;
- named-leader completion time and retail follower delay;
- public and source-identified split direction, freshness, and conflicts;
- explicit `flow_resistance`, `reverse_flow`, and `book_disagreement` states;
- key-number crossings for NFL Spreads.

Unknown limits, absolute handle, ticket count, bet size, exchange origin, derivative origin, suspension,
reopening, and provider correction remain explicitly unavailable. They may not be inferred.

Bookmaker is not a named price authority until it is actually collected. Circa and Pinnacle are the only
named price families in this candidate. A split is named-flow corroboration only when its stored source is
Circa; DraftKings and BetMGM remain source-identified retail evidence.

### B. Exact target exclusion and chronology

Sequence authority is rebuilt inside each evaluated-quote iteration after excluding that candidate's
Moneyline/Spread or Total sportsbook family. A qualified named lead requires two remaining named price
families moving in the same direction. Retail followers must move no earlier than the later of those two
named moves. Two remaining follower families are sufficient only after exact exclusion; no blanket global
threshold is lowered.

A same-source reversal, material buyback, fresh opposing split, or explicit reverse-flow state prevents
qualification. A flat response to a qualifying flow imbalance is resistance, not directional steam.

### C. Direction and conviction remain separate

The r27 market-direction hierarchy remains the control. The audit must compare two frozen direction
paths: (1) validated same-book movement only and (2) the released opening-to-target-excluded-consensus
displacement, retained under that truthful identity rather than mislabeled as same-book movement.
Ordinary near-50/50 price noise cannot originate a direction in either path. If the same-book-only path
fails the predeclared Spread gate while consensus displacement retains incremental value, the latter may
remain as a distinct signal; its direction and conviction still must be calibrated separately.

When market direction agrees with the pre-orientation side, confirmation may retain the stronger of the
independent and target-excluded evidence-priced probabilities. When it opposes, the selected side's
probability is derived from target-excluded price plus independently corroborated market-state strength;
the old opposite-side probability is never mirrored across 50%.

The predeclared contrary-side probability candidates are:

- price only;
- price plus 25% of the distance from 50% implied by corroborated market-state strength;
- price plus 50% of that distance;
- price plus 75% of that distance.

For this grid, corroborated market-state probability is fixed before replay as `50% + strength`, where
`strength` is capped at six percentage points and equals the absolute same-book no-vig price change plus
one percentage point per point of same-book number movement, plus one percentage point when a qualified
target-excluded named sequence agrees. The selected-side target is the stronger of that market-state
probability and the selected side's target-excluded current fair probability. Each grid weight blends
from current fair probability toward that target. This is a continuous magnitude rule; the named-sequence
qualification remains the only discrete authority escalation.

These are evaluated chronologically and retained in the report. A candidate is ineligible if it creates a
hard side flip with a probability below the selected side's target-excluded fair price, or if the score,
side, probability, and grade do not derive from one final joint distribution.

A same-winner margin may expand by at most the released 1.5-point maximum split contribution unless
Moneyline-specific same-book movement plus a source-qualified split, or matching target-excluded named
Moneyline and Spread authority, corroborates the expansion. Reductions in the independent winner's margin
remain unrestricted.

Total authority is independent of winner/Spread authority. Named Total direction remains audit-only in
this candidate because the available named Total cohort is insufficient for activation.

## Evaluation and selection

The exact stored paid-score cohort is opened retrospective evidence and will be labeled that way. Every
variant is replayed from evidence captured no later than the immutable lock. The report must preserve the
independent-only, market-only, active r27, corrected-identity, and full-candidate ablations. Before reading
additional outcomes, the corrected-identity work is frozen into these separate ablations so that one defect
cannot hide another:

- identity/chronology/exact-target-exclusion only, retaining the released score marriage;
- unsupported same-winner expansion guard only, retaining the released direction and pricing paths;
- identity plus the same-winner guard, retaining the released direction and pricing paths;
- the full evidence-priced candidates declared above.

Failure of the full evidence-priced candidate does not authorize tuning it after seeing results. A narrower
ablation may advance only on its own declared defect and gates.

Selection may not use aggregate hit rate alone. It must report:

- Moneyline, Spread, and Total direction, Brier score, log loss, and calibration bins;
- team-score, margin, and Total MAE;
- exact stored-price units and actionable performance;
- upset precision/recall and short-spread winner changes;
- every side correction and harm;
- every promotion and demotion, per-market actionables, and complete board count;
- threshold-neighborhood cases and evidence-availability counts.

The full candidate is rejected if it takes an actionable market to zero, removes more than half of the
current actionable board, worsens Spread direction versus r27, worsens two of Moneyline Brier, Spread
Brier, or Total Brier, or produces no tested confirmation/promotion path. These are safety gates, not
quotas and not permission to weaken price or evidence requirements.

## Publication boundary

Existing locked rows retain their stored payload and release tuple. Publication requires unique release
identifier bumps for every affected writer/model/distribution/probability/calibration/decision/grade/
member/context path, focused tests, `npm run verify:model-change`, an identical-input board comparison,
latest-main integration safety, a protected pull request, explicit owner approval of the measured impact,
and post-deploy writer/lease/release/coverage/reader/lock proof.
