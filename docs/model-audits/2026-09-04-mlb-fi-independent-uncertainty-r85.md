# MLB FI independent-only uncertainty correction — r85 predeclaration

Date: 2026-09-04

Status: pre-outcome candidate declaration; no production behavior changed by
this checkpoint.

## Source-proven defect

The first fully locked r84 slate converged from two interim Toss-Ups to 13
NRFI, 3 YRFI, and zero Toss-Ups. The r84 source correctly restored the old
high-quality 65% independent / 35% market blend for accepted target-excluded
multi-book evidence. It also correctly retained r80's evaluated-book
exclusion. Those two contracts do not recreate the old decision distribution
for evaluation-only rows: a singleton Bally pair is now independent-only,
whereas the historical model allowed that same evaluated quote to pull the
posterior toward the center.

A SELECT-only, outcome-free inventory of immutable locked records establishes
the actual historical board shape. From 2026-07-11 through 2026-08-08, the
successful FI head emitted 322 forecasts: 171 NRFI, 76 YRFI, and 75 Toss-Ups
(23.3%). Its previously reported 238 settled priced picks excluded Toss-Ups
and therefore was not a three-way board denominator. Across the broader
pre-r61 window through 2026-08-19, the shape was 249 NRFI, 110 YRFI, and 112
Toss-Ups among 471 forecasts (23.8%).

This correction will not re-admit the evaluated sportsbook into forecast
consensus, impose a Toss-Up quota, or change a locked record. Exact evaluated
prices remain downstream EV/grade inputs only.

## Frozen cohort and candidate family

The immutable row identity is `(game_id, locked_at, probability-head/release)`.
Duplicate identities, launch rows, rows without a locked timestamp, and rows
without a known first-inning outcome are excluded. Candidate inputs are only
fields stored before the outcome: `independent_p_nrfi`, the incumbent posterior,
data-quality tier, missing-count, starter-source provenance, and market-source
provenance. Game outcomes and settlement rows are joined only after this
declaration is committed.

Chronological partitions are fixed before the outcome join:

- training: 2026-06-07 through 2026-07-10;
- validation: 2026-07-11 through 2026-07-31;
- untouched confirmation: 2026-08-01 through 2026-08-19;
- later releases: reported separately and never pooled into model selection.

The candidate family is deliberately small:

1. incumbent identity probability with the existing 48%/52% neutral band;
2. a training-only Platt calibration of the independent FI probability, with
   the existing 48%/52% neutral band retained;
3. identity independent probability with symmetric diagnostic neutral bands
   of 47.5%/52.5%, 47%/53%, 46.5%/53.5%, 46%/54%, and 45%/55%.

The diagnostic bands are reported as an accuracy/coverage curve; they are not
eligible merely because their Toss-Up count resembles history. The production
candidate is eligible only if its parameters are determined entirely on the
training partition, prediction proper scores (Brier and log loss) do not worsen
on both validation and untouched confirmation, directional accuracy improves
or remains stable without collapsing coverage, NRFI and YRFI errors are both
reported, and current-board behavior remains coherent. A fitted calibration
that fails those gates is rejected rather than tuned on September outcomes.

## Invariants and reporting

- The independent FI run distribution remains the prior and the evaluated
  quote never validates its own forecast.
- Accepted target-excluded multi-book r84 forecasts remain byte-identical
  unless a separately validated probability calibration explicitly qualifies.
- A single coherent posterior owns event probability, decimal expected FI
  runs, and NRFI/YRFI/Toss-Up classification.
- Toss-Up is a true null-side, non-actionable result. Missing evidence is
  neutral and never itself a hold.
- Exact offered price controls EV and grade after the forecast; it cannot flip
  or manufacture a side.
- Locked rows are byte-immutable. The sole MLB writer, sport lease, provider
  paths, query budgets, member sync, tracking, and settlement remain unchanged.

The final report must show Brier, log loss, calibration gap, directional
accuracy, NRFI/YRFI/Toss-Up counts, per-date zero-Toss-Up frequency,
promotions/demotions, actionable counts, and exact-price ROI separately for
each release-pure partition. Every current-board transition must be listed.

## Chronological result

The release-pure SELECT-only audit joined outcomes only after predeclaration
commit `4e89d44f`. It covered 912 eligible immutable game-lock-release rows.
The train-only Platt candidate was rejected: despite improving untouched Brier
from .24949 to .24810 and log loss from .69225 to .68929, it worsened validation
Brier from .24752 to .24899 and log loss from .68875 to .69119. r85 therefore
does not alter the independent probability, decimal expected runs, or any
proper score.

The predeclared 45%-55% independent-only uncertainty band cleared the
directional selection gate:

| Partition | Existing 48%-52% accuracy / N / Toss-Up | 45%-55% accuracy / N / Toss-Up | Brier / log loss |
| --- | ---: | ---: | ---: |
| Train, Jun 7-Jul 10 | 55.7% / 370 / 71 | 56.0% / 282 / 159 | .24915 / .69182 unchanged |
| Validation, Jul 11-31 | 57.1% / 184 / 34 | 59.3% / 145 / 73 | .24752 / .68875 unchanged |
| Untouched, Aug 1-19 | 52.6% / 215 / 38 | 53.4% / 161 / 92 | .24949 / .69225 unchanged |

NRFI and YRFI were not collapsed into one score. In validation, candidate NRFI
accuracy was 59.4% and YRFI accuracy was 59.0%; in untouched confirmation they
were 53.1% and 54.2%. Exact-price economics are limited to rows where the
counterfactual candidate side equals the stored locked side because historical
opposite prices are not always available. On that honest subset, validation
was +16.554 units over 135 prices (12.3% ROI) and untouched was -8.761 over 156
(-5.6%), versus -6.0% for the narrower identity-band subset. Economics did not
select the forecast rule.

The 45%-55% counts above are an all-independent diagnostic. Production applies
the band only where no target-excluded pair exists. The paired promotion path
is the unchanged multi-book rule: independently corroborated rows continue to
use the historical 48%-52% band. The focused regression proves that the same
53% posterior is a Toss-Up without independent market corroboration and an
NRFI prediction with it. Thus the candidate can promote a corroborated signal
without using the evaluated quote or manufacturing actionability.

## Identical-input current-board impact

The bounded comparator queried no outcomes or providers and replayed the
persisted September 4 authoritative FI audit tuple. At capture it contained 16
games. r84 was 12 NRFI / 3 YRFI / 1 Toss-Up with 12 actionable grades. r85 is
11 NRFI / 2 YRFI / 3 genuine Toss-Ups with 10 actionable grades. There are zero
probability changes, zero decimal-projection changes, zero side reversals, zero
actionable promotions, and two actionable demotions. The existing
target-excluded corroboration path retains marginal multi-book directions and
is the tested paired promotion rule; the current board happens to add no new
promotion relative to r84.

Only two rows change:

| Game | r84 tuple | r85 tuple | Exact evaluation evidence retained |
| --- | --- | --- | --- |
| MIL@CIN | NRFI .5302228641 / .6344578625 xFI / Lean | Toss-Up / same probability and xFI / non-actionable | Bally Bet NRFI +100 / YRFI -132 |
| ATH@SEA | YRFI with P(NRFI) .4640850442 / .7676874586 xFI / Lean | Toss-Up / same probability and xFI / non-actionable | Bally Bet NRFI -143 / YRFI +112 |

TOR@KC was already a true Toss-Up at P(NRFI) .5069524451 in the captured r84
tuple and remains one. A Toss-Up has no selected bet side or selected price;
the exact two-sided evaluation pair remains in the audit as downstream
economic evidence and cannot make the null forecast actionable. No locked
prediction record is rewritten. The candidate affects only future unlocked
writer tuples and future locks.

Rollback is r84 probability head v9 / market-calibration policy v6. Live
acceptance requires the first eligible natural writer to stamp r85/head v10/
calibration v7, retain target-excluded multi-book identity, publish explicit
null-side Toss-Ups coherently in game predictions and member records, preserve
all pre-r85 locks byte-for-byte, and release the existing MLB pipeline lease.
