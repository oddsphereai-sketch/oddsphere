# NFL cross-market winner arbitration r1 predeclaration

## Frozen boundary

- Base: `35c42abd089038707000b00ffbf15deeb5d4915a`.
- This document is frozen before any outcome join or candidate replay.
- Audit unit: release-pure, pregame NFL game snapshot. Settled results may be joined only after the input snapshot, lock timestamp, release identifiers, and evidence availability have been frozen.
- Current production behavior remains unchanged. No coefficient, threshold, side, probability, score, grade, stake, writer, lease, lock, tracking, DTO, registry, or reader change is authorized by this audit.
- Older adaptive/interval research is negative evidence only; its outputs and coefficients are not reused.

## Source-graph assertions to test

For every supported game and market, record the independent football prior, selected forecast anchor, opening/current landmarks, every operator/source family in that anchor, eventual evaluated quote identity, target-excluded complete alternatives, verified Circa/public provenance, movement chronology, QB/injury/weather context, uncertainty, calibrated PMFs, decimal score, winner, ML/spread/Total sides, grades, stakes, and locks.

The audit will prove or falsify:

1. whether an eventual evaluated sportsbook contributes to any forecast anchor or calibration feature;
2. how many times market-derived information enters the probability path, including current-line anchoring, residual calibration, movement, and split evidence;
3. whether every downstream transform is monotone and whether it can cross the upstream PMF winner or market side;
4. whether a Moneyline value selection below 50% is correctly distinguished from a predicted-winner change;
5. whether missing, stale, singleton, correlated, or contradictory evidence is neutral or improperly receives flip authority; and
6. whether one final joint PMF generates the displayed decimal score, winner, ML, spread, and Total.

## Outcome-blind categories

Before results are joined, each row will be classified by facts available at the frozen pregame timestamp:

- market favorite and no-vig probability from complete target-excluded alternatives;
- model-favorite agreement or disagreement;
- evaluated target present or absent from forecast evidence;
- target-excluded breadth by independent operator/source family;
- opening/current same-book chronology, direction, persistence, and key-number crossing;
- verified Circa, public money/ticket divergence, and RLM status (never inferred from retail movement);
- QB/injury/weather availability and independent-model uncertainty;
- winner hypothesis: favorite retained, true uncertainty, or underdog plurality; and
- wager hypothesis: predicted side, opposite sub-50% value side, or stand-down.

Missing fields remain explicitly missing and cannot be imputed from outcomes or from another evidence class.

## Frozen measurements

Prediction quality is reported separately from wagering economics:

- winner accuracy, favorite-pick rate, observed favorite win rate;
- binary Brier score and clipped log loss overall and by market-favorite implied-probability bucket;
- underdog upset recall and precision;
- model-versus-market disagreement count and outcomes;
- predicted-winner flips separately from sub-50% opposite-side value selections;
- exact-price grade counts, promotions/demotions, stake, realized units and ROI where settlement is valid; and
- ML, spread, and Total warning-state counts, side changes, probability deltas, score deltas, and actionability deltas.

No accuracy claim is permitted without release-pure settled evidence. Absence of sufficient outcomes is a yellow limitation, not by itself a structural rejection.

## Structural candidate gate

A production candidate may be implemented only if the audit identifies a source-proven defect and the proposed correction satisfies all of these conditions without outcome fitting:

- the evaluated quote is excluded from forecast evidence whenever an independent complete alternative exists;
- an evaluated-only quote may price and grade but cannot author its own forecast;
- insufficient qualified contextual evidence falls back automatically to the independent sport PMF;
- market evidence can alter the winner only once, upstream, with genuinely independent cross-book/chronology/context corroboration and no singleton reversal;
- no universal market weight, favorite/underdog quota, 50% floor, copied coefficient, or downstream side override;
- one coherent PMF regenerates decimal score, winner, ML, spread, and Total before exact-price EV/grade/stake;
- locks remain byte-immutable and the sole writer/sport lease/tracking boundaries remain intact; and
- replay reports every projection, probability, side, grade, actionability, and stake change, with both promotion and demotion paths and non-flat category coverage.

The candidate is evaluated first for structural and PMF coherence, then prediction quality where independently available, then exact-price economics. The same outcomes used for evaluation cannot select or tune its rules.

## Frozen r1 structural candidate

There are no settled NFL rows in the joined release-pure cohort. The first production candidate changes source ownership only and retains the incumbent fitted Week 1 PMF, residual corrections, and grade math:

1. Resolve provisional exact-price decisions from the target-free Week 1 sport PMF. A later-week game without the existing capture contract's fully target-free prior is ineligible for market arbitration and keeps the independent fallback.
2. Exclude the provisional Moneyline and Spread evaluated operator families from the margin anchor; exclude the provisional Total family from the total anchor.
3. For each axis, retain the latest complete conventional observation per independent operator family. Require at least three target-excluded families, and require their current landmarks to satisfy the existing 120-minute football capture freshness contract. Use their median line as the canonical axis anchor; the current single selected retail book no longer owns 75% of the forecast.
4. Retain same-family opening/current movement only from non-target families. With two or more retained trails, use the median target-free trail; otherwise movement is neutral. Filter verified Circa evidence when its family is an evaluated target. Public Playbook evidence is used only under its existing line-match and freshness rules and never supplies missing price breadth.
5. Run the incumbent market-evidence and residual-calibration builder once from the target-free axes. No weight or residual coefficient is re-fit. A coherent target-excluded market consensus may retain, attenuate, or cross the independent winner upstream; every later output is regenerated from that PMF.
6. Re-resolve exact evaluated tuples and repeat until the per-axis target sets are stable, bounded by the number of retained families plus one. A cycle, fewer than three qualified families on either axis, incomplete decisions, or unavailable target-free prior returns the independent sport PMF, then evaluates exact price downstream.
7. The final evaluated families must be absent from the corresponding margin/total forecast inputs. Moneyline value selection below 50% remains a downstream wager choice and is never labeled a predicted-winner flip.

The family-count and 120-minute boundaries are inherited from the existing multibook/capture contracts; the two-trail rule is the minimum cross-source chronology required to prevent one retail trail from receiving consensus authority. These are evidence-eligibility boundaries, not learned coefficients. Sensitivity will report two versus three retained families and 120 versus 240 minutes without selecting a boundary from outcomes.

## Outcome-blind production restriction after exact-runtime parity review

No NFL outcomes were available or joined. Exact-runtime parity exposed that step 6's independent fallback changes otherwise healthy grades and projections even though the defect being corrected is specifically evaluated-target self-validation. That broad fallback is rejected as outside the smallest source-proven correction. The production candidate therefore applies target exclusion only after a complete target tuple reaches a stable fixed point with at least three fresh target-free families on both axes. Insufficient or cycling evidence retains the incumbent coherent forecast and exact decisions byte-for-byte and stamps the fallback state; it does not claim target exclusion for that row. This preserves the existing model when the evidence contract cannot prove a replacement and leaves the live forward capture to qualify a future target-free correction automatically. No coefficient, threshold, outcome, or desired board count selected this restriction.
