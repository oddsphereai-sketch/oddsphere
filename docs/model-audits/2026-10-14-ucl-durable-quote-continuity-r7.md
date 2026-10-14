# UCL durable quote continuity r7

## Scope and authority

- Sport/competition: UEFA Champions League only.
- Markets: Match Result, Double Chance, regulation Total 2.5, and regulation BTTS.
- Forecast/model release remains `ucl_goals_coherent_2026_10_14_r8u_elo_late_consensus`.
- Coherent outcome release remains `ucl_coherent_market_outcome_2026_10_14_r4_target_excluded_late_consensus`.
- Grade release remains `ucl_grade_policy_2026_10_14_r10_agreement_probability_band`; no threshold or grade equation changes.
- Provider identity advances to `ucl_sharp_market_identity_2026_10_14_r3_durable_quote_continuity`.
- Availability authority is `ucl_stored_quote_fallback_2026_10_14_r1_complete_same_book`.
- Member lifecycle advances to `ucl_member_snapshot_lifecycle_2026_10_14_r7_durable_quote_continuity`.
- The sole writers remain `ucl-daily-refresh` and the targeted `ucl-pregame-lock`, both under the existing shared `prediction_pipeline:soccer` lease.
- Starting production base: `9afd70c7c75e2de5d2db34deac409653d306808c`.

## Defect

The durable UCL line-history table contained complete real same-book quotes for
an unlocked game, but the preview builder used those rows only to reconstruct
movement trails. When the newest Sharp response omitted an entire market, the
normal exact-price selector still received no rows and published a blank price.
Porto–Betis therefore retained a Match Result quote while Double Chance, Total,
and BTTS were held even though complete previously captured tuples existed.

## Repair

After the existing bounded current-provider retry finishes, UCL alone may fill
an entirely absent market from line history. Recovery requires every required
outcome from one exact sportsbook and one exact line. The latest observation
for each outcome is used only because every persisted row came from a previously
complete market tuple. A complete current provider market always wins and is
left byte-for-byte untouched.

Recovered rows retain their original capture timestamps and exact prices. They
are not re-persisted as new provider observations. The historical schema did
not retain Sharp's original event ID, so recovered rows keep that identity null
and are ineligible for UCL's late-consensus score arbitration. They can restore
the existing exact-price/economics/grade path, but they cannot masquerade as a
fresh sharp move or move the projected score. No member copy, stale label,
layout, provider cadence, request ceiling, stake, or writer changes.

## Exact current-board rehearsal

The credential-backed, zero-write October 14 publication rehearsal contained
nine fixtures and preserved the two existing immutable locks. The member board
moved from 33/36 selected prices and three held markets to 36/36 selected prices
and zero held markets. Actionables moved from 12 to 14 through two promotions
and zero demotions: Porto–Betis Over 2.5 and BTTS Yes became Lean at their exact
stored Pinnacle quotes. Double Chance regained its exact quote and remained No
Play under the unchanged policy. No prediction side changed because of the
fallback, and the locked Como–Feyenoord and Liverpool–LASK cards retained their
stored payloads.

## Failure and rollback

An incomplete same-book tuple, missing sportsbook, non-2.5 Total, invalid price,
or missing exact game identity remains unavailable. A current complete provider
market immediately supersedes the fallback. Roll back the r7 lifecycle/r3
provider-identity adapter to r6/r2 if the live board is not 36/36, a recovered
row enters late-consensus arbitration, a fallback is recorded as a new quote,
an immutable lock changes, publication becomes partial, or the sole lease/writer
contract fails.

