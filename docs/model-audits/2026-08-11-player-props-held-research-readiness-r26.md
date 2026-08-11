# MLB player props held-research readiness — r26

Date: 2026-08-11

## Finding

Live r25 publication correctly held incomplete rows, but secondary launch
checks for identity, recent form, direct matchup, and environment still judged
every row as though it carried a normal grade. In particular, batter-versus-
pitcher history cannot exist while an official opposing starter remains
unannounced, so the direct-matchup check falsely closed the whole launch gate.

## r26 contract

All required-research checks now share one invariant: a complete row must pass
its normal coverage checks, while an incomplete row is tolerated only when it
is explicitly `PENDING_DATA` or `RESEARCH`. Actionable rows retain the stricter
five-log, model-output, model-context, required-research, price, freshness, and
identity requirements.

Paired impact is unchanged: zero promotions, zero demotions, and zero stake or
probability changes. The live refresh process continues to retry source data;
when an official starter posts or a pitch-mix sample clears the threshold, the
next refresh rebuilds the affected game and re-evaluates the row normally.
