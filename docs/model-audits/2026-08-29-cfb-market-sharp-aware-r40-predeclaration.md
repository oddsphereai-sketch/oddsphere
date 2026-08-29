# CFB market- and sharp-aware projection/grade r40 predeclaration

Date: 2026-08-29

Status: frozen shadow candidate before current-board scoring; no production behavior change

## Owner requirement and scope

The active CFB release publishes a football-only joint PMF and uses current named-book
prices plus target-excluded fair consensus in the exact-price Bet grade. Verified Circa
splits, Playbook public splits, and same-book movement are reader context only. The owner
has explicitly required the public CFB prediction and Bet grade to consider the market and
verified sharp evidence, consistent with the market-aware Daily Edge product standard.

This candidate affects CFB Moneyline, Spread, and Total projections, probabilities,
directions, and grades. It does not add a writer, provider request, stake, lock path, or
tracking path. The existing `cfb-forward-evidence` writer under
`prediction_pipeline:cfb` remains the sole possible production owner.

Starting production base: `98388e94212e9c5b3b7b8a1eccf351152be3d9b9`.

Active releases at the frozen boundary:

- public outcome: `cfb_independent_public_outcome_contract_2026_08_28_r29`;
- model / distribution / probability: `cfb_v1_independent_score_model_2026_08_28_r2_directional_pmf` / `cfb_v1_empirical_joint_score_distribution_2026_08_28_r2_directional_pmf` / `cfb_v1_joint_market_probability_2026_08_28_r2_directional_pmf`;
- grade / decision: `cfb_v1_composite_grade_policy_2026_08_25_r1` / `cfb_v1_daily_edge_decision_2026_08_28_r15_ambiguous_event_scope`;
- writer: `cfb_forward_evidence_writer_2026_08_28_r25_owner_cadence`.

MLB comparison was verified against the active runtime constants: automodel `v2_2`,
decision `mlb_daily_edge_decision_2026_08_28_r72_persisted_split_clear`, calibration
`mlb_public_calibration_v27_strong_winner_resistance_lean_2026_08_22`, and rule bundle
`mlb_daily_edge_rule_bundle_v60_persisted_split_clear_2026_08_28`. MLB uses a market prior
in calibrated probability heads and validated signed SharpAPI/movement gates in actionability;
it does not treat raw split percentages as literal win probabilities.

## Frozen shadow candidate

Candidate release:
`cfb_market_sharp_aware_shadow_2026_08_29_r3_borderline_spread`.

### Same-day board-balance amendment

The original r1 policy was frozen before its first current-board replay. That replay exposed
an owner-rejected 11-of-22 No Play shape. The r2 thresholds below are therefore an explicitly
same-day diagnostic adjustment informed by the 2026-08-29 board; they are not prospective or
held-out evidence and cannot be represented as accuracy validation.

- A probability-grade No Play becomes a non-actionable Watchlist when exact-price edge is at
  least `0pp`, EV is at least `-3%`, and neither strict sharp nor same-book movement resists it.
- A probability-grade No Play becomes a non-actionable disagreement Watchlist when verified
  strict-sharp or same-book movement supports it, edge is at least `-3pp`, EV is at least
  `-10%`, and no qualified evidence source resists it.
- These paths cannot create a Lean, Best Angle, stake, or lock. Materially negative,
  unsupported, resisted, unavailable, or health-held prices remain No Play.
- Moneyline and Spread grades remain exact-price value judgments, not duplicate confidence
  labels. A same-team Spread Lean and Moneyline Watchlist receives an explicit coherence reason:
  the spread can offer value even when the moneyline price does not. Opposite-team Moneyline
  and Spread positions can likewise encode favorite-wins/underdog-covers rather than a logical
  contradiction. Neither case forces the two grades to match.

The subsequent r3 owner-directed boundary amendment addresses UNC-TCU specifically and is also
same-day tuning, not held-out evidence. The active grade artifact requires a Spread Lean to have
at least `5.00pp` edge and an absolute line no larger than seven. A `0.01pp` tolerance alone would
not change TCU -8.5 because the line gate would still block it. R3 therefore adds one bounded
candidate Lean path: absolute spread through ten, edge at least `4.99pp`, positive exact-price
EV, American price from `-125` through `+125`, and no strict-sharp or same-book resistance.
The path does not create Best Angles and does not apply to Moneyline or Total.

### Coherent projection

1. Preserve the active independent football PMF as a separately measurable baseline.
2. Reuse the previously qualified generic market-residual PMF and its canonical current
   named-book Spread/Total anchor.
3. When an exact, fresh Circa row matches league, teams, date, and market, derive signed
   source-specific evidence as selected-side money percentage minus ticket percentage.
   Playbook and DraftKings remain public/recreational evidence and cannot be relabeled.
4. A signed gap inside `(-10pp, +10pp)` is neutral. Outside that band, adjust the market
   anchor continuously, capped at one point of home margin and one point of game total;
   a 20pp absolute gap reaches the cap. Moneyline and Spread home-side gaps are averaged
   for margin, while the Over-side gap controls total. Missing strict Circa evidence means
   a zero sharp adjustment with explicit unavailable provenance, never fabricated evidence.
5. Build a sharp-adjusted market PMF from the adjusted anchor, then publish a convex joint
   distribution containing 75% independent PMF mass and 25% market/sharp PMF mass. Every
   expected score, winner probability, representative score, interval, and same-line market
   probability must be recomputed from that one mixture. The 25% market weight is frozen as
   a conservative first shadow rung rather than tuned on the current slate.
6. The current canonical market endpoint already incorporates accumulated line movement.
   Movement path is not double-counted as an additional point shift.

### Exact-price grade overlay

1. Re-evaluate the exact named-book tuple from the candidate PMF while retaining the existing
   target-excluded same-line consensus, offered price, calibration family, EV arithmetic,
   price/line eligibility, and market-scoped availability gates.
2. Compare only the evaluated sportsbook's exact selected-side operational opening and current
   quote. A different-book path is `unknown`, not support or resistance.
3. Strict Circa selected-side money-minus-ticket gap of at least `+10pp` is support; at most
   `-10pp` is resistance. Exact-line identity is required for Spread and Total.
4. Sharp or same-book resistance demotes `Best Angle -> Lean` and `Lean -> Watchlist`.
   Joint sharp-and-movement resistance may demote `Best Angle -> Watchlist`.
5. Strict sharp support with no movement resistance may promote a positive-EV Watchlist to
   Lean only inside one percentage point of the existing Lean edge threshold. This is the
   paired promotion pool for the resistance demotions. It cannot bypass the Moneyline price
   band, Spread seven-point band, Total price/EV arithmetic, data-health gates, or exact quote.
6. No Play cannot become actionable from splits alone. No candidate rule creates a new Best
   Angle or stake. Missing sharp evidence is unconfirmed, not automatic resistance.

## Advancement gates

- Current-board replay must report old/new prediction sides, probability and score changes,
  strict-sharp coverage, same-book movement coverage, every promotion, every demotion, and net
  actionable-board impact.
- PMF mass, score/winner identity, same-line direction, exact-price identity, and market-scoped
  lock invariants must pass for every game.
- Every demotion must have a tested eligible promotion path and the report must show both counts.
- Focused CFB tests, TypeScript, `npm run verify:model-change`, and integration safety must pass
  from a clean committed worktree.
- The market component may advance only if the already-qualified r18 historical result and the
  new coherent mixture tests remain valid.
- The sharp probability/grade component has no CFB historical source-specific split holdout at
  this boundary. Unless a chronological CFB reconstruction or sufficient immutable forward
  evidence passes calibration, locked-price result, CLV, and board-balance gates, it remains
  shadow-only under `docs/model-change-safety.md`. Current-slate outcomes may not be used to tune
  the frozen thresholds.

## Rollback and invariants

The active r29/r15 releases remain the rollback and production authority. Existing unlocked and
T-60 evidence, official tracking rows, settled results, and release-era metrics are immutable.
The shadow candidate must make zero provider calls and zero writes during evaluation.
