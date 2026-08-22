# NFL Regular Season Week 1 evidence board r1

Date: 2026-08-22
Scope: member reader and stored forward-evidence presentation only
Status: candidate; no model, grade, stake, tracking, or settlement promotion

## Decision

Retire the expired August 20 Preseason Week 2 member presentation and replace it
with the genuine 16-game 2026 Regular Season Week 1 evidence board. The board
shows verified schedule, opening/current prices, public splits, injury counts,
expected-quarterback status, venue and weather readiness from the already active
append-only forward-evidence writer.

The failed Week 1 model candidate remains blocked. This release does not use
FanDuel prices as OddSphere probabilities, does not manufacture projected scores,
and does not convert missing model evidence into 48 ordinary `No Play` grades.
Every game is visibly labeled `Bet grade held` and the slate is visibly labeled
`Model validation hold`.

## Releases and gates

- Evidence-board release: `nfl_week_one_evidence_board_2026_08_22_r1`
- Forward schema: `nfl_forward_evidence_snapshot_2026_08_21_r1`
- Forward writer: `nfl_forward_evidence_writer_2026_08_21_r1`
- Display gate: `NFL_WEEK_ONE_EVIDENCE_BOARD_ENABLED`
- Top-level rollback: `NFL_DAILY_EDGE_ENABLED=false`
- Writer lease: `prediction_pipeline:nfl`

The old `nfl::current-week` preseason envelope is preserved for immutable audit
history. When the new display gate is enabled, the member route never reads it.
If the complete Week 1 evidence set cannot be verified, the page fails closed
with an evidence-unavailable hold rather than falling back to preseason.

## Exact production evidence used by the candidate

The read-only adapter was run against the production append-only table on August
22. It built exactly 16 unique Week 1 games, from NE@SEA on September 9 Eastern
through DEN@KC on September 14 Eastern, and reported:

- current named-book odds: 16/16;
- operational Opening trails: 16/16, all explicitly first-observed where the
  provider-native opening endpoint returned no row;
- Playbook public-consensus split sets: 16/16;
- injury reports: 16/16;
- expected depth-chart quarterbacks: 32/32;
- confirmed quarterbacks: 0/32;
- controlled-indoor or in-window weather: 5/16 at the early capture horizon;
- strictly matched SharpAPI split sets: 0/16;
- publication decisions: zero;
- tracking decisions: zero.

Expected quarterbacks therefore display `projected`, never `confirmed`.
SharpAPI is shown unavailable rather than borrowing CFL/NCAAF rows or relabeling
Playbook consensus. Outdoor forecasts wait until the configured forecast window.

## Board impact

The outgoing visible board was an expired, non-tracked preseason rehearsal. At
the time of replacement it showed three Leans, five Watchlists, and 25 No Plays
across 33 remaining predictions. Those labels are retired with their phase; they
are not regraded, settled, or imported into the regular season.

The Week 1 evidence board publishes zero model grades. It therefore makes zero
same-slate promotions and zero same-slate demotions. This is not represented as
a finished paid betting model. The purpose is to make the public state truthful
and continuously current while independent forecasting and exact-price decision
research continues under the normal model-change gate.

## Refresh and failure behavior

The member request performs stored database reads only. Provider calls remain
owned by the leased forward writer:

- one immutable opening capture per game;
- six-hour early observations;
- hourly observations inside 48 hours;
- 15-minute scheduler wakes to catch the T-60 boundary;
- bounded roster calls only at opening and T-60;
- one strict NFL SharpAPI split call when collection is due.

The adapter selects the newest immutable row per game, requires complete slate
identity, rejects mixed season/week payloads, and rejects any evidence row that
claims publication or tracking was enabled.

## Promotion boundary

This release does not close the predictive-model blocker. A regular Week 1
prediction board still requires an independent, timestamp-valid forecast and an
exact-price decision policy that pass chronological probability, calibration,
return, stability, promotion/demotion and board-impact gates. T-60 tuples must be
frozen before official tracking can begin. Until then the evidence board remains
the honest public state.
