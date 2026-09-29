# NFL Week 4 rollover and joint-Moneyline coherence repair

## Scope and authority

Owner direction on 2026-09-29 was to restore the missing NFL weekly board without changing the
member-facing product, adding copy or labels, weakening prediction accuracy, or undoing the
2026-09-28 market-reading release. The affected path is NFL Daily Edge Moneyline probability and
exact-price grading, the sole NFL forward-evidence writer, weekly member fixture, compact member
snapshot, and the existing `nfl_forward_evidence` cron under the shared
`prediction_pipeline:nfl` lease. Spread, Total, score-distribution, market-reading inputs,
provider cadence, stake, member copy, layout, and T-60 immutability are unchanged.

The starting champion was member/model/calibration/decision/grade r23/r20/r19/r25/r25 with writer
r50, fixture r34, and compact snapshot r26. The candidate is r24/r21/r20/r26/r26 with writer r51,
fixture r35, and compact snapshot r27. The preceding r23 and r22 families remain transition-only
authorities for independently valid immutable T-60 rows.

## Production diagnosis

The calendar selector correctly resolved 2026 Week 4. Current-season state was complete through
Week 3 (48 final games, 96 team-game rows, and 3,133 player-stat rows), and the sole writer was
receiving all 16 Week 4 games. Fifteen games accumulated 90 current-schema evidence rows, but game
`1392268` (JAX at CIN) was rejected on every cycle. Its legacy aligned-r6 Moneyline probability
said CIN win `0.611715`, while the authoritative joint score distribution said CIN -2.5 cover
`0.621909`. A favorite-cover event is a subset of a favorite-win event, so that tuple is
mathematically impossible. The coherence guard correctly held the game; complete-slate
publication then correctly refused 15/16 coverage. The result was no Week 4 member snapshot, and
the NFL props writer correctly refused an incomplete shared game context.

## Repair

Moneyline winner, probability, exact-price evaluation, EV, and grade now use the same authoritative
joint score distribution already used by the displayed expected score, Spread, and Total. The
legacy aligned-r6 Moneyline probability can no longer replace that joint-PMF probability after the
score is frozen. Target-excluded leave-one-book-out pricing remains active, so this is not removal
of the market marriage: the model owns the outcome probability while the evaluated book and other
books' fair consensus own price/actionability. No threshold, score equation, market-reading rule,
provider request, writer, timer, stake, copy, label, or layout changed.

## Same-slate no-write verification

The unchanged production release reproduced the incident with 15/16 games and the exact
containment failure above. The candidate no-write cycle completed 16/16 games and 48/48 markets
with zero held games and no coherence failure. The full Week 4 grade surface was 20 Best Angles,
5 Leans, 4 Watchlists, and 19 No Plays: 25 actionables, so the board is not flat.

On the exact 15-game cohort already stored under r23, Moneyline sides did not change. There were
two within-actionable promotions (Lean to Best Angle), four evidence-driven demotions (Best Angle
to No Play), and no Spread or Total grade changes caused by this code change. The previously
missing JAX-CIN game contributed three coherent Best Angles, producing a net full-board change of
only one actionable versus the incomplete writer output while restoring all three predictions and
all 16 games. Any line changes observed between captures are live provider movement and not part
of this release comparison.

## Safety and rollback

The focused NFL suite, full model-change verification, production build, latest-main integration
safety, protected pull-request checks, and live release/snapshot proof are required. Publication
must remain append-only under the existing lease. Roll back unlocked r24 rows to r23 if the live
writer produces mixed current releases, fewer than 16 games or 48 markets, any cross-market
coherence failure, an unexpected actionable collapse, a reader timeout, or lease overlap. Valid
locked rows remain immutable under every outcome.
