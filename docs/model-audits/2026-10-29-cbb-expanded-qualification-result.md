# CBB expanded private qualification audit — October 29, 2026

## Decision

Continue private research. Do **not** activate CBB, a new score head, or a
Best Angle/Lean/stake policy. This audit found a credible *retrospective
Total-pick direction* to investigate, but not a qualified three-market product
or the requested sub-10 Total / near-6 margin mean absolute errors. No live
writer, model registration, member record, locked payload, or other sport was
changed.

This task continuation began from remote `main`
`48ad667d5e1bc585a2bf4a6281a6fbcff2d6c1de`; before updating the private
draft branch, the latest remote base was resolved again and integrated under
the repository's concurrent-work protocol.

The important process correction is that `not qualified` is a research state,
not an instruction to stop. The expanded data falsified several attractive
grade probes and isolated a narrower score improvement worth testing further.

## Evidence and chronology

Read-only, bounded historical BDL opening-odds capture and Owls exact-fixture
catalog corroboration added 717 games to the prior 353-game exact-opening
cohort: 1,070 distinct games in the already-opened 2025–26 season, each with
all three target markets, complete pregame statistics, and a same-cutoff
forecast. Reference evidence is separately target-family-excluded when
available; the no-reference cases remain in the baseline and receive no
market-head correction. The chronological
periods are early before February 15 (433 games), February 15–28 selection
(408), and March 1 onward later (229). The score-head selection subset is 369
games because 39 forecasts preceded the fitted head's availability; the
post-selection refit uses 199 later games, excluding 30 before that new head
was available. No excluded forecast is retroactively adjusted.

The bounded captures used 100 BDL odds requests and 45 Owls catalog requests
across three predeclared date sets. Source receipts and feature rows remain
local under `/private/tmp/oddsphere-cbb-data`; none are production data. An
Owls fixture match independently corroborates home/away orientation but does
not prove every BDL book's exact named-side quote. This cohort observes
opening-price context; it does **not** reconstruct historical within-book
movement, splits, or bookmaker leadership. Results are retrospective, from
one already-opened season, not a pristine holdout or a claim about live sharp
money.

## What happened to picks

The current independent r2 forecast on the 369/229 matched selection/later
games was 251/148 correct Moneylines, 199/130 Spreads, and 183/111 Totals.
Its margin MAE was 8.99/9.48 points and Total MAE 13.00/13.05 points. The
matched exact-price all-Total hypothetical one-unit return was -19.45/-16.64
units; this is not official tracking or a playable policy.

The predeclared depth-2, 40-round tree market head, applied to **Total only**,
recomputed both team scores from the new Total and the unchanged independent
margin. Moneyline winner/probability and Spread margin/side therefore remain
the same by construction. On selection it corrected 63 Totals and harmed 57
(189 correct, +6); on later games it corrected 32 and harmed 23 (120 correct,
+9). The 80-round variant gained 5 and 10 respectively. With a chronological
refit through February 28, the 40-round variant gained 3 of 199 later picks
(23 corrections/20 harms), while 80 rounds gained 7 (28/21). Those gains are
not a claim of consistently beating the sportsbook: the 40-round Total MAE
was unchanged on selection and worsened from 13.05 to 13.12 later; one
matched-score refit worsened MAE, and the all-game selection return remained
negative. The selection improvement was also not uniform across the three
source-date sets (one set had 16 corrections/19 harms).

The learned tree used more than a single market-difference threshold: its
first-stage splits included reference Total dispersion, Moneyline disagreement,
independent strength, and interaction context. This is still an opening-price
model, not a validated movement reader. It never infers unobserved splits.

A separate proper-log-loss head trained directly for conditional ML, Spread,
and Total outcomes showed why full-score authority is not justified. Its
weak-penalty full head lost 5 ML and 5 Spread decisions on selection while
gaining 3 Totals; the Total-only ablation gained 3 Totals on selection and 7
later without moving the other markets. That is directionally supportive of
the narrower Total lane, but weaker than the tree and not a general resolver.
Plain reference-only side substitution also did not beat the independent
Moneyline or Spread on paired games; it improved early Totals but lost on
March Totals. A generic market flip is rejected.

## Grades are a separate problem

Fixed thresholds derived from the original early 151 games looked promising
on smaller cohorts but failed after date saturation. A simple unapproved
Moneyline Best Angle probe was 33–32 and -7.56 units on 65 later bets; Spread
Best was 32–24 and +4.97 units on 56 later bets but only 8–11 and -3.76 units
on the added March subset. Total Best was 31–29 and -0.84 units on 60 later
bets; Total Lean was 14–28 and -15.28 units on 42 later bets, including 7–12
in the added March subset. All are retrospective one-risked-unit probes, not
approved grades. No candidate board-count or promotions are authorized;
current CBB grades remain unpopulated, so there is no flattening to conceal.

## Qualification still needed

1. Keep the private Total-only score candidate separate from any grade/stake
   authority. Reproduce it on a truly later season or a forward locked
   prospective cohort with actual receipt-time, named-book source parity.
2. Continue Moneyline and Spread loss analysis against independent features,
   roster/venue/matchup interactions, and market context rather than forcing
   either to follow a market side. Any changed margin must beat the incumbent
   on both picks and calibration without hiding harmful winner flips.
3. Rebuild grade calibration on exact executable prices *after* the score
   candidate is chosen. Require chronological, release-pure Best and Lean
   results and report their counts, promotions, demotions, and odds bands;
   never manufacture actionables to fill the board.
4. Verify the November live-source path separately. Archived openings cannot
   certify current movement/splits or professional-book availability.

Reproduction (private, read-only):

```sh
node --import tsx scripts/operator/audit-cbb-date-diverse-market-sides.ts
node --import tsx scripts/operator/audit-cbb-date-diverse-score-head.ts
node --import tsx scripts/operator/audit-cbb-date-diverse-joint-head.ts
node --import tsx scripts/operator/audit-cbb-grade-readiness.ts --cohort=expanded --train=baseline-early
node --import tsx scripts/operator/audit-cbb-outcome-calibrated-grades.ts
```
