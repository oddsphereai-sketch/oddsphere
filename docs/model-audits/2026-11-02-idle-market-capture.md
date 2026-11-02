# Idle MLB/WNBA observation capture

Starting production base: `637e5907609263bbf540c8f688390c23c8a0e65a`.
Operational release: `daily_edge_market_capture_2026_11_02_r1_empty_slates`.

At 17:15Z November 2, the shared five-minute named-book/Kalshi collector still
called MLB and WNBA on empty slates and retained old rows while reporting an
invalid/old Kalshi receipt. The fifteen-minute public collector also entered
its market-capture and snapshot paths for these idle sports. These are avoidable
requests, independently of the separate database capacity finding.

Both existing routes now read at most one canonical game ID for MLB/WNBA in
the inclusive current ET slate through six days ahead. A verified empty result
returns zero provider calls and zero market/member writes. A real game resumes
the unchanged path on the next existing tick, regardless of month, division or
book. A failed read cannot establish emptiness and retains the existing path.
Other sports perform no new query. The schedule-ingestion jobs remain independent
and continue discovering new games; tracking and settlement remain unchanged.

This changes no eligible game's inputs, prices, probabilities, predictions,
grades, stakes or locked record. Actionable promotions/demotions are 0/0, and
active board-count impact is zero. No model/calibration identifier is reused for
changed math; only the observation-capture operational identifier is new.

Functional route tests execute the actual handlers with controlled dependencies:
empty MLB/WNBA must reach no provider, history request, observation writer or
member publisher; one real game must retain all old source calls and results;
read failures must retain capture; ET midnight/DST windows are exact; all seven
other sports bypass the new schedule read; cadence and existing lease options
remain unchanged. Existing split/provider tests and full model verification
accompany build, type/lint, fresh-main integration and protected PR publication.

Separate infrastructure finding: database logs show unclean restart recovery at
17:02:16Z and another startup at 16:21:44Z. The Small instance has 2 GB physical
RAM; the dashboard reported a severe memory commitment warning. A short SQL read
confirmed ordinary configured memory limits and only eight idle/one active
foreground connection at inspection. This proves restarts and capacity risk,
not their precise cause. The owner questioned the proposed paid Medium upgrade;
its review was cancelled and the original Small selection restored. No
infrastructure setting was applied. Finish workload repairs and reassess measured
pressure before proposing any paid change. Do not call provider allowance exhausted
or the database issue resolved based on these observations.

Rollback removes only the two route guards and the operational helper. It
restores needless idle polling; it never rewrites retained observations,
forecasts, prices, tracking or locked payloads.
