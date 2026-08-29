# CFB transition and actionable-board stabilization r42

Date: 2026-08-29

Status: owner-authorized provisional production candidate; results must remain separated by exact
release and immutable lock timestamp.

## Failure being repaired

The first r12 production wave exposed two release-boundary defects. A prior-release T-60 row held
for `t60_capture_late` was treated as if it satisfied the new release lock boundary, preventing the
new writer from planning its own release-stamped T-60 capture. The member movement reader also
discarded immutable same-book price observations solely because they belonged to the preceding
evidence schema, making real quote history appear unverified after the release cutover.

The grade overlay also compared abbreviated decision labels such as `UVA` with the forecast's full
home-team name such as `Virginia Cavaliers`. The mismatch defaulted team markets to the away split,
even though the member split percentages themselves were displayed on the correct teams. The r42
writer passes the explicit home abbreviation, so NCSU-heavy evidence is correctly resistance to an
evaluated UVA side rather than support.

The repair does not rewrite any row. A valid prior T-60 remains frozen. A held prior T-60 no longer
blocks the active release's one allowed T-60 attempt; an active-release T-60, including an explicit
late hold, remains terminal for that release so the append-only unique boundary cannot be retried.
Reader-only movement may use chronological, same-game, same-book observations across releases,
but the selected model row, decision, lock, tracking record, and performance era remain exact-release
scoped. TCU-UNC began without a valid r12/r4 lock and is not retroactively backfilled or represented
as on-time.

## Owner-authorized actionable ladder

The PMF remains the exact PR #265 candidate: 75% independent football and 25% canonical
market/sharp mass, with strictly matched sharp adjustments capped at one home-margin point and one
total point. The owner-approved stabilization amendment adds three post-probability, resistance-aware
grade rules:

- an existing Lean may become Best Angle at model probability >=55%, target-excluded edge >=5pp,
  exact-price EV >=6%, price from -500 through +500, and no strict sharp or same-book movement
  resistance;
- a Spread Watchlist may become Lean at model probability >=53%, edge >=2.5pp, EV >=2%, absolute
  line <=10, the same price band, and no resistance.
- a Total Watchlist may become Lean at model probability >=52%, edge >=2.5pp, EV >=1.5%, the same
  price band, and no resistance.

The owner rejected a -125 through +125 restriction as too narrow. The older bounded Spread
recalibration therefore uses the same -500 through +500 covered-price band. The band is only an
eligibility boundary; probability, edge, EV, identity, completeness, and resistance gates still
decide each tuple.

These rules add no stake and do not bypass identity, freshness, price-completeness, PMF/side
coherence, or lease gates.

## Frozen live-board comparison

The SELECT-only r12 FBS wave captured at 2026-08-29T15:56:08.668Z contains 20 evaluated tuples;
the failed legacy TCU lock is excluded from recomputation. No game result was used.

- before: 0 Best Angles / 2 Leans / 12 Watchlists / 6 No Plays;
- after: 2 Best Angles / 4 Leans / 8 Watchlists / 6 No Plays;
- six tier promotions, two resistance demotions, net actionable +4;
- Best Angles: SJSU-USC Under 60.5 -102 and JXST-NDSU Over 46.5 -110;
- new Leans: NDSU -6.5 -115, UNLV -4 -110, NMSU Under 53.5 -110, and Hawaii Under 48.5 -110.
  UVA -4 -108 remains Watchlist because the correctly mapped NCSU-heavy strict split resists UVA.

Live counts remain price- and evidence-sensitive. Existing resistance demotions remain active, so
the published distribution may decrease when strictly matched evidence moves against a side. The
frozen distribution is an audit result, not a target, quota, or forced live board shape.

## Release and rollback boundary

The complete r42 set is recorded in `docs/current-model-releases.md`. The sole existing
`cfb-forward-evidence` writer and `prediction_pipeline:cfb` lease remain authoritative. Roll back
or hold on mixed releases, writer/reader value incoherence, missing price coverage presented as a
normal evaluation, a crash, lease failure, failed future T-60 creation, stale pre-release snapshot
resurfacing, or an unexpected actionable-board collapse. Live success requires database and member
proof of the r42 release set, coherent projections/decisions, same-book movement, writer freshness,
tracking separation, and a responsive production site.
