# CFB Virginia split-identity repair predeclaration

## Owner direction

The owner reported that the Virginia-Duke member card lacked fallback sharp
splits and directed Oddsphere to repair actual ingestion or matching failures,
then verify health across every Daily Edge model.

## Observed failure

At 2026-10-23T16:55Z the published CFB snapshot was current and already held
fresh Playbook public splits for Duke at Virginia. SharpAPI simultaneously
returned one complete DraftKings split row for the exact event
`ncaaf_dukebluedevils_virginiacavaliers_2026-10-23_b3`, but the CFB strict
identity resolver rejected provider label `Virginia`. The generic prefix path
correctly considered both Virginia and Virginia Tech compatible, yet the
abbreviation-scoped alias registry had no exact `UVA -> Virginia` authority.
The same resolver correctly matched Duke.

The same game also exposed a separate availability-freshness gap. The sole
writer polled all configured official conference sources at 16:50Z, before the
ACC published its exact Duke-Virginia report. A read-only audit at 17:01Z found
the newly available exact report with 38 unavailable players. Because the game
was still more than three hours away, the prior six-hour cadence could leave
that official report absent until the final pregame window despite the source
having become available.

## Bounded correction

Add only the exact abbreviation-scoped provider alias `UVA -> Virginia`.
Retain the global ambiguity rejection, and explicitly test that provider label
`Virginia` cannot attach to `VT`. Advance the CFB SharpAPI split-source release
to r4 and the sole CFB writer to r135 so future unlocked evidence records the
new source behavior. No provider, cadence, pagination, market threshold,
model equation, grade rule, stake rule, reader, or second writer is added.

Keep the same bounded official-source collector and 12-request ceiling, but
expand its existing hourly pregame cadence from the final three hours to the
final twelve hours. Advance the collector to r64 and the sole writer to the
combined r135 release so the late report is recovered by the next hourly
authoritative run. The default six-hour cadence outside that window is
unchanged.

## Model and lock boundary

This repair can restore a previously omitted market-input row and therefore is
treated as a model-input change. It applies only to future unlocked captures
through the existing `prediction_pipeline:cfb` lease. Existing locked payloads
remain immutable and retain unconditional reader precedence.

## Acceptance gates

- Exact unit coverage proves `Virginia` resolves to UVA and fails for Virginia
  Tech, and proves the complete Duke-Virginia split row attaches to game
  `457380`.
- The live read-only provider audit moves Duke-Virginia from unmatched to one
  exact complete row without loosening any other identity.
- A same-input current-board rehearsal reports every pick, probability, score,
  grade, promotion, and demotion changed by the restored input before any live
  write.
- Cadence tests prove the official source remains bounded within an hour and is
  due immediately after an hour throughout the final twelve pregame hours.
- Focused CFB tests, TypeScript, `npm run verify:model-change`, clean latest-main
  integration safety, protected PR checks, and post-deploy live evidence must
  pass before success is declared.
