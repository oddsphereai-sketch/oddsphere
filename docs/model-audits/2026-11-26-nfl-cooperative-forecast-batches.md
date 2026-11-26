# Cooperative NFL forecast scheduling

## November26 cooperative NFL forecast batches R121

The sole NFL forward writer is
`nfl_forward_evidence_writer_2026_11_26_r121_cooperative_forecast_batches`.
All model, calibration, decision, member, fixture, snapshot and tracking releases
remain unchanged. Props generation R62 and NBA48/NFL123 writers are unchanged.

The existing shared NFL route launches props and Daily Edge work together. The
forward writer previously built every planned game in one synchronous flatMap,
which cannot service the other workload's ready I/O callbacks. In two ordinary
November25 final-window runs, forward forecasts became ready at +252/+240 seconds
and props resumed shortly afterward; neither run made a final AI claim. This
establishes a scheduling hazard, not the precise duration of each provider call.
The closed expired final remains unchanged.

Yield one Node event-loop turn before each existing per-game calculation, collect
its whole rows in the same original order, then use the unchanged append,
publication and tracking authorities. No callback arithmetic, evidence, cutoff,
request, provider/model count, spending limit, lease, deadline, phase or slot is
changed. Unexpected build errors still reject the overall operation; existing
per-game holds remain explicit. Existing opaque locks retain exact precedence.
At fixed inputs, forecasts and actionable counts are unchanged: zero promotions,
demotions or net board-count change. This is scheduling, not a calibration tune
or predictive-performance claim. A single long game is not preempted; live
completion and latency still require ordinary production evidence.

Blocked-network controls prove ready callbacks progress between games, the
existing two-phase reserve remains strict, and complete ordered payloads,
skipped games and legacy records are identical. Require two NEW consecutive
fresh triple whole-product CLEAR rounds, mandatory local and exact hosted mocked
realPG checks, latest-main/no-overlap/strict protected expected-head PR merge,
actual Ready/www/source, and ordinary review/member/retention/lock verification.
No paid test, extra review, historical replay or manual production refresh.

Actual source packets, private timing logs and usage evidence remain outside the repository.
