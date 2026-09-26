# CFB market-reading marriage audit predeclaration

Date: 2026-09-26

## Scope and production boundary

This audit tests whether the current CFB Daily Edge outcome forecast can improve by interpreting
market evidence rather than merely anchoring to the market price. It is limited to the internal
CFB Moneyline, Spread, Total and joint-score forecast path. It does not authorize member copy,
labels, layout, stakes, quotas, a second writer, a new schedule, additional provider requests, or
changes to another sport or player-prop model.

The clean starting base is remote `main` at
`7c215545db0ce5dc423a6c450f6a918d9f925e09`. The current forecast release is
`cfb_market_sharp_aware_production_2026_09_26_r22_score_side_coherent`; the prior release is
`cfb_market_sharp_aware_production_2026_09_19_r21_contained_spread_counter_signal`. Existing
locked rows and their releases remain immutable.

## Question and evidence hierarchy

The market anchor remains a bounded sanity check, not a substitute for the independent model.
The audit evaluates these provenance-separated market-reading channels:

1. fresh, line-matched Circa money-versus-ticket splits;
2. time-ordered same-book Circa and Pinnacle price or line movement captured by `cfbfec3`;
3. explicit reverse-line movement, defined before outcome inspection as a verified same-book move
   opposing a sufficiently lopsided public ticket direction;
4. Playbook public money-versus-ticket divergence and same-book retail movement as lower-priority
   corroboration or resistance.

Circa, Pinnacle, and retail evidence are never averaged equally by default and are never relabeled.
DraftKings or Playbook public splits do not become sharp splits. Missing evidence is unavailable,
not inferred. Age, line identity, book identity, event identity, and chronology must remain
explicit. The existing Circa/Pinnacle capture is reused; this audit adds no provider call.

## Frozen candidate definitions

- Reverse-line movement is eligible only when the public side has at least a 10 percentage-point
  ticket advantage and a complete money/ticket pair, while a verified earlier-to-later same-book
  line or no-vig price move favors the other side. Spread and Total line movement must be at least
  0.5 points; Moneyline movement must be at least 1.5 no-vig probability points.
- A source may support or resist the independent forecast but cannot independently choose a side.
- Circa/Pinnacle price trails remain separate features. A source-specific coefficient or bounded
  adjustment may advance only if selected without using confirmation outcomes.
- The final result must remain one coherent score distribution from which expected score,
  representative score, Moneyline, Spread, and Total are all derived.
- Any live candidate must advance every affected immutable release identifier together. Until the
  gates below pass, all new logic is audit or shadow evidence only.

## Evaluation protocol and gates

Evaluation uses immutable pre-kickoff evidence and completed outcomes. It reports exact coverage
and sample size separately for Circa splits, public splits, ordinary movement, RLM, Circa price
trails, and Pinnacle price trails. Selection and confirmation dates are separated chronologically;
different production releases are reported separately and are not described as one current-model
sample.

A candidate may become live only if all applicable gates pass:

- adequate source-specific forward sample and date/week breadth;
- no leakage from post-lock quotes or outcomes;
- improved or non-inferior team-score MAE, margin MAE, total MAE, Moneyline Brier/log loss,
  Moneyline accuracy, Spread accuracy, and Total accuracy on confirmation;
- no unresolved contradiction between projected score, Moneyline side, Spread side, or Total side;
- paired actionable promotions and demotions with the before/after board counts reported; an
  unexpected flatter board fails;
- unchanged provider request budget, sole `prediction_pipeline:cfb` lease, writer cadence,
  zero-stake behavior, and member presentation;
- focused tests, `npm run verify:model-change`, clean latest-main integration safety, protected PR,
  merged-production release proof, natural writer proof, and live board/health verification.

If Circa/Pinnacle price-trail outcomes are not yet sufficiently settled, those channels remain
capture-only rather than receiving guessed production weights. That is a qualification boundary,
not permission to discard the evidence or stop the broader independent-model work.

The audit found that `cfbfec2` retained a sharp-book observation inside one payload but the writer
did not restore that compact observation as a next-cycle opening candidate. The evidence-only
continuity repair advances the capture to
`cfb_daily_edge_forward_context_capture_2026_09_26_r3_sharp_price_trail_continuity` (`cfbfec3`)
and the sole writer to `cfb_forward_evidence_writer_2026_09_26_r75_sharp_price_trail_continuity`.
It reconstructs only target-ineligible Circa, Pinnacle, or Bookmaker landmarks already present in
immutable context captures. It adds no query, provider request, current quote, consensus input,
prediction effect, grade effect, stake, member field, copy, or label.

## Pre-repair production evidence audit

The SELECT-only `cfb_sharp_price_trail_select_audit_2026_09_26_r1` read 11,977 immutable evidence
rows, including 9,204 contextual captures across 309 games, with zero writes and zero provider
calls. Circa had 1,406 Moneyline, 1,448 Spread, and 1,480 Total observations across 48–50 games,
but zero chronological opening/current pairs in every market. Pinnacle had partial pairs (98 / 178
/ 162 rows across 23 / 51 / 44 games) because it sometimes existed in ordinary market history.
This proves that capture volume was not equivalent to usable Circa movement history and qualifies
the continuity repair independently of any predictive weighting decision.
