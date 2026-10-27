# MLB player-props direction-bias audit

## Question

Does the active MLB player-props release produce too many Unders because of a
directional model defect, and should production rebalance the board?

## Evidence repair

The first production-ledger read was invalid for postseason games because the
official game-log request omitted `gameType=P`. The settlement-continuity
repair is documented separately. All figures below come from the corrected,
SELECT-only private exact-offer replay; stored locked and settled rows were not
changed.

## Current release

Release `mlb_props_2026_10_21_r44` contains 622 canonical main-line decisions:

- 411-211 overall (66.08%).
- 179 Over selections and 443 Under selections.
- Overs went 102-77 (56.98%).
- Unders went 309-134 (69.75%).
- Actionables went 8-4: two Overs and ten Unders. Under actionables went 7-3;
  Over actionables went 1-1.

The direction mix is therefore visibly Under-heavy, but the replay rejects a
generic Over promotion or Under suppression. The selected Unders materially
outperformed the selected Overs; cosmetic balance would lower accuracy.

## Market-reader diagnosis

The r44 target-excluded market reader made 46 direction changes: 19 corrections
and 27 harms. The effect is market-specific rather than a universal market or
direction failure. Batter Hits and Total Bases benefited. H+R+RBI, Runs,
Singles, and Pitcher Strikeouts were weaker on the postseason block, but the
preceding r43 chronology did not confirm a safe blanket removal for the first
three. Pitcher Strikeouts favored the independent direction in both r43 and
r44, but the combined sample was only 24 rows and both variants remained below
50%; its sole current actionable market-read selection won. That is not enough
evidence to replace the production forecast head.

## Decision

No MLB direction quota or unconfirmed model change ships from this audit.
Production keeps its two-sided forecast behavior and r44 grade policy. The
verified correction is the postseason settlement repair, which restores
truthful forward measurement so the next release can be selected on real
results instead of false voids. Future candidates must improve a market on
chronological selection and confirmation blocks, preserve or pair actionable
promotions and demotions, and retain exact locked-record precedence.
