# NHL pregame coverage gate r10

Date: 2026-10-08

Starting production base: `2bbcf8f92aff30929145b647e90964dc8355cfa5`

## Defect

After NHL exact-quote release r16 deployed, the production intraday writer
correctly preserved 24 locked rows and wrote six rows for the two future games.
The response snapshot remained on the previous cycle because the line refresh
reported six incomplete SharpAPI scopes. A read-only diagnosis identified every
error as a withdrawn spread or Total on four games whose official status was
already `LIVE` and whose Moneyline, Total, and puck-line records were already
locked. No future game lacked a priced market.

Treating withdrawn pregame markets for an immutable live game as a failure for
later games made the board stale without protecting any writable prediction.

## Repair

The existing NHL line writer remains authoritative. It now requests and checks
complete pregame market scopes for games that remain scheduled, whose state is
unknown, or that lack a complete Moneyline/Total/puck-line lock. Explicitly
live, in-progress, final, completed, canceled, or postponed games are omitted
from new pregame requests only after all three official markets are locked.
Their existing lines, line history, predictions, and lock payloads are not
deleted or rewritten.

## Exact production replay

- Slate games: 10.
- Already locked market rows: 24, unchanged.
- Upcoming games: 2.
- Upcoming official market rows: 6, all priced.
- Previous incomplete-scope errors: 6, all on four live/locked games.
- Repaired incomplete-scope errors: 0.
- Prediction, score, probability, side, price, grade, promotion, demotion, and
  actionable-count changes: 0.

## Rollback

Roll back refresh release r10 to r9 if any scheduled or unknown-state game can
publish with incomplete Moneyline, Total, or puck-line coverage, if a live lock
is altered, or if the sole writer/lease boundary changes. Never rewrite an
existing locked row during rollback.
