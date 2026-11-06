# Daily Edge play-grade intent

## November 6 owner-selected moneyline wager limits

The owner selected -500 or better as the inclusive Lean price limit after
identifying Ohio State -8000, Georgia -9000 and Xavier -8000 as inappropriate
Leans. Moneyline prices worse than -500 become complete priced No Plays, even
when the predicted winner is very likely or nominal EV is positive. Best Angle
requires -200 or better; -235/-300 can qualify as Lean. These boundaries only
restrict the otherwise evidence/risk-qualified tier. A better real price may
restore eligibility, while resistance can still make a pick Watch. No quota,
forced side flip or compensating promotion is introduced.

Native current paths: NBA grade `nba_grade_policy_2026_11_06_r31_moneyline_wager_price_boundaries`;
CBB decision/interpreted R13, grade R12, publisher R53, adapter R36, tracking R39;
CFB decision R62, grade R33, production R44, writer R153. The shared pure
`moneyline_price_policy_2026_11_06_r1_owner_boundaries` is qualification only.
Numerical models, calibrations, probabilities, chosen sides, exact contracts,
source tapes and provider budgets/cadence stay unchanged. CBB numerical R7 and
its private artifact remain active; the separate numerical candidate stays held.
NBA model R36/marriage R38 and CFB model R28/probability R30/calibration R34 stay
unchanged. Existing sport-scoped leased writers remain the only writers.

A No Play retains raw confidence, winner prediction and actual price, but has
null recommendation confidence and no wager eligibility in member/tracking
contracts. CBB old decision R12/grade R11 and every earlier released family,
NBA R30/R29/R28, and CFB R61/grade R32/production R43 retain exact stored reader,
writer and official-tracking semantics. No current price rule is applied to a
locked payload. A game that locks before rollout keeps its old grade.

Frozen 21:13/21:02/21:10 snapshots show CBB today 177 markets:
54 Lean/86 Watch/37 No Play -> 38/81/58 (16 actionable removals, five Watch ->
No Play). NBA today 27: 1 Best/6 Lean/20 Watch -> 0/7/19/1 No Play; Atlanta
-300 Best -> Lean, and one already nonactionable steep Watch -> No Play.
CFB rolling 300: 72 Lean/105 Watch/22 Best/101 No Play -> 69/94/22/115:
three future actionable removals and eleven Watch -> No Play. Today's five
CFB games retain all 15 grades. All other captured sports have zero actionable
violations; they are audited only, with no unversioned reader override.
Forecast/price/selection changes are zero. Locked state at actual deployment
may reduce the applicable scope. The owner-directed contraction is explicit;
paired same-forecast improved-price recovery is tested rather than invented
plays. This is product-policy qualification, not holdout accuracy evidence.

Evidence: `docs/audits/2026-11-06-moneyline-wager-price-boundaries-impact.json`.
Full model gate, affected focused/legacy lock tests, types/build, fresh-main
protected PR and actual normal-writer/release/source/reader/immutable-lock proof
remain mandatory before completion. The prior NBA source-read failure repair
below remains in the same pending release.


## November 6 NBA Best Moneyline prices and source-read integrity

Owner-directed NBA grade R31 requires a Moneyline price of -200 or better for
Best Angle; -235/-300 can remain Lean, with Spread qualification independent.
The exact prior R30/R29/R28 audits and all stored locks keep their old policy.
Model R36 and marriage R38 remain unchanged. No board quota is introduced.

Publication `nba_reader_publication_2026_11_06_r1_complete_reads` rejects explicit
price/split lookup failures before new decisions. Scoped high-water completion
is required across short backend pages; malformed frontiers or premature empty
pages are failed reads, not neutral markets. Future private captures include
the compact range/count proof. NBA rebuild failures return
503, retaining the previous published payload/as-of instead of independent-only
or empty fresh replacements. Successful empty reads remain legitimate absence,
with no supporting-book gate. A successful later read restores normal publishing.
Safe phase codes enter the existing cron log; successful NBA snapshots carry
this publication identifier. Healthy numerical forecasts/prices and the sole
sport-scoped prediction pipeline, calls/cadence/lease remain exact.

The crowded19:46 board is reproduced27/27 under a failed price read using1724
historical split rows; exact prior SQL failure is inferred, not directly logged.
The original Best-only27-market replay changed one Best to Lean with no
actionable removals. The final -500 policy and complete NBA/CBB/CFB count
impact are declared above. Paired source recovery/price promotion, lock precedence, focused/full
checks, protected current-main PR and natural live proof are mandatory.
See `docs/model-audits/2026-11-06-nba-price-boundary-source-publication.md`.

## November 6 owner clarification — confidence leads the recommendation

The owner explicitly clarified that Lean can be a confident outcome prediction
at an unattractive or nonpositive-value offered price. Price contributes to the
tier; it does not unconditionally override outcome confidence. Best Angle can
reflect stronger outcome confidence and/or better price quality after the full
market interpretation. This supersedes the universal positive-EV Lean meaning
in the November 5 text below, which remains historical release documentation.

The first scoped repair is CBB R11 decision/R10 grade and NBA grade R29. Both
retain their actual final model probability and exact nominal price EV. They
permit a confidence-led Lean inside the actual same-book paired-price margin;
price disagreement beyond that envelope still matters. CBB also checks its
fitted location uncertainty and declared adverse-case risk. NBA retains the
existing opposing-evidence composition. These are explicit product policies,
not outcome calibration or a promised higher hit rate. Existing value-led
qualification and stronger Best criteria remain; no desired board count is used.

The final joint forecast already incorporates qualified market evidence. Do
not add a second probability, score correction or split bonus at grading.
Keep bad-price EV honestly negative on a confidence Lean; never relabel it as
positive value or invent professional confirmation. Existing locked records
retain every original field and their original grade semantics.

Sport-specific active-path checks and frozen-input board impact are recorded in
`model-audits/2026-11-06-confidence-led-market-grades.md`. No uniform numerical
policy is implied for historical or inactive sports.

November 5 Lean-quality amendment: the owner subsequently rejected treating
every positive point-estimate EV as an adequate Lean. For the scoped CBB R8/R7
candidate, Lean/Best eligibility additionally uses an explicit fitted-location
sensitivity and one-adverse-resolved-case recommendation-risk policy. Marginal
positive EV can be Watch; an impractical return unable to support the declared
risk can be No Play even when nominal EV is positive. Preserve nominal p/EV and
the complete forecast. This is a declared conservative product policy, with a
data-sized reserve, not a confidence guarantee, source checklist or play quota.
See `model-audits/2026-11-05-cbb-contextual-lean-quality.md`; earlier rules below
describe the immediately preceding R7/R6 family and existing immutable locks.

Owner clarification: November 5, 2026. This defines shared product meaning;
it is not authorization to copy one sport's numerical calibration into another.

The contextual forecast interprets the independent forecast and qualified market
evidence to produce one coherent score distribution and selected outcome. Grades
then assess that selected prediction at its actual offered price. Attractive
odds cannot choose a different predicted winner. A grade cannot create another
forecast, count pushes as wins, or silently change the forecast probability.

| Label | Shared meaning |
| --- | --- |
| Best Angle | A top-conviction outcome prediction with positive estimated value at a worthwhile straight-bet price. An expensive favorite is not automatically a top play because it is likely to win. |
| Lean | A positive-value prediction below the top tier. A confident, expensive favorite can qualify; the label alone makes no statement about a combined parlay's probability or value. |
| Watchlist | A completed prediction near break-even, or a favorable forecast relative to paired fair pricing whose offered advantage is consumed by vig. It may merit a better-price watch; its probability remains informational. |
| No Play | A completed, priced prediction with clearly negative offered value and no resolved forecast advantage over the paired fair price. Keep its predicted side and probability; no wager is implied. |
| Held / operational exception | Required forecast or execution evidence is incomplete or invalid. Do not disguise a failed evaluation as an ordinary lack of edge. |

Professional-book evidence can confirm, resist, strengthen or change the final
forecast and thus its probability and grade. It is not a mandatory count of
signals, proof of bettor identity, an automatic Best Angle, or a reason to ignore
contradictory evidence. Keep actual source/action attribution separate from the
grade encoding. An encoded grade, explicit verdict, shared presentation and
tracking record must agree.

Numerical tier boundaries must be explicit product policies. They are not
scientifically learned accuracy guarantees and must not be called threshold-free.
Numerical integration error is separate from a business edge reserve: floating
point dust at break-even cannot promote a pick. Do not use the number of desired
plays to choose a policy or tune scores to fill grade categories.

## Applying the intent sport by sport

Before changing an existing model, identify its authoritative forecast, grade,
adapter and tracking paths and current release identifiers. Separate genuine
calibration or contract differences from obsolete restrictions and contradictory
consumer encodings. Report promotions, demotions, market mix, selected-side
changes and price coverage on the same inputs. Preserve exact stored locks and
complete the repository's release and live-verification protocol.

The CBB candidate applies positive exact-price EV eligibility, at least 62%
unconditional selected-win probability for Best Angle, and a Best Angle price of
-200 or better. Positive-value expensive favorites remain eligible for Lean.
The 62% boundary reuses the existing NBA product confidence bar; the -200 price
boundary follows the NFL approach and the owner's expensive-favorite preference.
There is no fixed 3%/8% EV reserve or mandatory professional-action confirmation.
For the No Play/Watch distinction, compare pWin-qFair*(pWin+pLose), with qFair
from the actual paired offer. This respects push refunds without inflating win
confidence. No extra extreme-odds cutoff is introduced: a likely winner at
-2000 can be No Play, Watch or Lean depending on its actual forecast and price.
Complete priced No Plays retain forecast accuracy but imply no wager units.
This is a CBB candidate policy, not an already deployed all-sport standard.

NFL, NBA, CFB, NHL, MLB, WNBA and soccer require their own active-path review
before any corresponding production change. Their present policies must not be
described as uniform merely because they use the same member labels.

The initial bounded active-path inventory is recorded in
[`model-audits/2026-11-05-daily-edge-grade-policy-inventory.md`](model-audits/2026-11-05-daily-edge-grade-policy-inventory.md).
It distinguishes the reproduced NBA terminal price-guard bypass from deliberate
alternate promotion routes and existing sport-specific value exceptions. Fixing
the demonstrated bypass does not justify deleting every contextual promotion
route or changing qualified forecasts, probabilities or historical grades.
