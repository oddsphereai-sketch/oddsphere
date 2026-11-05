# CFB professional pressure/reaction adjudication — predeclaration

Date: 2026-11-05

## Defect and frozen example

The current future-unlocked CFB reader can record a qualified Circa split in the
selected side's direction while named books move the spread or price against that
same side.  The grade path adds those facts independently, so the split can leave a
positive confidence adjustment even though the displayed reader says resistance.
The score path can also discard the named books' net response when an intermediate
buyback exists or when the split direction opposes the price response.

The motivating frozen case is James Madison at Southern Mississippi.  JMU has
qualified professional spread pressure, while Circa and Pinnacle both moved their
spread from JMU -14.5 to -13.5.  The incumbent retained the independent score,
classified the complete reader as `reversal`, and left the positive split
contribution inside the grade.

## Product rule declared before implementation

1. The independent PMF remains the sole prior.  No market level is averaged,
   blended, or weighted with the model.
2. A split is pressure at its own source and contract.  It is not by itself a score
   consequence and is not a second vote when a response is observed.
3. A complete, fresh, target-excluded named-book opening/current pair is the
   economic response.  Two agreeing named sources may apply one relative
   innovation to the PMF even when their intervening paths contain a buyback.
4. If the named response opposes the qualified pressure, preserve both facts and
   mark a pressure/reaction conflict.  The response may still author the single PMF
   innovation; the pressure cannot veto it or simultaneously count as confirmation.
5. If the response supports the selected side while qualified pressure opposes it,
   apply the symmetric rule.  This is the paired promotion path required by the
   model-change safety contract.
6. Missing, one-source, stale, future, wrong-contract, target-book, economically
   flat, or cross-book-conflicted response evidence cannot change the score.
7. Public consensus remains context-only.  Offered price and EV remain grade and
   execution inputs, never outcome inputs.
8. Locked records retain exact stored payload precedence.

## Required gates

- Focused unit tests must cover aligned response, opposed pressure/response,
  held/flat response, intermediate buyback with a coherent net response, opposing
  named books, one-source evidence, target exclusion, and exact locked precedence.
- A zero-write current-board replay must report score, side, grade, promotion,
  demotion, and actionable-count changes by release.
- A cross-sport conformance audit must exercise the same pressure/reaction pattern
  in active NBA, NFL, NHL, UCL/EPL, CBB, and CFB readers.  Sports already preserving
  source clocks, response precedence, and unresolved magnitude remain unchanged.
- `npm run verify:model-change`, affected focused tests, TypeScript/build checks,
  integration safety, PR checks, current-main ancestry, and post-merge live release
  verification are mandatory before any success claim.

## Rollback

Rollback restores the November 4 CFB causal-relative-innovation family.  Existing
locked rows always continue to render their stored predecessor releases.
