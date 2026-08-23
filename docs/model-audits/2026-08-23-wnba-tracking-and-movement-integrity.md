# WNBA tracking and movement integrity — 2026-08-23

## Scope

Reader-only verification and repair. This change does not alter a WNBA
prediction, probability, projected score, selected side, exact evaluated
price, Bet grade, stake, writer, lock, grading rule, or tracking record.

## Live evidence before the repair

- The 2026-08-23 WNBA board contained four scheduled games and exactly twelve
  prediction records: four Moneyline, four Total, and four Spread.
- The signed-in reader rendered Spread as a first-class market, a two-sided
  same-book price trail, and a separate Spread Line Movement panel.
- SEA at DAL showed the selected spread improving from SEA +7.5 to SEA +8.5.
  The number tracker correctly showed the move, but Market Pulse called it
  resistance. The selected-side signed-line comparison was reversed.
- Current WNBA storage contained four game predictions, 301 current line rows
  across 20 books, line history, and 24 public-split rows covering all three
  markets. The last natural overnight refresh completed successfully; the
  next scheduled daytime cycle begins at 09:23 ET.

## Repair

For Total and Spread, the Market Pulse direction now prefers the dedicated
same-book point-line trail when the number moved. A selected spread moving from
+7.5 to +8.5 is support; a selected spread moving from -7.5 to -8.5 is
resistance. The two-sided price rows and evaluated-price tuple remain unchanged.

## Tracking verification

- The live Tracking page already groups Yesterday, Weekly, Monthly, Lifetime,
  and Best Angle sections into sport-tinted, explicitly labeled model groups.
- Premier League is separated from World Cup history.
- The 2026-08-22 EPL slate showed five settled predictions in each of Match
  Result, Total, Double Chance, and BTTS. Weekly and Lifetime both included all
  four EPL categories; the prior-day result was also retained.
- WNBA Weekly and Lifetime include Moneyline, Total, and Spread separately.

## Board impact

Promotions: 0. Demotions: 0. Actionable-count change: 0. The repair changes
only the contextual direction label and explanation for a verified point-line
move.

## Validation

- Real 2026-08-23 candidate DTO, read-only: SEA +8.5 retained Watchlist and
  evaluated -110; FanDuel line trail opened +7.5/-115 and ended +8.5/-118;
  Market Pulse resolved `support` / Strong Market Support. No DB writes.
- WNBA decision-tuple and price-trail regression: pass.
- Daily Edge experience suite: 109/109.
- Tracking page suite: 129/129.
- Focused ESLint: pass.
- TypeScript no-emit: pass.
