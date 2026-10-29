# CBB November 1 launch candidate — predeclaration

Status: **private candidate; no production authority or publication yet**.

Owner direction on October 29: deliver a fully graded, sharp-informed college
basketball Daily Edge for the November 1 opener. A forecast-only or deliberately
flat board is not the requested product. This direction does not authorize
inventing missing observations, rewriting locks, or describing retrospective
results as prospective accuracy.

## Integration boundary

- Production base at task start: `origin/main` commit
  `62d6764d925fdd0ef94bac2e00dc9ec9960f3b05`.
- Work occurs on the dedicated `codex/cbb-nov1-launch-20261029` branch and
  worktree. The private CBB candidate branch was merged into this branch; the
  shared primary checkout and existing draft branch are untouched.
- Sport: CBB. Markets: Moneyline, Spread, Total, with one coherent two-team
  score distribution. Other sports, their predictions, grades, stakes,
  snapshots, and locked records must have zero behavior change.
- Current CBB state: r2 independent score candidate, diagnostic r5/r17 market
  experiments, no authoritative writer, grades, stakes, locks, tracking, or
  member publication. No previous CBB release can be silently reinterpreted as
  a live champion.

## Non-flat board and accuracy contract

1. Evaluate Moneyline, Spread, and Total separately at the exact selected
   consumer book and line. Report W/L/push, units at the recorded price,
   probability calibration, release/date blocks, and odds bands. Historical
   opened results are diagnostic and must be labeled as such.
2. A grade proposal must report the **entire** board: Best Angle, Lean,
   Watchlist, No Play, and operational holds by market, day, and price band.
   Report promotions, demotions, and net actionables versus the prior policy.
   A rule that creates safety only by concealing plausible plays is rejected;
   a quota that forces weak plays into Best Angle or Lean is also rejected.
3. The sharp reader must preserve exact same-book chronology, named side,
   target-book exclusion, source/receipt times, and missingness. It must show
   when it confirms, corrects, or rejects the independent pick, including
   corrections and harmful flips. Observed movement is not automatically
   predictive authority.
4. Every published game must have verified identity, start, venue, current
   inputs, availability status, and complete fresh two-sided executable
   prices. Missing inputs are an operational hold, not a fabricated model
   No Play. Scores, probabilities, market sides, grades, and displayed lines
   must reconcile.
5. The sole CBB prediction writer must use `prediction_pipeline:cbb`; T-60
   locking, immutable stored records, legacy-first reader precedence, official
   W/L/push tracking, cached member snapshot parity, and bounded load are
   required before release.

## Decision and release gate

The goal is a useful, graded November 1 board, not an arbitrary statistical
significance threshold. Still, the existing historical grade probes and
three-market reader are not qualified for direct promotion. A candidate must
be implemented and compared as a complete board before any activation. If
the first November 1 slate lacks sufficient sharp-book or split observations,
the evidence gap must be shown honestly; retail movement may not be called
sharp money. Prior-season roster context cannot be presented as verified
current availability.

No live grade, stake, or member prediction is changed by this predeclaration.
Before publication, resolve and integrate the latest `main`, run focused CBB
tests plus `npm run verify:model-change` and integration safety, review the
remote PR tree, then verify production release, source coverage, lock/reader
immutability, tracking, board counts, and the next scheduled refresh.

## Owner-approved provisional grades — private candidate only

On October 29 the owner confirmed that November 1 must have real play grades
even though early-season outcome validation is limited. This approves
*developing and testing* provisional grades; it does not waive exact-price,
identity, freshness, lock, or publication checks. The private r2 grade triage
evaluates every available Moneyline, Spread, and Total quote at one executable
target book, excludes that book's family from professional corroboration, and
distinguishes unavailable, agreeing, opposing, and mixed professional evidence.
It has no stake authority and no member writer import.

The October 29 12:15 UTC immutable preview contains two November 1 ET games
and six exact target market rows. The provisional same-input board has zero
Best Angles, three Leans, one Watchlist, two No Plays, and zero Holds. The prior
ungraded preview had zero actionable rows, so this is three proposed
promotions, zero demotions, and a net +3 actionables. All three Leans are
**model-only**, not sharp-confirmed: neither game has a qualified professional
reference in that capture. This count demonstrates a non-flat candidate, not
predictive validation or a final November 1 board. The opened historical
grade audits found moneyline and total failure blocks, so they do not justify
promoting this draft as a proven grade policy.

The private r2 board builder now derives all three market reviews from the
same coherent score and exposes the unqualified prediction-reader state
explicitly. Grade-side, score, and exact-quote identity tests pass. It does
not apply a purported market correction to scores when movement, splits, and
professional-book direction are unqualified; the final sharp-informed
prediction-reader and the sole writer are still separate launch gates.

A bounded read-only Owl's refresh at 17:32 UTC on October 29 returned the
same four complete consumer books for Villanova–Notre Dame and one for
High Point–Liberty. It returned no qualified Circa/Pinnacle quote for either
game and zero split games (`partial` source status). The draft board therefore
remains explicitly model-only where it is actionable; absence is not an
affirmative professional-book signal. This is a point-in-time source receipt,
not a conclusion about what will be available closer to tip-off.

## First private execution receipt

The new date-bounded canonical fixture seed was rehearsed **read-only** on
October 29 against the paid BALLDONTLIE NCAAB games endpoint for November 1.
One provider request returned two ET-slate games and four distinct teams;
`written=false`. November 2 returned 182 ET-slate games and 364 teams in two
bounded requests; `written=false`. The seed horizon now covers today through
three days ahead so the November 1 opener is eligible for existing pregame
collectors before game day. The exact-ID/ET-date mapper and lock-identity guard
passed focused tests. The route has a once-daily schedule but remains
`CBB_CRON_ENABLED` gated off until deployed and explicitly enabled. This closes
a fixture-mapping implementation gap, **not** the
market-reader, grade, member-snapshot, lock, or tracking gates.
