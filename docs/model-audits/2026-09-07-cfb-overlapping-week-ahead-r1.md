# CFB overlapping week-ahead publication r1

Status: implemented in the combined r63 production candidate. Outcome-blind schedule/reader
repair; no model, price, grade, stake, lock, or tracking rule change.

## Incident

At 2026-09-07 18:55Z the complete September 3-7 evidence wave contained 106 model-covered
games, but only SMU at Florida State remained in the future. The member page therefore showed
one upcoming game even though the provider already published 131 games for September 10-14,
111 of which resolve to the qualified CFB model artifact. The existing single-window lifecycle
intentionally kept the Monday game visible until kickoff, but it also prevented the next slate
from being collected or displayed.

## Declared scope

- Sport/model family: CFB weekly schedule collection and member fixture selection only.
- Sole writer: the existing `cfb_forward_evidence` writer under
  `prediction_pipeline:cfb`; no second writer, timer, or member-side provider call.
- Candidate releases: weekly window
  `cfb_weekly_window_2026_09_07_r4_overlapping_week_ahead`, writer
  `cfb_forward_evidence_writer_2026_09_08_r56_week_ahead_schedule_continuity`, member fixture
  `cfb_v1_member_fixture_2026_09_07_r51_overlapping_week_ahead`, and compact snapshot
  `cfb_forward_member_snapshot_2026_09_07_r9_overlapping_week_ahead`.
- Unchanged: score model, PMF, calibration, probability, side, exact-price selection, EV,
  confidence/economics bridge, grade, execution status, stake, provider identity, T-60 timing,
  immutable locks, official tracking, settlement, and all prior rows.

## Candidate behavior

After the complete current opening wave reaches Sunday Eastern time, the product may expose an
overlapping lookahead: every still-current game remains eligible while the next Thursday-through-
Monday window is seeded and displayed. The writer still collects only one bounded weekly window
per invocation. An on-time T-60 capture or release refresh in the current window outranks the
lookahead; an unseeded/incomplete next opening wave outranks an ordinary unlocked-cadence refresh.
After seeding, each window retains its own game count, cadence, exact provider identity, and lock
history. Tuesday naturally makes the prefetched window primary.

The member fixture may combine only those two adjacent verified windows during the overlap. It
does not fabricate a game, price, split, prediction, or lock. Its label must make the overlap
explicit. Empty or incomplete current evidence cannot authorize early lookahead.

## Pre-change evidence and gates

- Current stored wave: 106 games, September 3-7, one future game at 23:30Z on September 7.
- Next provider wave: 131 scheduled games, 111 model-covered, September 11 00:00Z through
  September 13 03:59Z.
- The same eligible tuples must remain byte-equivalent. Board impact is coverage-only: the one
  remaining current game is retained and up to 111 next-window games may be added as provider-
  backed opening evidence. No current game, tuple, actionability, or lock may be demoted or
  removed by the overlap.
- Focused weekly-engine, CFB production, member-reader, writer, tracking, cross-market, and Daily
  Edge tests; `npm run verify:model-change`; production build; clean latest-main integration safety;
  protected PR checks; and exact-tree verification are mandatory.
- Live acceptance requires a successful natural CFB writer cycle, a released lease, both the
  current future game and the next verified slate in the member snapshot, coherent release IDs,
  unchanged existing current-game tuples, and a responsive member page.

## Rollback

Roll back the four candidate releases together if the overlap hides the current Monday game,
misses its T-60 lock, mixes game counts between windows, duplicates a provider game, changes an
existing prediction/price/grade/stake, exceeds the existing provider/request bounds, leaves a
lease active, produces a writer/reader error, or publishes an incomplete next wave as complete.
Never rewrite evidence, locks, or tracking rows during rollback.

## Candidate result

The final combined no-write production replay completed the full next window with 111
model-covered games and 175 market evaluations. It produced 6 Best Angles, 45 Leans, 85
Watchlists, and 39 No Plays, with no capture failures. The schedule-correction repair is included in writer r56 so the
verified slate can reach the existing atomic append and compact-snapshot path.
