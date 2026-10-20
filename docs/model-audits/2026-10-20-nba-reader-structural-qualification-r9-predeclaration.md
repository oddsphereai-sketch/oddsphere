# NBA reader structural qualification r9 — predeclaration

Date: 2026-10-20

Status: production candidate for future unlocked rows; not publishable before owner review and all safety gates

Starting production base: `71549c0cd96eb1fd8d3485493098893002a7375f`

## Defect and bounded repair

The released NBA reader captures complete target-excluded evidence but rejected every opening-day
Spread read. The exact zero-write diagnosis found three structural causes:

1. it compared no-vig price probability at different Spread/Total numbers and required that price
   comparison to align with the number move;
2. any reversal flag from any retail book vetoed a market even when named-book direction and broad
   persistent movement were unanimous;
3. it required a qualifying exact-line money-minus-ticket split before a Spread number read could
   qualify, causing missing or line-null flow to erase otherwise valid same-book chronology.

This candidate repairs only evidence qualification. It does not change the independent score model,
the released two-point Spread authority, the released five-point Total-disagreement authority,
probability calibration, grading, stake, writer, lease, schedule, or locked-record precedence.

## Frozen rule

- A Spread or Total number move owns trail direction when it changes by at least 0.5 points.
- Price direction for Spread and Total is calculated only between two-sided observations at the same
  current number. It is retained as evidence but is not required to duplicate the number direction.
- Moneyline continues to use two-sided no-vig price movement.
- A stable market direction requires at least two-thirds persistence and at least two-thirds supporting
  breadth, with either two named supporting books or one named supporting book plus at least five stable
  moved books.
- Named-book disagreement, reversal, or buyback fails closed. An isolated retail reversal or buyback is
  reported but cannot veto otherwise qualified named-supported broad movement. Material opposing breadth
  still prevents the two-thirds direction gate from passing.
- Fresh source-specific splits are retained. Exact-line flow may confirm or resist the movement; missing,
  line-null, or line-mismatched flow cannot manufacture support and cannot erase valid number chronology.
- Forecast authority remains unchanged: Spread requires two persistent same-direction trails of at least
  two points, including a named book. Total requires two persistent named trails of at least five points
  plus the existing opposing five-point model residual. Direct Moneyline movement remains observational.

## Predeclared current-board expectation

The shadow audit, frozen before production implementation, found that this repair should qualify broad
movement in all three opening-day Spreads while preserving forecast authority on only Boston-Detroit.
The validated categorical Spread mapping should move the Boston margin from about Boston 0.48 to Boston
2.52 and flip its Spread side from Detroit +1.5 to Boston -1.5. Philadelphia +4.5 and Oklahoma City +1.5
should record market confirmation without a score change. Total and direct Moneyline decisions should
remain unchanged.

## Publication gates

Publication requires focused same-number price, named/retail reversal, breadth, target exclusion,
freshness, split-line, authority-boundary, score-coherence, writer-immutability, and locked-precedence
tests; an exact zero-write before/after board with promotions and demotions; TypeScript;
`npm run verify:model-change`; latest-main integration safety; protected pull-request checks; owner review
of the exact board; and post-deploy proof of the release tuple, sole writer/lease, data coverage, coherent
forecast, and unchanged locks.

The authentic observation archive began on 2026-10-15 and has no settled regular-season sample at this
predeclaration. The existing two-season consensus proxy supports the unchanged two-point Spread authority,
not the exact live qualification rule. This release therefore remains provisional and must be evaluated
prospectively by release and locked timestamp. Rollback affects future unlocked computation only and may
never rewrite a locked payload.
