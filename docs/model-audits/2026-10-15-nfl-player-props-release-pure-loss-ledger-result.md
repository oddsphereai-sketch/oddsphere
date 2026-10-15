# NFL player props release-pure loss-ledger result

Date: 2026-10-15
Status: diagnosis complete; no model or grade release authorized

## Exact scope

Week 5 is the first immutable complete-board capture. It retained 451 exact offered rows. Official
outcomes settle 409 offers into 227 forecast scopes, including 135 canonical main-line scopes:
69 wins and 66 losses. All 135 settled canonical scopes join to the strictly shifted feature frame.

Forty-two exact offers across 26 scopes do not have an official player-stat match. They are
concentrated in Receiving Yards, Anytime TD, Rushing Yards, and Receptions and include inactive or
low-roster-certainty identities. They remain an explicit participation/identity data-quality queue;
they are not silently graded as losses or reconstructed.

Weeks 1–4 remain a separately labeled actionable-only archive. They are used below only for the
stated grade diagnostic, not as complete-board performance.

## Family-by-family loss ledger

| Family | Canonical W-L | Actionable W-L | Loss components that separate from matched wins |
|---|---:|---:|---|
| Passing Attempts | 4-0 | 0-0 | No loss cohort |
| Passing Completions | 3-1 | 0-0 | Single role-collapse loss; insufficient support |
| Passing Yards | 3-1 | 0-0 | Single loss; insufficient support |
| Rushing Attempts | 7-1 | 0-0 | Single game-script/share loss; insufficient support |
| Rushing Yards | 6-8 | 0-2 | Team opportunity and efficiency |
| Receptions | 17-11 | 0-0 | Role survival, player share, and pregame matchup |
| Receiving Yards | 18-10 | 0-0 | Efficiency |
| Anytime TD | 11-34 | 0-0 | Workload/share and pregame matchup; rare-event calibration remains material |

The matched comparison pairs each loss with the nearest win from the same family and position by
locked final probability and grade. The 4,000-draw bootstrap is descriptive and does not supply an
untouched confirmation set.

| Family / component | Loss minus matched win | 95% interval |
|---|---:|---:|
| Rushing Yards team-opportunity harm | +0.488 | [+0.216, +0.752] |
| Rushing Yards efficiency harm | +0.816 | [+0.459, +1.173] |
| Receptions role harm | +0.389 | [+0.044, +0.825] |
| Receptions share harm | +1.069 | [+0.399, +1.823] |
| Receptions matchup harm | +0.748 | [+0.248, +1.274] |
| Receiving Yards efficiency harm | +1.799 | [+0.432, +3.445] |
| Anytime TD workload/share harm | +0.457 | [+0.013, +0.848] |
| Anytime TD matchup harm | +0.187 | [+0.052, +0.305] |

These results narrow the next independent work. Receptions needs pregame role/share survival;
Receiving Yards needs conditional efficiency and tail handling rather than another target-budget
blend; Rushing Yards needs team carry volume plus conditional efficiency; Anytime TD needs bounded
opportunity and matchup calibration. Actual Week 5 component values are diagnostic labels only and
are prohibited as candidate inputs.

## Forecast failure versus grade failure

Sixty-six canonical forecasts lost, but only two were actionable. Both were Rushing Yards Best
Angles:

- Matthew Stafford Over 1.5: actual 0; independent point 7.92; published point 2.17; final
  probability 55.95%; DraftKings moved its line one yard against the pick while FanDuel was flat.
- Ray Davis Over 2.5: actual 2; independent point 9.53; published point 3.83; final probability
  60.07%; role and carries exceeded prior, but realized yards-per-carry collapsed.

This distinguishes a broad point-forecast problem from a narrow grade failure. In the Weeks 1–5
actionable archive, Rushing Yards Best Angles at lines `<= 5` are 3-5 and -1.575 units; Rushing
Yards Best Angles above 5 are 5-3 and +1.530 units. The low-line split was discovered in opened
data and is not itself a confirmation result.

## Market-reader result

The Week 5 observer contains 3,694 immutable rows across 1,097 identities: 2,621 provider openings,
813 T-24 observations, and 260 T-60 observations. It includes Circa, named retail books, and unknown
books. Historical Pinnacle and NoVig reference rows did not exist in Week 5, so the audit records
zero qualified target-excluded reference scopes rather than substituting a later quote.

Same-book evidence was frequently unavailable: 62 of 135 canonical scopes have no complete
opening-to-lock pair. Among available scopes, caution is not a reliable automatic flip. The two
actionable losses illustrate the boundary: Stafford had one adverse retail move, while Davis was
flat. Neither had the source-qualified, target-excluded reference evidence required for an opposite
prediction. Market reading remains a separate caution/demotion layer.

## Current-board rehearsal

The October 15 Week 6 snapshot has 39 actionables: 14 Best Angles and 25 Leans. It contains one
low-line Rushing Yards Best Angle, Aaron Rodgers Over 0.5. Its independent probability is 78.22%,
but its published probability is 54.28%, the target-excluded market is 47.37%, and no qualified
Pinnacle/NoVig reference pair supports it.

A separately bounded promotion screen finds three Watchlist Receptions with final probability at
least 63%, exact-price EV and edge at least 5%, and both Pinnacle and NoVig confirming the side:
Jakobi Meyers Over 2.5, Tetairoa McMillan Over 4.5, and Dalton Kincaid Under 4.5. Applying the entire
unconfirmed pair would demote one and promote three, moving actionables 39 to 41 rather than
flattening the board. This is a zero-write rehearsal, not a live recommendation or validated rule.

## Decision

Do not change production from this opened development week. The causal diagnosis is materially
better than the prior aggregate replay, but the low-line demotion and dual-reference promotion
lanes lack an untouched release-pure confirmation. The paired candidate and its prospective gates
are frozen in the companion predeclaration. Existing predictions, probabilities, grades, stakes,
prices, and locked records remain unchanged.

## Reproduction

```bash
npx tsx --env-file=.env.local scripts/operator/report-private-player-props-tracking.ts \
  --sport=nfl --season=2026 --week=5 --include-rows --out=/tmp/nfl-props-private-week5.json
npx tsx --env-file=.env.local scripts/operator/export-nfl-player-props-loss-ledger-evidence.ts \
  --season=2026 --week=5 --out=/tmp/nfl-props-loss-ledger-evidence-week5.json
football-research/cache/nfl-model-env/bin/python \
  scripts/operator/audit_nfl_player_props_release_pure_loss_ledger.py \
  --tracking-report /tmp/nfl-props-private-week5.json \
  --evidence /tmp/nfl-props-loss-ledger-evidence-week5.json \
  --output /tmp/nfl-props-release-pure-loss-ledger-week5.json
```
