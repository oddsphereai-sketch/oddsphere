# MLB full-board market-evidence repair — 2026-08-27

## Scope

Reader/presentation only. The MLB v2.2 projection, v27 calibration, r70
decision, v58 rules, v48 grade policy, v22 corrections, authoritative writer,
lease, prices used for grading, probabilities, sides, grades, stakes, locks,
tracking, and settlement are unchanged.

## Production diagnosis

The August 27 member reader showed current-only or empty movement for markets
whose raw storage already contained both outcomes and repeated timestamped
prices. COL-WSH and BAL-STL were visible examples. Read-only database evidence
showed 200 MLB `line_history` rows for COL-WSH and 158 for BAL-STL across
Moneyline, Total, and first inning. The defect had two reader causes:

1. Movement was forced onto the current best-price sportsbook even when that
   book had only one observation, while another current two-sided sportsbook
   had a complete same-book trail.
2. The operational-No-Play presentation boundary deleted authentic price and
   movement evidence whenever a starter or other required Bet-grade input was
   incomplete.

Neither condition was provider absence.

## Release contract

- Keep the current best quote and the immutable grade price unchanged.
- Select one deterministic current two-sided movement-reference sportsbook at
  the exact market/line, ranked by the minimum history depth across both sides.
- Build selected and opposing Opening/Prior/Current trails only from that one
  sportsbook. Never mix books or fabricate an opener.
- Label the movement-reference book separately whenever it differs from the
  current best-price book.
- Preserve authentic current prices, lines, odds trails, point-line trails,
  and market reads through an operational No Play. Suppress only the incomplete
  evaluated-bet tuple.
- Continue using the named-book two-sided YRFI/NRFI 0.5 board for first inning.
- Locked rows remain immutable and continue to use the sportsbook captured at
  lock; the unlocked reference selection never applies to them.

## Frozen production-backed replay

Date: 2026-08-27. Slate: 7 MLB games / 21 markets / 42 market outcomes plus 14
first-inning outcome prices.

The strict read-only matrix verified:

- all 7 Moneylines: selected and opposing Opening/Prior/Current same-book
  evidence;
- all 7 Totals: Over and Under Opening/Prior/Current same-book evidence plus
  the point-line timeline;
- all 7 first innings: named-book 0.5 YRFI and NRFI current/open/prior prices;
- 40 ML/Total trails, 11 point-line trails, 328 verified `line_history` stops,
  12 verified current-line stops, and 42 verified first-inning board prices;
- zero missing sides, mixed books, timestamp-order failures, or unverifiable
  stops.

Examples:

- COL-WSH Total keeps the current best Over 9.5 +100 at Hard Rock while showing
  a complete two-sided Bally Bet reference trail (Over -107 to -106; Under
  -114 to -115). The books are explicitly separated.
- BAL-STL Moneyline retains the current BAL -117 at BetRivers and restores a
  two-sided Bally Bet trail (BAL -121 to -118; STL +100 to -104).
- BAL-STL Total restores Bally Bet Under -121 to -120 and Over -103 to -103 at
  8.5 even while the missing-starter Bet grade remains an operational No Play.

Board predictions and grades have zero promotions, zero demotions, and zero
actionable changes.
