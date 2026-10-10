# EPL professional Match Result tiering v25 — predeclaration

Date: 2026-10-10

Base: `3cba350a52aadfa6160fcbc31aa2f5d7c2032ab2`

## Scope and opened evidence

This candidate changes only future unlocked Premier League Match Result public
tiers. It does not change the independent Dixon–Coles PMF, Draw arbitration,
selected regulation-time result, probability, projected goals, likely or
representative score, Double Chance, Total, BTTS, evaluated quote, stake,
provider cadence, writer, shared `prediction_pipeline:soccer` lease, lock, or
settlement. Stored locked records retain exact reader precedence.

The 30-game r18 forward archive and current ten-game board were already opened
during the owner-directed professional market-reader audit. They are
retrospective diagnostic evidence, not a pristine holdout or a promised hit
rate. The candidate is fixed before implementation and uses the natural
zero-exact-EV boundary rather than an outcome-fitted numeric threshold.

## Soccer-specific market-reading standard

- Match Result is a three-way home/draw/away market. Draw probability is never
  treated as the binary complement of a club win.
- Complete same-book three-way vectors are de-vigged together. Outcomes or
  timestamps are never mixed across sportsbooks.
- The evaluated sportsbook is excluded from any forecast evidence, so its
  quote cannot validate itself.
- A same-book opening-to-current trail is directional evidence only. A
  cross-book first quote is never called movement.
- Sharp/named-book identity, quote timestamps, source-family independence,
  and target exclusion matter before evidence can influence the score PMF.
- Missing SharpAPI EPL split rows are neutral. They are not zero, support,
  resistance, or permission to use a lower-integrity source. Playbook remains
  banned because its EPL aliases returned NFL data.
- A market move or split percentage is not an automatic side flip. The
  settled Match Result tournament found one correction and zero harms in its
  selection block but no activation in the untouched block; this is
  insufficient authority for a production flip.
- Current Total market context retains its existing target-excluded coherent
  PMF role. The settled same-book movement challenger worsened or failed to
  improve the relevant Total/BTTS proper-score gates and remains audit-only.

This boundary follows the evidence that online European football prices are
strong forecasts and generally efficient, while favorite–longshot bias and
bookmaker heterogeneity make exact prices and cross-book comparison material:

- Angelini and De Angelis, “Efficiency of online football betting markets”:
  <https://www.sciencedirect.com/science/article/pii/S0169207018301134>
- “Information, prices and efficiency in an online betting market”:
  <https://www.sciencedirect.com/science/article/pii/S1544612319306440>
- Buhagiar, Cortis, and Newall, favorite–longshot bias across European soccer:
  <https://www.sciencedirect.com/science/article/pii/S2214635018300285>

## Diagnosed defect

Total and BTTS already require positive exact forecast-side expected value for
Lean. Match Result did not. It could issue Best Angle or Lean from model
confidence, market-favorite agreement, and a broad price cap even when the
stored forecast probability did not clear the actual offered break-even price.

Under an exact r19/v24 replay of the 30 settled r18 locks:

- five Match Result rows were actionable and went 4-1 for +0.736u;
- four of five had nonpositive exact EV and went 3-1 for only +0.027u;
- the one positive-exact-EV row won +0.709u;
- the only actionable loss was 58.7% Liverpool at -189, negative 10.2% exact
  EV, with the complete same-book three-way market moving 3.38pp against it;
- no settled or current row contained authentic EPL splits.

The current board has seven actionables across 40 markets. Its sole Match
Result action is Arsenal at 68.0%, -229, negative 2.25% exact EV, with a 1.26pp
same-book de-vigged move against the forecast. The prediction remains a strong
winner forecast; the quote does not qualify as the strongest bet tier.

## Fixed candidate

Apply one deterministic tier cap to future unlocked Match Result rows:

1. A row that clears the incumbent Best Angle accuracy path and has positive
   exact forecast-side EV remains Best Angle.
2. A row that clears that Best Angle path but has nonpositive exact EV becomes
   Lean. It stays actionable; its prediction and score do not change.
3. A row that clears an incumbent Lean path but has nonpositive exact EV
   becomes Watchlist.
4. Positive-EV incumbent Lean paths remain Lean, providing the tested upward
   path required by the board-safety contract.

No movement threshold, consensus weight, quota, or broad flip is added.
Movement and missing-split state remain explicit audit evidence. The candidate
changes the settled replay from five actionables at 4-1/+0.736u to two at
2-0/+1.209u. The other three forecasts remain visible as Watchlist. On the
current board, Arsenal changes Best Angle to Lean, so all seven current
actionables remain and the board does not flatten.

## Release and acceptance

- Model remains `epl_goals_coherent_2026_10_01_r19_draw_arbitration` because no
  prediction or projection behavior changes.
- Grade/calibration becomes
  `epl_grade_policy_2026_10_10_v25_exact_match_result_price_tiering`.
- Required proof: exact unit tests for positive and nonpositive Best Angle,
  ordinary Lean, and short-price Lean; current-board replay; full model-change
  gate; integration safety; protected PR; and post-merge live release check.

Rollback restores v24 for future unlocked rows only. No locked payload may be
rewritten, suppressed, or reinterpreted.
