# CBB three-market signal and error audit (private, read-only)

## Decision

The current r2 prelaunch preview remains unchanged. This audit does not qualify
a replacement model, market correction, grade or stake. The separate r5 market
view applied **zero** score corrections to its two November 1 cards. Its
opening-price plumbing is real, but CBB does not yet have a validated
movement/splits-conditioned reader that can decide when a flip is helpful.

The principal finding is not that the market is useless. On the same 353 exact
target opening quotes, earlier target-book-excluded reference prices contain
some Total-side information, while following their side for Spread or Moneyline
would have lost more picks. Market disagreement therefore needs to be
interpreted by market, evidence chronology and game context; neither automatic
fading nor automatic following is supported.

## Exact-time decision replay

The read-only operator below replays the frozen r2 forecast at each target
opening timestamp. For each market it compares r2's side with the side implied
by the median of **earlier** qualified reference-book price centers at that
same target line. The target book/family is excluded. These are opening-price
comparisons, **not** same-book line paths, public money, identified sharp money,
closing lines, a learned reader, or actionable-grade tracking. These 2025–26
outcomes have already been opened; the table is exploratory, not a new holdout.

| Market | Eligible games | r2 correct | Earlier-reference correct | r2 losses fixed | r2 wins harmed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Moneyline | 213 | 143 | 140 | 6 | 9 |
| Spread | 353 | 198 | 179 | 61 | 80 |
| Total | 353 | 175 | 192 | 92 | 75 |

Moneyline has a valid same-market reference in only 213 of 353 games. No
Moneyline number above silently substitutes a Spread reference. The Total
advantage is much stronger in February's 162-game selection block (+11 correct)
than the later 40-game block (+1). The latter is too small, and also previously
opened, to certify a durable correction. The Spread disadvantage persists in
the later block (28 r2 correct versus 23 reference correct).

The r12 independent-model changes do not resolve the cross-market problem:
on these same 353 targets, they flip 22 Moneylines (9 corrections, 13 harms),
93 Spreads (45 corrections, 48 harms), and 109 Totals (55 corrections, 54 harms).
Among the 51 Spread flips where the earlier reference agrees with r12, 24
correct old losses but 27 harm old wins. Simple “the market agrees with the
flip” therefore does not separate good Spread flips. For 44 similarly aligned
Total flips the split is 26 corrections/18 harms, a possible lead but an
opened-cohort observation, not a promoted rule. R12 remains unpromoted because
its broader 635-game Total decisions regress and the quoted ML/Spread results
also decline; see the earlier [pick-repair result](2026-10-29-cbb-pick-repair-result.md).

## What the requested score-error targets imply

On these 353 target games, r2 has 9.62-point margin MAE and 13.34-point Total
MAE. The target sportsbook's opening Spread threshold is 9.89 points from the
actual margin on average; its Total threshold is 13.31 points from the actual
Total. On the wider, overlapping 635-game Total cohort, r2 is 13.45 and the
opening Total threshold is 13.53. A line threshold is not the sportsbook's
point forecast, and bookmaker objectives differ from MAE, so these are
comparators, **not** a mathematical floor. They do show that reaching ~6 margin
and <10 Total is a large information improvement over both the current model
and this quoted-market sample, not something a tiny calibration tweak can be
expected to achieve. Lower error alone is insufficient if ML/Spread/Total sides
at real lines get worse.

## Historical-odds answer and unresolved evidence

- BALLDONTLIE provides timestamped opening CBB prices for the selected
  February–March 2026 dates. The 353-game cohort has all three exact target
  markets; the overlapping Total-only cohort has 635 games. One opening per
  book does not establish later movement, resistance or money flow.
- Owl's archive reports NCAAB game coverage from January 28 through April 7,
  2026. A bounded nine-fixture path probe fetched 80,607 raw rows, but only 457
  paired pregame prices across seven fixtures survived exact identity, explicit
  UTC, T-minus-60 and source-quality filters. Only three probed fixtures had a
  changed Circa/Pinnacle path; none had a verified true opening. Older rows
  often lack an explicit UTC capture clock. Poll rows are not independent games.
  This is genuine partial time-stamped history, **not** enough to fit or certify
  a nuanced movement-based CBB resolver.
- There is no configured The Odds API or CollegeBasketballData key in this
  private worktree. No unverified clock or fabricated split was used to fill
  the historical gap. The current November preview returned retail pairs but
  no actual Circa/Pinnacle CBB quotes or splits, so both cards correctly show
  `marketInference.applied=false`.

## Concrete next qualification gate

The next predictive candidate should start with **new source information**, not
another coefficient sweep on these already-opened games. First, establish a
materially larger exact-game, pregame UTC-verified, book-specific path cohort
from the existing paid archive, recording its coverage by date, book and market
and rejecting unknown-clock or mislabeled rows. Then predeclare a chronological
fit/selection/later comparison against frozen r2 at each actual quote cutoff.
The decision table must report ML, Spread and Total W/L/push, corrected losses,
harmful flips, conditional probability quality, score coherence and date-level
variation. A game-level final margin and Total must still generate both team
scores and all three market probabilities. A movement reader earns prediction
authority only if its later-block gains survive all-market and source-quality
checks; there is no hard “flip on three signals” shortcut and no promise of the
owner's MAE targets from the current evidence. This is a qualification plan,
not a live shadow or a reason to change grades while the reader is unproven.

## Reproduction and safety

Run `node scripts/operator/audit-cbb-market-signal-readiness.mjs` from the
dedicated CBB worktree, using the cached private files under
`/private/tmp/oddsphere-cbb-data/`. The operator performs no provider calls and
no writes. It asserts exact target identity, unique fixture/cutoff, prior
reference timestamps and flip reconciliation. Raw source receipts stay local.

This audit changes zero model inputs, predictions, reader authority, grades,
stakes, board counts, site routes, writers, leases, cron jobs, locks, member
records or tracking rows. It does not activate CBB or publish a new release.
This audit began from the clean dedicated CBB branch at
`3e3311c37d3a51edb98c947d3fa87d6ea02d74c0` and incorporated remote
`main` at `3713fcef00a54230632e22aa8ef60ad3654a7671` before editing.
