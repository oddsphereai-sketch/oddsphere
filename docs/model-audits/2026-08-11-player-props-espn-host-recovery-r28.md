# MLB Player Props ESPN host recovery — r28

Date: 2026-08-11

Release: `mlb_props_2026_08_11_r28`

The first hosted r27 refresh reported `PROBABLE_FALLBACK_ESPN_SLATE_EMPTY` even though the same
ESPN scoreboard payload resolved both current probables in local verification. This isolated the
failure to ESPN's primary site API hostname from the production serverless egress range.

r28 preserves the r27 resolver, model logic, provider priority, strict roster/team identity, and
paired board impact. It adds one bounded retry against ESPN's equivalent official site API host
only when the primary host returns no parsed games. A valid primary response is never blended or
overridden. Both official hosts returned the same 309,087-byte 2026-08-11 scoreboard payload in
predeployment verification.

The approved paired result remains 5,874 exact offer rows, 370 opposing-starter holds restored,
32 genuine insufficient pitch-mix rows retained, 11 actionable promotions, 2 demotions, and a
net +9 actionables. The authoritative writer and shared `prediction_pipeline` lease are unchanged.
