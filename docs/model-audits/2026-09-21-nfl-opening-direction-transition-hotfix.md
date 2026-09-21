# NFL opening-direction release-transition hotfix

Date: 2026-09-21

## Incident

The first production cycle after the opening-direction release correctly wrote current-release evidence for the two games that were still replaceable. Fourteen games were already immutable at T-60 under the immediately preceding September 20 r17/r20 authority. The compact fixture transition allowlist still named the older September 16 r16/r19 authority, so it rejected the valid 14 locked rows and reported 2/16 coverage. The reader retained the previous complete compact snapshot; no board disappeared and no locked prediction was rewritten.

## Repair

The fixture transition now accepts only the explicitly versioned September 20 r17/r20 and September 16 r16/r19 predecessor authorities, and only when each payload independently proves an on-time immutable T-60 tuple: three distinct markets, locked/evaluated timestamps equal to capture, matching game identity/start, an observed quote no later than capture, and a valid T-60 lag. The stale stored tracking boolean is not trusted because the existing tracking serializer already recomputes that boundary from the immutable payload. Current r18/r21 authority still wins for every game where it exists. An unlocked or incomplete preceding-release row remains excluded and causes the completeness gate to fail closed.

Publication releases advance to writer r36, fixture r26, and compact snapshot r18. The preceding opening-direction r17 compact snapshot is retained as the first bounded reader fallback, followed by the existing r16 and older fallbacks.

## Scope and board impact

This repair changes zero model probabilities, prediction sides, projected scores, grades, prices, promotions, demotions, action counts, stakes, provider requests, cron cadence, tracking records, copy, or labels. It only permits a complete 16-game snapshot to combine valid immutable preceding-release games with current-release replaceable games during the one-way release transition.

Rollback is the complete r35/r25/r17 publication family. Existing immutable evidence and tracking rows are never modified.
