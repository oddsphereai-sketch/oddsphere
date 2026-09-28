# NFL player-props injury continuity and next-window recovery

Date: 2026-09-28

## Scope and production boundary

This repair restores the existing NFL player-props product after the current Eagles–Bears Monday
game disappeared when the latest shared evidence lost its injury payload. It also repairs the
next-window state-order deadlock exposed during diagnosis. It changes inference-context continuity,
week-window orchestration, and current-season state ordering. It does not change any independent
model equation, probability formula, projection formula, line selection, grade threshold, stake,
locked decision, settlement result, member copy, label, or layout.

The clean starting base is remote `main` at
`2bf0e34647ea1dfc39b479a27da2a306476a4593`. The active props member / lifecycle / writer releases
are `nfl_player_props_member_2026_09_25_r24_canonical_main_line` /
`nfl_player_props_member_lifecycle_2026_09_25_r7_canonical_projection` /
`nfl_player_props_writer_2026_09_25_r29_team_boxscore_capture`. The active shared NFL writer is
`nfl_forward_evidence_writer_2026_09_28_r48_market_marriage`.

## Reproduced production failure

At `2026-09-28T20:36:11.916Z`, the Week 3 production snapshot contained 3,088 decisions and 2,014
canonical rows, but every represented game had already started. Eagles–Bears (`1392263`, kickoff
`2026-09-29T00:15:00Z`) was absent, so the established lifecycle projected zero member rows and the
page showed zero books, games, and reads.

The shared NFL board itself remained healthy and included Eagles–Bears with three priced markets.
Its immutable history contained verified injury context earlier in the week, followed by later
captures whose injury payload was null after the provider stopped returning the report. The props
context builder selected the latest row as one indivisible bundle and excluded the game as
`game_1392263_injury_evidence_missing` instead of retaining the last verified injury payload.

A direct Week 4 props replay then failed because no Week 4 forward evidence existed. A zero-write
Week 4 forward-writer replay exposed a second rollover dependency: the shared current-season team
state was complete only through Week 2, while the Week 4 NFL forecast requires Week 3. That state
is currently refreshed inside the props writer, which runs only after the NFL forward writer.
The resulting order is circular at a new-week boundary.

## Fixed repair

1. Props context uses the latest complete depth and main-market evidence, while silently retaining
   the most recent verified injury payload for that exact season, week, provider game, kickoff,
   and team identity when the newest payload has no injury report. If no verified injury payload
   has ever existed, the game remains excluded. Both immutable source rows enter the context hash.
2. The base calendar selector remains the operator-controlled floor and continues to protect a
   live Monday game.
3. The sole NFL cron may advance one week early only when a complete current-week published
   snapshot exists and every represented game belongs to an Eastern slate date earlier than the
   established 2 a.m. ET member-board date. A same-date Monday game therefore keeps the current
   week selected. Missing or malformed evidence fails closed to the calendar week.
4. Under the existing `prediction_pipeline:nfl` lease, the cron refreshes and persists the already
   versioned current-season state before the forward writer. The props writer then reuses that
   state and makes zero duplicate state calls. This moves existing bounded work; it does not add a
   second writer, timer, or unbounded provider read.
5. The props reader uses the current calendar-week snapshot when it has member rows. Only when
   that lifecycle projection is empty may it read the immediately following snapshot, and it uses
   the next snapshot only when that snapshot itself has member rows. There is no fabricated board.
6. Locked Week 3 rows, tracking, closing prices, and settlement evidence remain immutable.

## Acceptance gates

- The exact production replay restores Eagles–Bears with no injury hold, while games that never
  had verified injury evidence remain excluded.
- Week 3 remains selected while any Monday game belongs to the current member board date.
- A completed Sunday-only slate selects Week 4 after the existing 2 a.m. ET rollover.
- The current-season state becomes complete through Week 3 before Week 4 forecast generation.
- A Week 4 zero-write sequence yields complete shared context and a nonempty canonical member
  board without prediction/grade rewrites or duplicate state-provider calls.
- The one cron, one lease, one forward writer, one props writer, request ceilings, exact-price
  behavior, T-60 locks, tracking, settlement, member presentation, and zero-stake policy remain.
- Focused tests, `npm run verify:model-change`, latest-main integration safety, protected pull
  request, merge, deployed release proof, natural writer proof, and live member-board proof pass.

Any mixed release, missing game/market, state incompleteness, duplicate current-season download,
locked-row mutation, board flattening, writer overlap, provider-budget increase, or live reader
failure holds or rolls back the orchestration change while preserving immutable evidence.

## Candidate replay result

The final direct Week 3 zero-write replay after the continuity repair produced 42,947 observations,
1,692 exact offers, 357 runtime feature rows, and 291 score-eligible features. Eagles–Bears was
restored without an injury-context hold. Relative to the untouched production snapshot, the
canonical stored board adds only the previously absent game: 113 canonical member rows and six
actionables. Every already-started or locked row retains exact precedence, so this is zero
promotions, zero demotions, and zero mutations inside the previously published 15-game set.

The replay made zero current-season-state provider calls. The only remaining health diagnostics
were the already-established provider catalog/truncation diagnostics; neither excluded the target
game nor emptied its board. Focused inference-context, week-selection, runtime, production-
contract, and snapshot-store tests pass. The natural post-deploy writer and live reader remain the
authoritative acceptance proof.
