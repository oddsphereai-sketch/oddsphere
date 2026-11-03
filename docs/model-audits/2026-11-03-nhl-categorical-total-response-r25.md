# NHL categorical Total response r25

Date: 2026-11-03  
Scope: NHL regular-season Total market interpretation only

## Finding

The r24 Moneyline and puck-line readers correctly distinguished confirmation,
resistance and unresolved evidence. Its Total lane, however, could become
entirely unavailable on the ordinary two-book Circa/Pinnacle board because the
target-book exclusion left only one complete comparison book. The model then
retained the independent Total—which was the safe numerical fallback—but did
not interpret the complete same-book Total path or retain a categorical Total
receipt.

## Repair

R25 adds a target-excluded fallback, not a market blend. Each complete
same-book Total pair is represented on one economic axis: posted line plus the
no-vig within-line Over price. The full path is classified before the endpoint
can receive authority. Stable material movement plus complete split pressure
becomes confirmation when directions agree and resistance when they oppose.
Flat, sub-material, mixed, incomplete, bought-back or reversed evidence remains
unresolved and has zero score or grade consequence.

When qualified, the observed economic-axis innovation is applied once to the
independent Total. The margin is re-solved at that Total to preserve the
incumbent Moneyline probability and one coherent score tuple. The existing
complete target-excluded professional board remains primary and prevents the
fallback from double-counting the same market. Aligned and opposed Total reads
have symmetric tested promotion/demotion paths. No favorite, Over, Under or
actionable quota exists.

## November 3 spot check

The exact unlocked current board contains two games / six markets and completes
with zero errors and full prices. Relative to r24 it has zero pick changes,
zero promotions, zero demotions and an unchanged four actionables.

- ANA at VAN: the apparent 6.5 to 7 move is a buyback on the full Circa
  no-vig economic path. It remains unresolved; Under 7 and the 6.68 independent
  Total stay unchanged.
- CAR at NSH: the Circa path is stable but its Under response is below the
  predeclared material threshold. It remains unresolved; Under 6.5 and the 6.27
  projection stay unchanged.
- EDM at NJD was already locked under r24 during the audit and was inspected
  read-only. Its flat/sub-material Total evidence correctly had no authority.

This is a functional product correction, not a future-accuracy claim. Locked
r23 and r24 payloads remain byte-authoritative. R25 applies only to unlocked
rows and future locks through the existing NHL writer and
`prediction_pipeline:nhl` lease. It adds no provider call, cron or writer.

## Verification

- `node --import tsx scripts/test-nhl-sharpapi-complete-market-scopes.ts`
- `node --import tsx --env-file=<production-local-env> scripts/test-nhl-regular-model.ts`
- `npx tsc --noEmit`
- `node --import tsx --env-file=<production-local-env> scripts/operator/audit-nhl-total-reader-functional-consequence.ts --date=2026-11-03`
- `npm run verify:model-change` before publication

Rollback: restore r24 for future unlocked writes if r25 creates a mixed release
within one unlocked game, changes a sub-material/buyback board, reduces price
coverage, breaks snapshot publication, overlaps the NHL writer lease, or changes
any previously locked payload.
