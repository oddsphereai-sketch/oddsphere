# NHL r18 fast-state direct probability — 2026-10-15

## Decision

Promote `nhl_regular_2026_r18_fast_state_direct_probability` as a bounded
opening-window replacement for the r17 roster score head. It applies only to
regular-season games before either team reaches ten current-season games. The
later-season r17 statistical path, discrete Moneyline market reader, exact-price
selection, target-excluded Total reader, sole writer, sport lease, and locked
snapshot precedence remain unchanged.

This release does not claim that the opened 2026 replay is an untouched test.
The production decision is supported by the separately held 2025 opening
window, exact research/runtime parity, the current replay, and an automatic
boundary that excludes the full-season region where the candidate failed.

## Architecture and chronology

- Inputs are market-free and strictly pregame: goals, goals against, xG for and
  against, shots for and against, 5-on-5 xG, power-play xG, penalty-kill xG,
  finishing and suppression residuals, win form, Elo, home ice, rest,
  back-to-back flags, and defensive-zone giveaways.
- Each team input is a 0.085 EWMA updated only after a fully paired completed
  game. The 2026 opening state is frozen from end-2025, regressed 65% toward
  feature priors and 72% toward 1500 Elo.
- Fit years: 2019-23. Family, EWMA alpha, and ridge selection: 2024 only.
  Final coefficient refit: 2019-24. Historical confirmation: 2025. Opened
  current gate: 2026.
- The direct probability is converted to a Poisson goal margin while preserving
  the independent Total. One joint distribution therefore owns the score and
  every market probability.
- Market prices never enter the independent probability. The existing market
  reader may make only its already validated discrete, corroborated correction.

## Historical qualification

The selected model's 2024 selection record was 774-533 (59.22%), with
chronological-quarter accuracies of 57.36%, 61.77%, 55.35%, and 62.39%.

Across the full 2025 confirmation season, the candidate was 707-605 (53.89%)
versus 719-593 (54.80%) for the non-roster comparator. That result rejects an
all-season replacement. In the predeclared first-ten-games opening window,
however, it was 88-65 (57.52%), versus 86-67 (56.21%) for the non-roster
runtime comparator and 83-70 (54.25%) for the released roster head. Production
therefore enforces the opening boundary and resumes the incumbent architecture
afterward.

## Exact production replay

The SELECT-only replay joins immutable stored feature/market snapshots to
MoneyPuck games strictly earlier than each slate, calls the real TypeScript r18
model, and grades against the unchanged official outcomes. All 107 games had a
complete paired replay.

| lane | r17/public record | r18 counterfactual | competitor |
| --- | ---: | ---: | ---: |
| Moneyline | 62-45, 57.94% | 71-36, 66.36% | 52-34, 60.5% |
| puck line | 62-45, 57.94% | 63-44, 58.88% | 49-37, 57.0% |
| puck line +1 | 80-27, 74.77% | 79-28, 73.83% | 61-25, 70.9% |
| puck line +2 | 96-11, 89.72% | 96-11, 89.72% | 75-11, 87.2% |
| Total | 51-55-1, 48.11% | 54-52-1, 50.94% | 44-42, 51.2% |
| Total +1 | 77-28-2, 73.33% | 80-25-2, 76.19% | 64-22, 74.4% |
| Total +2 | 88-18-1, 83.02% | 90-16-1, 84.91% | 70-16, 81.4% |

Competitor denominators differ, so this is a benchmark comparison rather than
a matched-game head-to-head. R18 exceeds the competitor in six of seven lanes;
straight Total trails by 0.26 percentage points, equivalent to one result on
the OddSphere sample.

The independent Moneyline is 68-39. The unchanged sharp reader makes three
conflict flips, all three corrections and no harms, producing 71-36. Relative
to the stored public record, r18 changes 21 Moneyline sides with 15 corrections
and six harms; nine puck sides with five corrections and four harms; and nine
Total sides with six corrections and three harms.

| diagnostic | r17 | r18 |
| --- | ---: | ---: |
| margin MAE | 2.21283 | 2.18391 |
| Total MAE | 1.87769 | 1.80203 |
| margin bias | +0.22698 | -0.01720 |
| Total bias | -0.23283 | -0.12202 |
| margin correlation | 0.30538 | 0.35488 |
| Total correlation | -0.10590 | 0.00932 |

On the final 13-game r17 chronological segment, Moneyline improves from 6-7 to
8-5. Puck line remains 9-4 and Total remains 7-6; there are two Moneyline
corrections and zero harms in that segment.

## Board and label impact

Across 321 raw model verdicts, Best Angles move from 33 to 60, Leans from 186
to 153, Watchlists from 102 to 108, and raw actionables from 219 to 213. There
are 79 grade promotions and 59 demotions. This is not a hidden no-play strategy:
the high-conviction tier expands while the total actionable board contracts by
six decisions (2.74%). Exact-price writer policy remains downstream and
unchanged.

The prior `goalie_advantage_goals` explanation was not verified-starter
evidence; it was an opponent team GA-minus-xGA residual. R18 reports that layer
as zero. Goalies remain roster-filtered for evidence display, but starting
goalie and injury availability remain an acknowledged data gap and do not
silently move this release's score.

The exact October 15 no-write rehearsal covers eleven games. Twenty-seven
already locked r17 market tuples remain untouched. The six unlocked tuples are
recomputed as r18 with zero errors: actionables move from four to five through
two promotions and zero demotions. Utah-Edmonton Moneyline changes from Edmonton
Watchlist to Utah Lean, and Utah +1.5 changes from Lean to Best Angle. The other
four unlocked market decisions, including all three Calgary-Vegas directions,
remain unchanged. October 16 and 17 contain no scheduled regular-season games in
the authoritative database.

## Coverage, immutability, and rollback

The MoneyPuck parser accepts the current path-derived season contract and the
legacy explicit-season contract, while rejecting an explicit season or requested-
team mismatch and requiring every consumed feature column. One fetch cycle
supplies both opponent-adjusted and fast state; no second writer or model refresh
path is introduced. Before an opening-window write, the pipeline compares exact
replayed game IDs with every settled database game strictly before the slate; an
equal count cannot conceal a missing game. A fetch, pairing, identity, schema, or
coverage gap fails the writer closed. The reader preserves a compatible stored
r17 predecessor during such a gap and cannot synthesize an r18 opening-window
forecast. Frozen opening priors cover a genuinely empty opening slate.

Existing locked predictions, prices, grades, snapshots, and release IDs are
never rewritten. Reader precedence remains stored-payload first. Rollback is to
the r17 release family and reader r13; do not delete or reinterpret r18 locks.

## Verification commands

- `npm run test:nhl-regular-model`
- `npx tsc --noEmit` with an enlarged Node heap when required by the repository
- `npm run verify:model-change`
- `npx tsx --env-file=.env.local scripts/operator/audit-nhl-opponent-state-repair-20261015.ts --compact`
- `node scripts/verify-integration-safety.mjs --base-ref=<latest-origin-main>`

Completed before publication: the focused NHL suite passed, TypeScript passed
with an 8 GB Node heap, the full model-change suite passed, the 107-game exact
replay reproduced the table above, and the current-board rehearsal completed
with 27 immutable locks preserved and zero game errors.
