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
- Before the rolling-slate work, the task branch integrated the then-latest
  `origin/main` commit `bc66ac5a3356b34cf92ed7065bd40f2bac15571c` with no
  overlapping files. This is not a publication or live cutover.
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

The private preview now supports `--candidate=r5 --refresh-market`: one bounded
odds GET and one splits GET produce an immutable local source receipt before
the same invocation evaluates the CBB reader and all six provisional market
rows. It never substitutes an old cache after a refresh failure and has no
production writer. The grade policy advances to r4 so both target and reference
quotes must have a genuinely fresh bookmaker observation, not just a fresh
HTTP receipt. A deterministic transition test proves that newly arrived,
fresh target-excluded Pinnacle evidence changes the Spread corroboration state
from `unavailable` to `agrees`, while the score remains unchanged under the
still-unqualified prediction reader; stale professional evidence is rejected.
The same private pull now attaches exact-event Owl's split evidence when it
exists: provider event ID is tied to the independently verified teams and tip
time, reversed home/away naming is reconciled, and each complete or truthful
single-axis pair retains named book, market, side, clock, and money-minus-ticket
difference when both axes exist. The current zero-row split response therefore
stays unavailable; a synthetic arrival test proves a +40-point money/ticket
divergence maps to the correct canonical team without inventing a prediction
effect. Splits still have no CBB score or grade authority until a reader is
qualified. The live receipt showed that Owl's repeats the Villanova–Notre Dame
event once per book under the same event ID; the exact-event matcher accepts
those repetitions but rejects two distinct IDs for one fixture.

An independent BALLDONTLIE current-odds read at 17:50 UTC returned complete
Caesars, Fanatics, and BetRivers rows for both opener fixtures. Those generic
`home`/`away` price fields appear reversed against Owl's named-selection prices
on both neutral-site matchups; there is no same-book named-selection pair in
this pull to prove their orientation. They are therefore **additional lines
observed**, not six newly qualified executable target rows or professional
references. The private board continues to use exact named selections rather
than silently flip or infer generic sides. A DraftKings Owl's event for the
Liberty–High Point matchup also carried a start roughly two hours away from
the matching BALLDONTLIE and ESPN 04:59 UTC tip and was correctly excluded by
the exact-time gate.

Repeated private pulls now preserve immutable, hash-checked receipts and
reconstruct the actual observed same-book, same-market price path with the
evaluated target family excluded. The 17:51 UTC rehearsal joined three pulls
for Villanova–Notre Dame; each qualified non-target book/market had three
observations but one distinct price state, so **no movement was observed**.
The Liberty–High Point path had no non-target named-book observations after
the exact-time gate. Neither path is labeled a true opening, sharp-money cause,
or validated score-correction signal.
At 17:41 UTC, the refreshed private board had two games and six markets:
zero Best Angles, three model-only Leans, two Watchlists, one No Play, and zero
Holds. No Circa/Pinnacle CBB prices or split games arrived in that pull. The
prior capture's actionable count was three, so r4 causes zero promotions,
zero demotions, and zero net board change on this live-source rehearsal. This
is ingestion and provisional-grade plumbing, not proof of a market-driven
accuracy improvement or authorization to publish.

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

## October 29 owner direction and private reader/grade parity

The owner explicitly approved proceeding toward a November 1 graded CBB Daily
Edge with provisional grades, while asking that the remaining reader and
product path be completed. This satisfies the direction/approval proof, not the
publication gate. The private HTML preview previously still said "Pending
calibration" despite its adjacent JSON containing six provisional grade rows.
The private preview now renders the same selected executable book, line, price,
model probability, grade, and professional-reference state as the JSON for
each of Moneyline, Spread, and Total. It also identifies whether exact split
rows or observed same-book price changes are present, without granting those
observations unvalidated score-correction authority.

At 18:20 UTC, a new read-only Owl's NCAAB odds/splits pull returned two exact
November 1 games. The preview's six target markets were three Leans, two
Watchlists, one No Play, zero Best Angles, and zero Holds. All three Leans
remain model-only. The provider returned no CBB split games, no qualified
Pinnacle/Circa target-excluded references for these two fixtures, and no
observed price changes in the retained non-target same-book paths. The
read-only pull created one immutable local receipt and made zero production
writes. The offline preview now uses the latest hash-checked receipt, rather
than an older static market file; an explicit refresh failure still aborts.
No CBB score, grade, or stake was published by this change. The single writer,
locked member precedence, official W/L/push tracking, and member snapshot
parity remain required before activating the CBB model.

The private candidate also has a pure T-60 lifecycle contract: it captures a
complete three-market board before cutoff, refuses to create a backdated pick
after cutoff, freezes the exact stored card at lock, gives that locked payload
reader precedence over a changed unlocked card, and settles its stored
Moneyline/Spread/Total selections as win, loss, or push from an integer final
score. Focused tests include a later opposite-side candidate, a missing
prelock snapshot, and an exact spread push. This proves the decision logic in
isolation; it does **not** establish a race-safe database writer, a public
locked reader, or official tracking. Those production gates remain open.

## Exact team, logo, and market-identity gate

The October 29 launch identity audit compares BALLDONTLIE's numeric team/game
IDs and full names with the ESPN catalog, exact ESPN scoreboard participants,
tip time, roster team IDs, numeric independent-prior stat IDs, and Owl's named
two-sided market quotes. It never
joins on an abbreviation. The global BDL catalog has 58 duplicated nonempty
abbreviations and two missing abbreviations, which is why abbreviation-only
mapping would be unsafe. ESPN's catalog also omits some schools that appear
in an exact scoreboard event; a unique, time-confirmed event can now supply
an official ESPN ID/logo only when both full participants agree. The logo URL
must be on ESPN's NCAA CDN **and** carry the same verified ESPN ID.

The November 1 rehearsal found two games, four verified team IDs/logos, two
exact ESPN venues/times, and complete named three-market consumer books for
both games. All four logo URLs returned HTTP 200 with image/png content. A
fresh, no-write production-service rehearsal also returned two games, four
verified logos, and `written=false`. The date-bounded seed release advances to
`cbb_fixture_seed_2026_10_29_r3_exact_espn_identity`; new CBB team rows may
receive the verified ESPN logo and ID but a wrong-team or guessed logo cannot
be inserted. No existing CBB team rows were present in the database at this
check. The cron remains disabled, so no production row was changed.

For November 2, five games currently have a complete exact named target book;
all five have full verified identities and no mapping defects. The full
182-game slate has 118 fully verified team/venue/roster/stat identities, 52 missing
away ESPN logos, one missing home logo, 64 absent away independent priors,
one absent home independent prior, 31 unmatched ESPN venues/times, and
177 games without a complete named target book at the audit instant. Many of
those games are lower-division exhibitions with no posted market; they must
not be mislabeled as a feed-name match failure or given a fabricated logo or
price. The audit remains reproducible with
`node --import tsx scripts/operator/audit-cbb-launch-identity.ts --date=YYYY-MM-DD`.

This identity repair changes zero existing predictions, prices, grades,
actionables, stakes, or locked records. It does not itself complete the sole
CBB prediction writer, member reader, lock persistence, or official tracking;
those remain launch gates. The private candidate is not live.

## Seven-day slate presentation — private candidate only

The card-view candidate now uses a rolling seven **Eastern calendar-day**
window from the current date, rather than a fixed football week. Each
analyzed CBB card is grouped by its actual ET tip day in the established
Daily Edge layout. Exact-identity scheduled fixtures that do not yet have a
complete analyzed card are shown separately as schedule-only matchups,
without manufactured predictions, prices, grades, or stakes. A game with an
analyzed card is removed from the schedule-only layer by numeric external ID.
The window handles ET midnight and daylight-saving transitions as calendar
dates, not as a fixed number of UTC hours. Per-game refresh and T-60 lock
authority stay with the future sole prediction writer; this UI work does not
alter either lifecycle.

Fixture-only seed coverage advances to
`cbb_fixture_seed_2026_10_29_r4_seven_day_et_window`, and the read-only
schedule contract is
`cbb_rolling_slate_2026_10_29_r1_seven_et_days`. Team joins use stored CBB
foreign keys and preserve verified logos; unresolved or duplicate identities
abort instead of appearing under a guessed abbreviation. The local-only
experience preview can read the schedule; production-mode requests for that
CBB preview are rejected. The member route is gated by
both `CBB_ACTIVATION.memberPublication` and `CBB_DAILY_EDGE_ENABLED`. Both
remain off. No live snapshot, lock, tracking, model score, market decision,
grade, or stake changes in this candidate: zero promotions, zero demotions,
and zero actionable-count change. The full CBB writer/reader/tracking launch
contract above remains open.

## Game reader contract — private candidate only

The CBB candidate now projects its exact three-market board into game-detail
fields: canonical team names/logos, one coherent score, each selected
side/line/price/probability/grade, both sides of verified split rows, and
observed target-excluded same-book price paths. It does not infer sharp
causality or let unqualified movement/splits change the prediction. The
private offline preview includes this reader; it is not yet the authenticated
Daily Edge reader.

Locked-first tests prove a newer unlocked candidate cannot replace a stored
locked score, pick, price, or grade. Post-lock splits and movement are omitted
because this candidate has no persisted lock-time evidence panel; they cannot
be attached retroactively to the public record. The sole leased writer,
persisted immutable lock, member snapshot, official W/L/push tracking, and a
qualified CBB prediction-market reader remain open launch gates. This
reader-only change alters zero live actionables, stakes, or records.
