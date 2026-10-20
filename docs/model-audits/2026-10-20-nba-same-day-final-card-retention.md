# NBA same-day final-card retention — 2026-10-20

## Incident

After BOS–DET became `STATUS_FINAL`, the rolling schedule removed the event. The rolling member board uses that schedule as its event-identity boundary, so the completed locked card disappeared before the ET board-day rollover.

## Repair

- Advance the member-board contract to `nba_rolling_member_board_2026_10_20_r3_same_day_final_retention`.
- Treat ESPN `STATUS_FINAL` as member-visible inside the current seven-day schedule window.
- Keep canceled events excluded.
- Continue advancing the window only through the existing ET board-date rollover.

This does not create or update predictions. It does not mutate, reconstruct, or reinterpret any locked record. The existing locked-snapshot precedence remains authoritative, including the approved read-only BOS–DET legacy evidence recovery.

## Verification contract

- `STATUS_FINAL` is included in the member schedule.
- a noncanonical plain `final` value remains excluded, preserving the explicit ESPN lifecycle vocabulary;
- `STATUS_CANCELED` remains excluded;
- the rolling-board release bump invalidates the older cached schedule contract and causes the normal snapshot recovery/publisher path to rebuild the board;
- NBA lock and immutable-snapshot tests must remain green.
