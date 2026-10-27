# MLB player-props postseason settlement continuity

## Scope

This is a settlement-only correction. It changes no projection, probability,
side, price, grade, stake, board row, provider cadence, lock, copy, or layout.
Existing settled and void records remain unchanged.

## Defect

MLB Stats game-log requests defaulted to the regular season. The internal
settler and private release-pure replay therefore could not find postseason
game IDs. After the existing bounded retry, the settler incorrectly voided
postseason hitter and pitcher rows. Hitter rows also received a pitcher-only
error message.

## Repair

Settlement and private audit callers now explicitly request both regular-season
and postseason logs (`gameType=R,P`). Pregame model callers retain their prior
default, so no model input changes under an existing release. Settlement runs
record `mlb_props_settlement_2026_10_27_r2_postseason_game_logs` in metadata.
Missing-log errors now identify the correct hitter or pitcher family.

## Evidence and immutability

- The official endpoint returned 151 regular-season logs and omitted game
  `849804`; a postseason request returned 11 logs and contained that game; the
  combined request returned 162 and contained it.
- The corrected read-only September 27 through October 27 replay recovered
  19,949 exact settled offers across 2,708 canonical main-line forecasts.
- Focused URL tests prove settlement requests `R,P`, while the model-facing
  default remains unchanged.
- Previously voided rows are not rewritten. Any historical reconciliation
  requires a separate owner-approved, append-only audit procedure.

## Rollback

Rollback only the explicit settlement game-type option and settlement release
metadata. Do not change any locked or settled record.
