# UCL BTTS No-discrimination audit and forward shadow declaration

Date: 2026-10-20

## Scope

This is a read-only audit. It does not change the live UCL model, probability,
pick, projection, grade, stake, writer, lock, or any stored member record.
The active releases remain the registry releases on `main`.

The question fixed before inspecting confirmation was whether the incumbent's
near-universal BTTS Yes direction could be corrected without degrading proper
probability scores or the coherent Match Result/Total/score projection.

## Incumbent defect

The frozen chronological blocks confirm a direction-selection defect:

| Block | Matches | Actual Yes | Predicted Yes | Accuracy | No recall | Brier | Log loss | AUC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Selection | 126 | 69 | 121 | 55.56% | 5.26% | 0.25069 | 0.69437 | 0.5652 |
| Confirmation | 63 | 37 | 61 | 58.73% | 3.85% | 0.23845 | 0.66943 | 0.6060 |

This is not evidence that the underlying event is usually No. It is evidence
that the incumbent barely discriminates which matches are No.

## Rejected shortcuts

- Plain probability recalibration lowered numbers but did not improve No
  discrimination.
- Letting the existing public-Elo Match Result adjustment reshape BTTS did not
  improve No recall or proper scores.
- A simple team-scoring hurdle improved probability scores in selection but
  did not identify more No outcomes.
- No forced balance, fixed count of No picks, or blanket threshold shift is
  permitted.

## Independent candidate result

A dedicated team-to-score hurdle was trained only on prior-match evidence. Its
inputs are each team's/opponent's scoring and concession occurrence, xG, shots
on target, big chances, shots inside the box, the incumbent scoring rate, and
home/away state. The BTTS probability is the product of the two independently
estimated scoring-occurrence probabilities, reconciled into the existing score
PMF while preserving Match Result, Over 2.5, and expected total.

The candidate passed the selection gate and materially found No outcomes on
untouched confirmation:

| Confirmation metric | Incumbent | Candidate |
|---|---:|---:|
| Predicted Yes | 61/63 | 46/63 |
| Accuracy | 58.73% | 60.32% |
| No recall | 3.85% | 34.62% |
| Team-score MAE | 1.18598 | 1.17892 |
| Brier | 0.23845 | 0.24894 |
| Log loss | 0.66943 | 0.69440 |
| AUC | 0.6060 | 0.5780 |

Because Brier, log loss, and AUC regressed, this candidate is rejected for live
publication. It is a useful feature family, not a production model yet.

## Market-reader evidence and forward declaration

Historical stored UCL line history currently has zero settled matches with a
qualifying multi-book BTTS snapshot at T-60, so a live BTTS market-reader flip
cannot yet satisfy the model-change safety gate.

For the current 18-match slate, the following shadow-only rule is declared
before settlement:

1. Require complete Yes/No prices from at least three named books.
2. Remove each book in turn and calculate a no-vig median from the remainder.
3. A market No exists only if every leave-one-book-out median has BTTS Yes below
   50%. No quota or board-balancing rule is used.

That rule identifies exactly two current shadow No candidates:

- Benfica at Roma: all six available books price Yes below 50%; full median
  Yes is approximately 47.51%.
- AEK Athens at Manchester City: all six available books price Yes below 50%;
  full median Yes is approximately 46.40%.

These are not live pick changes. Existing lock capture already stores the
book-level evidence required to settle this forward cohort; no second writer is
needed.

## Acceptance gate for a production repair

A future candidate must be frozen before outcomes and, on a sufficiently sized
forward cohort, improve all of the following versus the exact incumbent
release: BTTS accuracy, No recall, Brier, log loss, and discrimination/AUC. It
must also preserve or improve Match Result accuracy, Total accuracy, team-score
MAE, board count, and coherent score residuals. Evaluation is by exact release
and T-60 evidence only. Until that gate passes, the current live release stays
unchanged and the candidate remains shadow-only.

