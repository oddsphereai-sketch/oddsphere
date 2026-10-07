# NFL injury continuity r55

## Scope

This repair is limited to the existing scheduled NFL forward-evidence writer and
its BALLDONTLIE injury input. It adds no writer, request, schedule, database
loop, member copy, label, badge, layout, threshold, grade, stake, or lock rule.

## Confirmed defect

The collector already returned `null` for transport, pagination, or response-
shape failure, and the writer retained the latest exact-game report in that
case. A successful response containing no injury rows, however, was normalized
into a non-null game report with two empty teams. That empty structure bypassed
continuity and could erase a previously verified injury. Duplicate player rows
also selected provider order rather than the newest declared timestamp.

## Repair

Writer r55 merges the current and prior exact-game reports atomically by team.
A failed response, a completely empty response, or an omitted previously
verified team unit retains the prior unit with its original timestamps and
provenance. A newer non-empty team unit replaces the prior unit. Duplicate
player statuses select the newest valid provider timestamp. Continuity cannot
cross event or home/away identity, and an empty response without prior evidence
remains unavailable rather than being interpreted as healthy.

There is deliberately no inferred clear. A future authoritative cleared/active
event must be represented explicitly by the provider contract before it may
remove a prior designation.

## Model and board impact

The change only affects future unlocked refreshes whose provider response is
empty or partial while exact-game prior injury evidence exists. Identical
complete inputs are byte-equivalent. It cannot alter already locked payloads.
The provider call ceiling is unchanged. Before publication, the current board
must be replayed without writes and report sides, scores, grades, actionables,
coverage holds, and locks; a hidden flattening, identity mismatch, or lock drift
blocks release.

The select-only October 7 Week 5 audit found the current compact snapshot
healthy at 15 games / 45 markets, all 45 priced, zero Held, zero missing prices,
zero empty trails, and 15 actionables. Grades were 8 Best Angles, 7 Leans, 14
Watchlists, and 16 No Plays. Because the current board did not contain the
defective empty-after-verified transition, r55 changes zero current sides,
scores, probabilities, grades, promotions, demotions, actionables, or locks.
The no-write writer correctly respected the ordinary cadence and performed zero
provider calls when no refresh was due. Synthetic exact-game tests cover the
affected empty, partial-team, newer-duplicate, and cross-game identity cases.

## Rollback

Roll back only the writer release to
`nfl_forward_evidence_writer_2026_10_06_r54_hourly_market_freshness`. Preserve
all append-only evidence and immutable locks.
