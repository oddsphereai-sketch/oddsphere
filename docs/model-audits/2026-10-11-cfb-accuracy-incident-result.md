# CFB 2026 accuracy incident — replacement result

Date: 2026-10-11

Status: production candidate; publication and live verification remain required

## Decision

Replace the October 9 complete market reader with the October 11
consensus-authority and split-specialization reader. This is a new release,
not a silent threshold change. Historical locked payloads remain immutable and
continue to render from their stored release.

The repair addresses the repeatable failure exposed on October 10: the old
reader gave stable target-book-excluded consensus no authority unless a line
move, reversal, or split signal was also present. In large independent-market
disagreements, that left implausible independent upsets untouched even though
the target-excluded market side won about 70% of those 2026 disagreements.

## What the replacement does

- Current target-book-excluded Spread consensus can move the final margin even
  with no line movement and no split feed.
- Consensus authority is continuous rather than a hard evidence cliff: it
  starts at 0.50 and rises smoothly by at most 0.25 as disagreement grows.
- The independent model retains an upset call when the consensus line is in the
  empirically selected football key-three band (absolute 2.5 through 3.5).
- A candidate must clear the exact Spread boundary by one full point before a
  projected side changes. This guards against half-point numerical churn; it
  does not block a resolved flip.
- Total splits are specialized by provenance. A fallback sportsbook Total split
  can reflect an opposing independent Total across the exact line. Missing
  splits remain neutral.
- One coherent final PMF supplies the score, Moneyline winner, Spread side,
  Total side, probabilities, and subsequent grade inputs.
- The evaluated sportsbook family is excluded from the forecast consensus. Its
  displayed line is only the scoring boundary and its price is grade-only.

## Split audit: what was ignored and what was actually useful

The displayed split card is not synonymous with verified sharp money. The 2026
archive contained only six named-sharp observations, so it cannot support a
general Circa-like rule. Most available split observations were fallback or
public feeds.

In the October 10-11 incident block, blindly replacing the active side with the
split side would have produced:

| Market | Corrections | Harms | Net |
| --- | ---: | ---: | ---: |
| Moneyline | 17 | 26 | -9 |
| Spread | 17 | 15 | +2 |
| Total | 30 | 14 | +16 |

Across the complete 2026 chronology, blanket split following was worse for
Moneyline (41 corrections, 140 harms), neutral for Spread (82, 83), and useful
for Total (108, 92). The correct conclusion is not that splits were ignored;
it is that the previous implementation did not specialize their authority by
market and provenance. The replacement deliberately refuses to let a 97%
fallback Moneyline display impersonate a verified sharp signal, while retaining
the demonstrated Total value.

## Official-lock replay

The replay contains 373 games and 899 settled market decisions. All inputs are
limited to what was stored before the official lock and exclude the evaluated
book from forecast consensus.

| Market | Active | Candidate | Net corrections |
| --- | ---: | ---: | ---: |
| Moneyline | 273-100 (73.2%) | 280-93 (75.1%) | +7 |
| Spread | 133-121-3 (52.4%) | 140-114-3 (55.1%) | +7 |
| Total | 136-133 (50.6%) | 150-119 (55.8%) | +14 |
| Combined | 542-354-3 (60.5%) | 570-326-3 (63.6%) | +28 |

The candidate changes 176 sides: 102 corrections and 74 harms. This is not a
zero-harm or minimal-change selection.

October 10 specifically moves from 39-32 to 43-28 Moneyline, 34-36 to 36-34
Spread, and 31-39 to 37-33 Total. It clears the requested large-slate floors on
that incident date without using postgame information in the runtime rule.

The pre-PMF parameter tournament also improves margin MAE from 12.540 to
11.788, team-score MAE from 9.252 to 9.023, and Total MAE from 13.232 to
13.205. On the October 10-11 holdout, margin MAE improves from 13.189 to
11.890, team-score MAE from 9.606 to 9.174, Moneyline from 55.8% to 63.6%,
Spread from 48.0% to 52.0%, and Total from 41.3% to 50.7%.

## Weekly floors

The requested historical validation targets are 60% Moneyline and 50% Spread
and Total. They are product targets, not a truthful guarantee about every future
week. Grouping the stored Friday-through-weekend locks gives:

| Week | Moneyline | Spread | Total |
| --- | ---: | ---: | ---: |
| Sep 19-20 | 82-15 (84.5%) | 35-22-2 (61.4%) | 32-31 (50.8%) |
| Sep 25-27 | 86-19 (81.9%) | 29-30 (49.2%) | 36-31 (53.7%) |
| Oct 2-4 | 64-30 (68.1%) | 38-25-1 (60.3%) | 42-22 (65.6%) |
| Oct 7-11 | 48-29 (62.3%) | 38-37 (50.7%) | 40-35 (53.3%) |

The candidate therefore clears every Moneyline and Total weekly replay target
and three of four Spread targets. Sep 25-27 misses the Spread target by one
game. This is disclosed rather than tuned away after seeing outcomes. The
release is a major improvement, but it is not represented as mathematically
capable of guaranteeing a weekly floor.

## Exact-price and board impact

The old exact grade can be reproduced faithfully for 290 games (658 market
decisions). Eighty-three older games do not retain enough selected-quote detail
to claim an exact opposite-side grade, so they remain in directional reporting
but are excluded from the exact-grade claim.

On the exact subset, actionable results move from 151-123-1 on 275 plays,
-12.39 units and -4.50% ROI to 197-120-1 on 318 plays, +14.52 units and +4.56%
ROI. There are 103 promotions and 60 demotions. The board grows by 43 actions;
the improvement is not manufactured by flattening it.

Moneyline price economics remain a limitation: exact-subset Moneyline direction
improves by seven net wins, but the expanded actionable lane remains negative
ROI at stored prices. Spread and Total economics supply the aggregate gain.
That limitation is not hidden and should be monitored by the release identifier.

## Integrity checks

- Maximum reconstructed forecast difference: `9.18e-10`.
- Runtime replay parity difference: `0`.
- Negative candidate team scores: `0`.
- Locked rows are never rewritten; reader precedence remains release-aware.
- The existing sole writer and sport-scoped `prediction_pipeline:cfb` lease are
  preserved.
- Missing Spread consensus falls back to the independent margin; missing Total
  split evidence falls back to the independent Total.

## Rollback

Rollback is the October 10 r60 member / r114 writer / r86 fixture / r76 outcome
/ r46 compact snapshot / r31 reader family with the October 9 r35 professional
market reader. Rollback must not rewrite any locked October 11 r61 payload.
