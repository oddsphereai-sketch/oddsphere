# Football cross-market coherence r19 release audit

Date: 2026-08-28

Status: release candidate; live promotion requires protected merge and natural-cycle proof

## Outcome

NFL and CFB now share a writer-owned publication assertion under
`football_cross_market_coherence_2026_08_28_r1_event_containment`. It rejects a payload before
the sole append when the expected score, reachable score, winner probability, PMF/marginals,
market disposition, selected side, exact quote, fair probability, EV, or actionable-value
relationship is internally inconsistent. It also enforces the push-aware event relationship
between winning and covering the exact spread.

Different grades are not automatically contradictions. Moneyline, Spread, and Total use their
own exact book/line/price and qualified policy. A Moneyline Lean can therefore coexist with a
Spread No Play, including an underdog spread, when the exact prices or thresholds explain it.
The shared report emits `price_or_threshold_divergence`; it never changes a grade to imitate a
sibling market.

## NFL correction and replay

The prior 2026 Week 1 wave contained two impossible separately calibrated Spread probabilities:

- MIA-LV: MIA +3.5 BetMGM -108 moved from 50.9483% to 61.7776%, the minimum permitted by the
  published MIA win probability. It remains Watchlist; the correction cannot create a promotion.
- DEN-KC: KC -2.5 No Play at 51.2024% exceeded KC's win probability. The corrected selection is
  DEN +2.5 BetMGM +100 at 54.5391%, +5.8889pp versus target-excluded fair and +9.0783% EV. It
  remains No Play because a correction-caused side flip is not authorized to create action.

The SELECT-only replay read 912 immutable evidence rows and rebuilt the latest 16 games / 48
markets captured at 2026-08-28T08:21:35.841Z. Before and after counts are identical:

- overall: 3 Best Angles / 11 Leans / 7 Watchlists / 27 No Plays;
- Moneyline: 3 / 5 / 2 / 6;
- Spread: 0 / 3 / 4 / 9;
- Total: 0 / 3 / 1 / 12;
- promotions: 0; demotions: 0; net actionable change: 0;
- probability changes: 2; side changes: 1.

This is a mathematical output-boundary correction, not new predictive-performance evidence.
The existing chronological 2024/25 qualification remains authoritative. The football-only win
head recorded 0.21209 / 0.22119 Brier and 0.61431 / 0.63212 log loss; the reachable-score
functional recorded 7.28125 / 7.37868 team-score MAE with 100% PMF support and winner fidelity.
The opening market remained better, which is an explicit limitation rather than a hidden claim.
Immutable 2026 T-60 records remain the true forward holdout.

## CFB replay

The r18 primary market-informed PMF and unchanged exact-price r10 decision head pass the same
shared gate for the current eight-game slate. Hawaii-Stanford is not a containment failure:
Stanford is the primary 26.4-22.4 / 60.5% winner, while the exact HAW +152 Moneyline and HAW +4
-110 Spread carry different price economics. Virginia-NC State is likewise coherent at primary
UVA 27.8-23.8 / 60.6%: UVA -177 can be No Play while UVA -4 -109 is Lean.

CFB grades stay 2 Best Angles / 4 Leans / 6 Watchlists / 11 evaluated No Plays / 1 unavailable
Moneyline after the SJSU-USC recovery. There are zero r19 promotions and zero demotions. SJSU +39
BetMGM -108 is No Play, Under 60.5 BetMGM -110 is Best Angle, and Moneyline remains an explicit
unavailable No Play. Missing Moneyline evidence cannot suppress coherent Spread or Total tuples.

## Operational boundary

- NFL writer: `nfl_forward_evidence_writer_2026_08_28_r11_cross_market_coherence`.
- CFB writer: `cfb_forward_evidence_writer_2026_08_28_r10_cross_market_coherence`.
- NFL model/calibration/decision/policy/member: r4/r4/r10/r10/r7 event containment.
- CFB outcome, model, decision, calibration, and grade policy are unchanged.
- One existing writer and `prediction_pipeline` lease per sport remain authoritative.
- No new timer, endpoint, provider call, database path, stake rule, reader-side override, or
  football-only presentation system was added.
- T-60, tracking, settlement, market-scoped availability, and the shared MLB reader shell remain
  unchanged.

## Verification

Focused unit and writer-boundary tests cover favorite, underdog, pick'em, integer-spread push,
valid price-driven grade divergence, invalid containment, score/winner mismatch, nonpositive-value
action, exactly one shared assertion per writer, and assertion-before-append ordering. Release
promotion additionally requires the full model-change suite, shared reader suite, TypeScript,
scoped lint, webpack build, integration safety against current main, protected PR checks, natural
writer-cycle evidence, and signed-in desktop/mobile QA.

## Rollback

Restore NFL r3/r9/r6 and writer r10, plus CFB writer r9. Do not rewrite immutable snapshots or
locked tracking records. Any mixed current release, writer failure, actionable-board change, or
member/stored-tuple mismatch blocks promotion or triggers rollback.
