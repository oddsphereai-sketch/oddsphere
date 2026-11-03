# UCL relative market interpretation and confidence grading

Starting base b7e7d7e0fdb9f37ef95ea8841185718877ff6ea8; isolated
codex/ucl-atomic-history-families-20261103. Scope expanded before publication
from source-history continuity to the owner's correction of R17's semantics.

## Reproduced product defect

R17 correctly consumed native contracts but imposed the current book's fair
probabilities as absolute forecast constraints. This erased independent edges
and then graded most resulting estimates below the execution price after vig.
The owner rejected this: "we're not supposed to pull things towards the book"
and "being correct is the most important thing." A movement towards the model
can confirm a good prediction even when model60% versus market60.5% does not
clear a point-estimate value gate. The prior report's11Leans was the entire
multi-day board, not today. Frozen17:17→17:47 receipts show today3→1Lean;
tomorrow10→10. Across both dates there were2promotions/4demotions, with changing
quotes as well as policy, so this is not an isolated accuracy experiment.

The three missing prices were restored by the normal17:47refresh. All54 main
markets were priced. No extra approved manual source requests were needed.

## Corrected runtime contract

The ORIGINAL independent joint distribution is the starting statistical law.
Current book levels provide context; they are not endpoints the model must fit.
Only complete observed same-physical-book price paths provide numerical
innovations. Named source, exact fixture/contract and current native identity,
original current quote clock, paired historical observed-capture clock and
strict chronology remain distinct. Baseline is the first complete state on
the same ET day, or the last complete state on an earlier ET day when absent.
Unknown/partial/conflicting states are never stitched or treated as zero.

1. Match Result compares normalized current versus baseline three-way prices
   and applies their relative likelihood ratios to the original result masses.
   The old absolute late-consensus logarithmic blend is removed.
2. Total converts each actual whole/half/quarter contract to its settlement
   share and corresponding Poisson market-mean coordinate. The mean ratio
   tilts the ORIGINAL joint law by r^(home+away); its resulting mean is the
   relative target, not the current book's mean. Cross-line conversion is an
   explicit modeling approximation, never an executable2.5 price substitution.
3. BTTS applies the observed market-odds ratio to the ORIGINAL BTTS odds.
4. Relative marginals reconcile jointly in one score law, avoiding serial
   double counting of the same news. Complete held/flat axes retain their
   original marginal when another axis moves; unknown axes are unconstrained.
   All-flat/pure-vig/full-buyback states retain the exact independent law.
   Infeasible combinations report unsatisfied axes rather than claiming all
   evidence was applied.

One physical book supplies each axis's selected path; copied feeds and alternate
contracts are not extra votes. Receipt includes source roles, current contract
outlook, baseline/current states, latest informative leg, retrace/roundtrip,
conflicts, membership count/hash and bounded audit stops. Same execution-book
PATH evidence can inform a forecast; its current quote does not thereby become
independent value confirmation. There is no fixed odds blend, artificial
probability nudge, forced side or board-count target.

## Grades

Existing positive-value Lean confidence floors remain55% binary and60% Match
Result. A genuinely aligned movement-confirmed lane can also qualify a Lean
without strict positive point EV when the estimate remains within the actual
paired-book vig envelope. The envelope derives from quoted economics, not a
fixed arbitrary probability-gap allowance. A huge negative-value discrepancy
cannot qualify merely because prices moved in the same direction. EV remains
reported honestly; a confidence-led Lean is not labeled positive-value.

Lean prices must be−350 or better. Best requires clean originator confirmation,
positive exact-price EV, confidence60% binary/65% Match Result and price−200 or
better. A−300quote cannot become Best. No cap on number of plays is imposed.
Missing prices remain operational holds; no stake/category/layout is added.

## Durable evidence

R17's per-side flat compaction could lose an unchanged opposite after a third
capture. UCL now persists/reads actual source families atomically across1X2,
DC,Total andBTTS, including unchanged sides at their real captured clocks.
Exact repeats are idempotent. When authoritative allBookPrices are supplied,
current display trails are not re-journaled as newer source captures. Explicit
provider openers keep their real origin. Prior partial records stay unchanged;
no history or locked forecast is fabricated or rewritten. EPL defaults remain
unchanged. Existing leased writer/cadence/provider ceilings remain authoritative.

## Verification and limits

Functional cases must prove flat-market identity despite a large static book
gap; correct relative direction/possible flips; exact native settlement/line
compensation; simultaneous cross-market targets; held/retrace/unknown states;
source identity/chronology; actual family persistence/reload; and promotion/
demotion economics in all three primary markets. Existing locked writer and
reader precedence tests remain mandatory. No long historical tuning/replay or
held-out win-rate claim is introduced. Evaluate forward outcomes by exact
release and lock timestamp. Report TODAY and TOMORROW separately after normal
production publication. Keep all previously locked payloads exact.

## First-pass lock verifier follow-up

Fresh base267b692213a7dd23027e46d079c68e598c27a034. The19:04scheduled lock
run stored all28rows for seven due fixtures, but its outer identity check
compared full-precision writer expectations with rounded NUMERIC columns
using strict equality. All28stored captures already passed the inner declared
storage-precision checks; every fixture had four markets and an identical
stored projection. No record correction is authorized or needed.

Member lifecycle R17 applies the same half-storage-quantum comparisons to
fresh model/market probabilities, edge and EV. Other scalar fields and the
entire stored snapshot JSON retain exact equality. This changes verification
only; model R18, calibration R21 and score R9 stay unchanged. Functional cases
cover first-pass fresh inserts without writer IDs, outside-quantum rejection,
exact capture/evidence precedence and nonmutation. The stored locked tuples
must remain byte-for-byte unchanged through publication.
