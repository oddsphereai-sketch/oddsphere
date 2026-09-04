# CFB holistic confidence and price-portable execution predeclaration

Date: 2026-09-04  
Status: frozen shadow-candidate contract before runtime edits  
Scope: future unlocked CFB Moneyline, Spread, and Total decisions only

## Problem

The active grade ladder uses multiple conjunctive price, EV, edge, and line-size gates. A tuple can
therefore fall from an otherwise credible prediction to Watchlist or No Play because one continuous
input misses one hard cutoff by a fraction, or because a Spread exceeds an arbitrary absolute-line
cap. That conflicts with the product meaning of Best Angle and Lean as forecast-confidence labels.

The Massachusetts +29.5 evidence exposed the failure but does not define the correction. Its last
complete pre-lock tuple was 53.4796% with a real BetRivers -109 quote, +3.4796pp target-excluded edge,
and +2.5434% exact-price EV. Circa supplied 74% tickets / 91% money at +29, while the context book
moved from +29.5 to +29 and Playbook remained a lower-authority mixed input. The row stayed Watchlist
because it exceeded a 24-point cap and narrowly missed separate 54% and 3% EV gates. The later T-60
row was held for capture lateness, not because the model changed sides. No historical row will be
rewritten or retroactively promoted.

## Frozen candidate semantics

1. A complete coherent model tuple receives one continuous confidence score. The model probability
   is primary. Fresh, exactly identified Circa money-versus-ticket divergence, Playbook divergence,
   and same-book line/price movement add bounded signed contributions. Supporting and resisting
   evidence offset one another by magnitude; no single ordinary evidence channel is an automatic
   veto or automatic flip.
2. The confidence score has only the category boundaries needed to render Best Angle, Lean,
   Watchlist, and No Play. It has no sportsbook-price band, EV floor, market-edge floor, team rule,
   or absolute Spread/Total-line cap. Price changes therefore cannot change the confidence grade.
3. Source authority remains asymmetric: verified Circa is strongest, same-book movement is next,
   and Playbook public consensus is lowest. Missing, stale, future, or identity-mismatched evidence
   contributes zero and remains visibly unknown; it is never fabricated as neutral.
4. Movement direction is selected-side correct. A favorite laying fewer points or an underdog
   receiving fewer points is resistance; the opposite is support. Price movement contributes only
   when the same sportsbook and selected outcome form a chronological pair.
5. Every evaluated recommendation retains its named sportsbook, line, American price, observation
   time, target-excluded fair probability, edge, and exact-price EV. Execution is separate:
   non-negative exact-price EV is `bet`, negative EV is `shop`, and missing/stale/incoherent price is
   `unavailable`. `shop` never enters stakes, ROI, or actionable-wager tracking and cannot erase a
   Best Angle or Lean confidence label.
6. Integrity, identity, required-consensus, health, and immutable T-60 timing failures remain holds.
   The candidate does not weaken those safety boundaries, alter the authoritative PMF, add a writer,
   increase provider calls, mutate locks, or touch MLB first inning.

## Frozen initial score mapping

- Model component: selected-side coherent PMF probability on a 0–100 scale.
- Circa contribution: signed money-minus-ticket gap, linearly bounded at ±2.5 confidence points once
  the absolute gap reaches 20 percentage points.
- Same-book movement contribution: selected-side-correct line and fair-price movement, bounded at
  ±1.5 confidence points.
- Playbook contribution: signed money-minus-ticket gap, bounded at ±1.0 confidence point at a
  20-point gap.
- Total evidence contribution is bounded at ±4 confidence points.
- Display tiers: Best Angle at 60+, Lean at 55+, Watchlist at 51.5+, otherwise No Play.

These are one continuous score and three presentation boundaries, not conjunctive eligibility
cliffs. They are frozen before the board replay. The replay may reject the candidate; the same
September 3 results that revealed the defect cannot be used to retune these values and then be
reported as independent validation.

## Required evidence before publication

- Compare incumbent and candidate on the same complete eligible board, reporting every grade
  transition, market mix, side change, confidence-score distribution, Bet/Shop/Unavailable count,
  and exact UMass-like large-spread cohort.
- Report September 3 wins and losses only as diagnostic counterexamples, not holdout proof.
- Run focused CFB tests, TypeScript, the full model-change suite, build, latest-main integration
  safety, protected PR checks, and live writer/reader/release verification.
- If chronological independent validation is insufficient or the candidate causes an unexplained
  actionable collapse/expansion, retain it in shadow/audit mode rather than changing live grades.

## Rollback

Rollback restores the complete evidence-identity-continuity release set while preserving all new
append-only evidence and every immutable locked prediction. Mixed releases, missing execution
prices presented as wagers, a side/probability mismatch, writer failure, or board instability blocks
publication.
