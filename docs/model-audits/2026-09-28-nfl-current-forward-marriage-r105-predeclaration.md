# NFL current-season forward market marriage r105 predeclaration

## Scope and evidence boundary

This is a read-only release audit. It may not change production predictions,
grades, stakes, tracking, or member presentation by itself.

- Evaluation universe: immutable 2026 NFL Weeks 1-3 T-60 evidence only.
- Selection: Weeks 1-2 (32 settled games).
- Confirmation: Week 3 Sunday games with settled outcomes (15 games).
- The unresolved Monday game is excluded until settled.
- Historical seasons are supporting research only because they do not contain
  the exact Oddsphere pre-lock split, freshness, and sharp-book evidence.
- Missing evidence is unavailable, never a neutral or opposing vote.

## Frozen candidate arbitration

Each market starts from the r22 paid team-score distribution. The candidate
recomputes from that independent base on every run; adjustments never compound.

A directional market correction is authorized only when:

1. a verified same-book opening/current move of at least 0.5 points exists;
2. the Playbook money-minus-tickets gap is at least 8 percentage points and
   points in the same direction as the move;
3. a fresh verified named-book sharp split, when present, does not materially
   oppose the direction (10 percentage-point minimum); and
4. no contradictory equal-or-higher-quality signal is present.

When the qualified direction opposes the independent side at the evaluated
line, the candidate reflects the independent side probability across 50% and
re-centers the full discrete score distribution to that reflected probability.
This is a real direction change, not a capped point nudge. When evidence later
reverses or no longer qualifies, the distribution is rebuilt from the
independent base.

Circa is the preferred verified split source. Another named sharp-book split
may substitute when available. Playbook consensus remains a lower-reliability
fallback and can authorize a correction only with corroborating same-book
movement. Display persistence and member labels are outside this internal
audit and must remain unchanged.

## Sharp-book price/line confirmation

For Week 3, Circa and Pinnacle capture-only trails are evaluated separately as
a confirmation diagnostic. They may strengthen or veto a candidate only when
both have valid pre-lock chronological pairs and agree. They do not create a
rule in Weeks 1-2 because those trails were not captured there.

The known capture-boundary defect, where a quote returned seconds after the
run's initial `capturedAt` is marked future, must be repaired before any such
trail can affect production.

## Coherence and release gates

- One resulting joint distribution must generate expected score,
  representative score, Moneyline winner/probability, Spread side/probability,
  and Total side/probability.
- Candidate confirmation side accuracy must not decline for its market.
- Candidate confirmation Brier/log loss and score-center MAE must not
  materially regress.
- Both correction directions must remain possible; no favorite, underdog,
  Over, or Under quota is permitted.
- Flip counts, corrected flips, harmed flips, and no-change games are reported.
- Grade calibration occurs only after the final forecast is frozen. Best Angle
  and Lean must be monotonic in forward hit rate/reliability, contain no
  nonpositive-EV actionables, and include paired promotion/demotion counts.
- A flatter board is not a qualifying improvement.
