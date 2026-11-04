# CBB final-result continuity without changing locks

Starting production base: b6016239ab0fc98a223aeeb786da284fdb2a2b87.
Scope: fixture terminal facts and bounded existing settlement catch-up. Model,
calibration, forecast, price, pick, grade, stake, member payload and every
stored locked identity/time remain unchanged. Promotions/demotions/actionable
board impact:0/0/0. Single authoritative CBB seeder and prediction_pipeline lease.

## Confirmed gap

Nine locked November2 records in three games remained pending. The earlier
final-game-only audit could not detect them because their canonical status was
still STATUS_SCHEDULED. Three exact-game provider reads confirmed final scores:

| Provider event | Original canonical home /away | Official final, mapped to those original teams | Source change |
| --- | --- | --- | --- |
|10882488|Northern Kentucky /UTEP|84–76|19:00→19:30 UTC start|
|10882545|Purdue /Gonzaga|72–78|provider home/away labels reversed|
|10882571|Florida State /Florida A&M|112–69|provider home/away reversed;01:30→02:15 UTC start|

These are exact provider IDs and exact same two team IDs. A current home label
cannot reinterpret a previously locked `home` selection. The canonical home/
away team IDs and original scheduled time therefore remain authoritative for
the original picks; final points follow the correct teams. No old projection,
price, pick or evidence is reconstructed. Independent current provider evidence:
https://ncaab.balldontlie.io/#get-a-specific-game . Private read-only capture:
`/private/tmp/oddsphere-cbb-pending-official-audit-20261104.json` and exact
original identities `/private/tmp/oddsphere-cbb-pending-identity-audit-20261104.json`.

## Repair

Seed r7 writes only status, two team-mapped final scores and period on a
conflicting locked fixture. The conditional update rechecks the exact stored
canonical game ID, provider ID, original time, status and both team IDs. No
canonical start/date/team, prediction record or member snapshot is updated.
Unknown participants, wrong event/season, nonfinal/negative/fractional/tied
scores, canceled/postponed fixtures, ET-slate changes, >18h shifts and conflicting
already-recorded finals remain held. Ordinary live provider identity changes
continue to be rejected. The existing grader settles original rows afterward.

The same CBB cron discovers at most three distinct pending older slate dates
within its existing six-day grading window and reuses the canonical seeder.
Previously it seeded yesterday and forward dates while grading six historical
days, so a missed result older than yesterday could remain scheduled forever.
This adds no independent poller, writer or timer, and adds zero provider calls
when the pending ledger is clear. Prediction/grade release IDs are unchanged
because this is completion of official outcome data, not a new model or pick.

Focused tests cover exact score orientation, wrong identities/times/seasons,
nonfinal/malformed/revised-final rejection, conditional terminal-only writes,
complete locked-fixture/member immutability and bounded catch-up query scope.
Full model verification, types, lint, clean fresh-main protected publication and
live score/normal-grade/cache/alternate-line reconciliation remain required.
