# CFB professional independent score and market marriage r15

## Decision

Promote the compact r7 independent score model and the r8 post-market Spread
arbitration into the existing sole CFB writer. The release changes model
internals and versioned evidence only. It adds no member copy, labels, layout,
stake rule, schedule, writer, or provider loop.

## Evidence boundary

- 2024 and 2025 are partial evidence. They validate the independent score and
  matchup architecture and retained line-relative directions, but they do not
  contain the complete split, price, and same-book movement history needed to
  validate the full market marriage.
- 2026 is the only full market-reading evidence. Weeks 1–2 are development;
  Weeks 3–4 are chronological confirmation. Results are release-pure and use
  evidence captured before the relevant game.
- No historical hit rate is a promise of future performance.

## Independent architecture

The production runtime uses one shared ElasticNet team-score model, a 48-tree
ExtraTrees direct-margin component at 25%, opponent-adjusted offense/defense
matchup state, QB/passing, rushing/trench, scoring opportunity, pace, field
position, red-zone, third-down, turnover, special-teams, rest, venue, Elo and
personnel continuity inputs. A cross-family weekly scoring-domain detector
corrects the current scoring environment only when robust nonlinear and shared
linear Total families disagree by at least seven points. It never reads the
game's outcome or market line.

The 48-tree portable runtime passed every frozen compactness gate against the
360-tree reference on 2,835 historical games. Its pooled estimates were team
score MAE 9.2872, margin MAE 13.2315, Moneyline direction 74.32%, Spread
direction 52.05%, and Total direction 53.35%. These historical metrics validate
the independent model only.

The Python and TypeScript runtime parity replay covers all 99 Week 1 games. The
mean team-score difference is 0.055 points and the largest feasible-score
difference is 0.240 points. Two raw research predictions crossed below zero;
the production joint PMF correctly enforces nonnegative football scores. A
nondeterministic equal-attempt primary-passer tie was found during parity work
and replaced in both runtimes by the same stable attempts/name ordering before
any production publication.

## Validated market marriage

Market consensus is not averaged into every score. The sole score mutation is
the 2026-validated Spread rule: a retained Playbook Spread observation must
cover at least eight books, money-minus-ticket divergence must be at least five
percentage points, and its side must conflict with the independent cover side.
The final margin is then reflected across the exact home Spread line, the
independent Total is preserved, and the joint PMF is rebuilt so score, winner,
Spread and Total remain one coherent forecast. A confirming signal leaves the
score unchanged.

Circa/Pinnacle/Bookmaker same-book movement, sharp splits, public splits and
price trails remain captured and continue to affect the established
source-aware confidence/grade path. The tested 2026 sample did not authorize a
universal Moneyline or Total score flip, nor a generic movement nudge; those
signals stay diagnostic until they pass both chronological blocks.

On the 256 games with complete 2026 Spread-market evidence:

| Metric | Independent | Final marriage |
| --- | ---: | ---: |
| Moneyline wins | 213/256 (83.20%) | 220/256 (85.94%) |
| Spread wins | 125/256 (48.83%) | 135/256 (52.73%) |
| Total wins | 126/256 (49.22%) | 126/256 (49.22%) |
| Margin MAE | 13.9567 | 13.2372 |
| Team-score MAE | 9.5227 | 9.2880 |

On untouched Weeks 3–4 confirmation, the final marriage was 120/140 (85.71%)
on Moneylines, 74/140 (52.86%) on Spreads, and 80/140 (57.14%) on Totals. It
improved margin MAE from 12.7424 to 12.3330 and team-score MAE from 9.0681 to
8.9783.

## Grade and board validation

The read-only exact-price replay matched 236 settled games and 569 executable
market decisions from stored pregame evidence. Weeks 3–4 confirmation was
197-127 with two pushes (60.80%) across all exact predictions. Actionables were
124-92 (57.41%): Moneyline 32-19 (62.75%), Spread 48-43 (52.75%), and Total
44-30 (59.46%). Best Angles were 33-28 and Leans were 91-64. Weeks 1–2 remain
development evidence and are not represented as confirmation.

On the same stored current-board inputs, the prior release had 44 actionables
and the candidate had 86. The paired transition contains 77 promotions, 15
demotions, 46 side changes, and zero score/decision coherence failures. This is
not a flat-board release. A separate zero-write live-provider writer replay
covered all 99 games and all 297 markets, publishing 19 Best Angles, 72 Leans,
58 Watchlists and 13 No Plays across 162 executable decisions, with 135 held
markets and zero isolated game failures. The difference from the stored-input
86-actionable replay is newer provider evidence, not a second model path.

## Runtime and load safety

- `/api/cron/cfb-forward-evidence` remains the only prediction writer and keeps
  the `prediction_pipeline:cfb` lease.
- Current-season advanced state uses six public season files, fetched once per
  12-hour cache window and stored under one versioned snapshot. It is not a
  per-game loop and adds zero Playbook requests.
- The zero-write live replay reported the existing bounded 100-request maximum
  for a 99-game release refresh. No added writer, cron, or slate scan exists.
- Current and previous member/evidence releases remain explicitly supported;
  locked prior rows are immutable and tracking-eligible.
- The product surface, fallback split presentation, prices, labels and copy are
  unchanged.

## Releases and rollback

The release family is the October 1 professional r7/r8/r15 set recorded in
`docs/current-model-releases.md`, with sole writer r81, evidence r28, member
r40, fixture r60, snapshot r19, reader r8 and tracking r30. Roll back the whole
unlocked family together on missing games/markets, mixed releases, PMF or
score/side incoherence, unexpected board collapse, provider-budget growth,
writer overlap, lock failure, or reader failure. Never rewrite a valid prior
lock.
