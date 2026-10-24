# Daily Edge and Player Props health audit

Date: 2026-10-24

## Scope

This audit reviewed the active MLB, WNBA, NBA, NFL, CFB, NHL, EPL, and UCL
Daily Edge products plus MLB, NBA, and NFL Player Props. It checked current
schedule identity, stats/features, injuries or availability where supported,
current and opening prices, two-sided lines, same-book history, public/sharp
context, model and calibration releases, projection/pick/grade coherence,
publication, locking, tracking, and writer ownership.

It did not reinterpret or rewrite any locked public record. No model threshold,
forecast equation, side, probability, grade, or stake was changed merely to make
a board look more active.

## Repairs

### NBA Player Props audit correctness

Two operator audits replayed the complete historical odds table as though every
row were current. That could crash the audit or create false comparisons while
the production props board itself remained healthy. PR #788 moved both audits to
the release-pure current NBA props snapshot and added a shared regression.

Post-repair audit evidence:

- 563/563 current decisions were read with zero zero-projection rows;
- the 285-row rebound family reproduced exactly; and
- side, grade, promotion, and demotion changes were all zero.

### EPL scheduled-fixture price recovery

The EPL four-fixture recovery ceiling was correct, but slate-order selection
could allow already-started or final fixtures to consume every retry before a
scheduled fixture. Lifecycle r6 gives incomplete scheduled fixtures first use
of the same bounded allowance. Details and acceptance evidence are in
`docs/model-audits/2026-10-24-epl-scheduled-price-recovery-priority.md`.

## Daily Edge findings

### MLB

- One-game authoritative slate with complete Moneyline, Total, and first-five
  prices, splits, three-stop trails, and fresh timestamps.
- Both probable starters and their statistics were present; full-game and
  first-five histories, weather, and park context were available.
- The lineup remained correctly marked not yet announced rather than inferred.
- No high-severity health finding. Two medium sharp-context warnings remained
  observational and did not justify a model change.

### WNBA

- One game and all three markets had complete current prices, split context,
  three-stop trails, and fresh evidence.
- Runtime, calibration, reader, and registry release identifiers agreed.
- No critical or warning finding required a change.

### NBA

- Eight games and all 24 Moneyline, Spread, and Total evaluations were priced.
- The current store contained 830 quote rows, 2,942 history rows, and 2,052
  split rows. Every market had complete multi-book current pairs, a real
  opening, and at least two books with a same-book sequence.
- Sixteen official Moneyline/Total reader candidates included support,
  resistance, and independent-model-led states with exact price, movement,
  Playbook, and SharpAPI evidence.
- All eight games had verified availability for both teams: 36 players total,
  with the official NBA report as the fallback. Adding that fallback changed
  zero scores, picks, grades, or projections relative to ESPN-only input.
- Model, market reader, prices, projection, grade, lock, and member card were
  coherent. No live NBA forecast change was supported by this audit.

### NFL

- Fourteen games, 42 markets, 112/112 complete current multi-book rows, and
  eight books per game.
- The health contract reported no critical finding or warning.
- The board contained 13 Best Angles, 7 Leans, 10 Watchlists, and 12 No Plays at
  the audited release.
- A 94-lock historical reader audit had 100% current-price, opening-price,
  Playbook, and chronology coverage. SharpAPI-specific split coverage was about
  56%; the remainder correctly used the released fallback rather than
  fabricating sharp attribution.

### College Football

- Ninety-six games and 288 expected markets: 95 Moneylines, 96 Spreads, and 96
  Totals.
- The only missing Moneyline was the FCS-only Murray State-South Dakota State
  game. Six offered provider books supplied its Spread and Total but none
  supplied a Moneyline, establishing genuine source unavailability rather than
  an identity or pagination defect. No FBS game lacked a price.
- 30,107 evidence rows were available; all 96 games had quarterback, team, and
  coordinator features and all 96 had quarterback projections.
- Official injury/availability reports were verified for 31 games and
  unavailable for 65. Unavailable evidence remains unavailable and is never
  treated as a healthy roster.
- The board contained 33 Best Angles, 52 Leans, 130 Watchlists, and 31 No Plays.

### NHL

- Twelve games and all 36 Moneyline, puck-line, and Total markets were priced.
- Current stats and roster coverage were healthy; the lowest roster coverage
  was 86.36%, and all 12 games had Playbook split context.
- The reader classified 11 games as independent and one as market-confirmed;
  the board contained 20 model-only and 16 market-watch decisions.
- No high-severity finding. Optional consensus-context warnings were medium and
  did not establish a safe prediction or grade change.

### EPL

- The current ten-fixture round includes eight scheduled fixtures and eight
  preserved locked market records.
- The r6 zero-write rehearsal produced 32/32 selected current prices, 32/32
  openings, and 80/80 scheduled outcome rows with trails across 19 books.
- Current club-stat and recent-xG team coverage were complete.
- Current scheduled board: 5 Leans, 11 Watchlists, and 16 No Plays, with zero
  forecast/grade impact from the recovery-order correction.
- The authenticated Sharp splits endpoint continues to return no EPL data. This
  is real source unavailability; no split is inferred, and splits have no grade
  authority.

### UCL

- The next 18-fixture slate was ready with 72/72 selected prices and 180/180
  outcome rows, with zero held or incoherent evaluations.
- Current grades were 13 Leans, 32 Watchlists, and 27 No Plays.
- All 18 BTTS leaders were Yes. That is a distribution warning worth continued
  forward monitoring, but the independent distributions, qualified reader, and
  final score/market coherence checks found no safe basis for a forced side or
  threshold change.

## Player Props findings

### NFL Player Props

- Current snapshot: 2,383 decisions, 1,409 member rows, 897 unique scopes, zero
  duplicates, and zero projection/side incoherence.
- 2,381/2,383 rows had an opening; the two exceptions were locked and held
  Demario Douglas pairs, not current actionables.
- The live page exposed 13 games, six books, exact prices and movement, 9 Best
  Angles, and 13 Leans under its current member filter.
- Tracking contained 252 records. Forty historical closes remain unavailable
  and were not fabricated; two recoverable closes were handled by the released
  lifecycle.

### NBA Player Props

- Eight games, seven books, 563 current decisions, and zero zero-projection
  rows.
- Live board: 2 Best Angles and 12 Leans, with exact prices and movement.
- The current release is pure and coherent after the audit-reader repair; the
  repair changes no production prediction or grade.

### MLB Player Props

- One game, five books, approximately 379 posted options across 17 markets.
- Data confidence was 0.783 and the canonical board was publishable with no
  stale selected quote.
- The current board naturally contained no Best Angle or Lean. Its Watchlist /
  no-edge shape followed current model and price evidence; no missing-data or
  calibration defect justified manufacturing actionability.

## Verification

- All focused EPL model, coherent-market, forward-evidence, locked-member, and
  professional-score tests passed.
- The complete `npm run verify:model-change` suite passed.
- TypeScript and focused ESLint passed.
- Existing locked records remained read-only throughout every rehearsal.
