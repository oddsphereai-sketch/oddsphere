# MLB Daily Edge tier-ladder audit predeclaration

Date: 2026-08-26

Status: frozen before querying any post-r69 settled outcomes or current-board
counterfactuals. Read-only audit first; no writer, cron, provider, database, or
member mutation is authorized by this document.

## Scope and current authority

- Sport/market: MLB Daily Edge, Moneyline primary; Total and First Inning are
  classification controls only.
- Production authority: automodel `v2_2`, Moneyline probability head
  `mlb_moneyline_away_market_40_45_raw_side_champion_v1_2026_08_15`, public
  calibration v27, decision r69, rule bundle v57, grade policy v47, correction
  v21, and the existing `predictionRecordService` writer under
  `prediction_pipeline:mlb`.
- Locked rows are immutable. The candidate may affect only future unlocked
  evaluations and future locks. It may not change the forecast side,
  probability, projected score, evaluated quote, stake, writer, lease, or
  provider budget.
- Prior r68 evidence is known before this freeze: relaxing only the -10 signed
  split cliff or the 60% strong-winner floor did not clear confirmation sample
  and stability gates. That result is retained as prior evidence but does not
  answer the broader tier-ladder question.

## Exact evaluation unit and chronology

Use one final immutable locked Moneyline tuple per MLB game and release era,
deduplicated by game, market, locked timestamp, selected side, evaluated book,
and evaluated price. Never blend unlocked refreshes, later quotes, releases, or
opposite sides. Inputs must come from the locked snapshot: final side,
probability head/release, exact evaluated price, same-book movement,
timestamp-valid SharpAPI splits, public conflict, projection agreement,
market-scoped completeness, grade history, closing-line evidence, and settled
result.

Frozen windows:

- development: 2026-08-10 through 2026-08-14;
- selection/validation: 2026-08-15 through 2026-08-19;
- confirmation: 2026-08-20 through 2026-08-24;
- current board impact only: 2026-08-25 through 2026-08-26. Outcomes from this
  window cannot qualify a rule.

Report release and probability-head coverage separately. Report W-L, exact
locked-price units/ROI, win calibration gap, available CLV, largest-win-removed
units, date/game-cluster bootstrap uncertainty, and reversion/refresh stability.

## Classification invariant

Every incumbent No Play is assigned exactly one class before applying a
candidate:

- **A operational/incomplete:** missing market-owned identity, starter, model,
  price, two-sided quote, freshness, or integrity evidence. It remains an
  internal high-severity operational exception and member-facing reasoned No
  Play with no evaluated bet tuple. It is ineligible for Watchlist or Lean.
- **B complete hard failure:** side correction/inversion, projection conflict,
  independent public conflict, price outside the declared playable range,
  materially negative exact-price value, or material adverse same-book
  movement. It remains evaluated No Play.
- **C complete coherent near-edge:** unchanged side, complete tuple, projection
  agreement, no public conflict, and only bounded price/resistance/movement
  friction. It may become a nonactionable Watchlist under a frozen rule.
- **D evidence-supported action:** a C row that also clears a frozen Lean rule
  and every confirmation gate. It may become Lean, never Best Angle.

The hierarchy is evaluated A -> B -> D -> C -> incumbent action. Best Angle may
downgrade to Lean or Watchlist only when the corresponding lower tier still
qualifies; otherwise it remains No Play. There is no count target, quota, or
forced replacement.

## Frozen candidate matrix

Common eligibility for C/D: complete market-scoped Moneyline tuple; final side
unchanged; model probability at least 50%; exact price -300 through +200;
projection gap nonnegative; no independent public conflict; no correction,
inversion, raw-side stand-down, or provisional/data hold. Signed money below
tickets remains visible context and cannot create an opposite-side pick.

All American-price EV is calculated from the stored selected-side probability
and exact evaluated price.

### Nonactionable Watchlist candidates

1. `coherent_near_edge_watch`: EV at least -3%; signed resistance allowed;
   same-book movement not adverse by more than 1.0 implied-probability point.
2. `prior_action_hysteresis_watch`: the latest grade-history tuple was the same
   side and Best Angle/Lean; EV at least -4%; signed gap greater than -30pp;
   adverse same-book movement no more than 1.5pp.

Watchlist is observation, not a bet. Qualification requires zero A/B failures
and stable classification under a +/-0.25pp movement perturbation; historical
returns are descriptive and cannot convert it to Lean.

### Actionable Lean candidates

1. `strong_value_resistance_lean`: probability >=58%, EV >=0, price -250..+200,
   signed gap >-20pp, and adverse movement <=0.5pp.
2. `prior_action_hysteresis_lean`: same-side prior Best Angle/Lean,
   probability >=55%, EV >=0, price -250..+200, signed gap >-20pp, and adverse
   movement <=1.0pp.
3. `clean_near_market_lean`: probability >=54%, EV >=0, price -200..+200,
   movement neutral/supportive, and no signed resistance at or below -10pp.

These candidates are uncapped and evaluated independently and as a deterministic
union in the order shown. They cannot create Best Angle or change a side.

## Frozen actionable gates

A Lean candidate/union is rejected unless all apply:

1. at least 8 settled actions in validation, 8 in confirmation, and 20 pooled;
2. positive units and ROI in validation and confirmation;
3. positive units in each window after removing its largest win;
4. development ROI no worse than -5%;
5. pooled validation+confirmation date-cluster bootstrap probability of
   positive units at least 80%, with the 95% interval reported;
6. absolute calibration gap <=10pp in each confirmation window;
7. if at least 15 rows have comparable CLV, mean CLV must be positive and at
   least 50% must beat close; otherwise CLV is explicitly insufficient and the
   rule cannot be described as CLV-qualified;
8. no worse than 20% same-day action->No Play->action reversion under stored
   chronological refreshes and no dependence on one game/day cluster;
9. paired current-board promotions/demotions and market mix are reported, with
   no A/B row promoted.

If every Lean fails, no actionable threshold is changed. A C Watchlist lane may
still ship only if it is strictly nonactionable, exact-tuple complete, reasoned,
stable, and cannot hide operational exceptions or hard failures.

## Secondary controls

Total and First Inning are not rethresholded in this audit. Their current No
Plays must be classified A/B/C using their own market-owned evidence so a
Moneyline fix cannot contaminate them. Any discovered serialization,
market-scope, or reader defect may be fixed without changing a model rule,
provided current grades and locked rows remain unchanged and the defect has a
focused regression.

## Promotion requirements

Any live grade behavior requires new immutable calibration/decision/rule/grade/
correction identifiers in the registry and runtime, paired board impact, focused
MLB suites, `npm run verify:model-change`, TypeScript, lint/diff checks,
production build, clean integration safety, protected PR, deployment, and live
release/cron/coverage/reader verification. Otherwise results remain audit-only.
