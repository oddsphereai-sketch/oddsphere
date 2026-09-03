# NFL target-excluded forecast result

## Disposition

Eligible for production-source review on protected main `7441d165` (full SHA recorded by the candidate ancestry proof). The change is structural and outcome-blind: the current NFL release has zero settled locked Week 1 Moneyline rows, so this result makes no forward accuracy, Brier, log-loss, ROI, or profitability claim.

The source-proven defect is evaluated-book self-validation. The incumbent forecast starts from one selected current retail book at 75% market weight, and the later exact evaluated tuple can select that same operator. The candidate resolves exact targets provisionally, excludes the Moneyline and Spread target families from the margin axis and the Total target family from the Total axis, requires three fresh independent families on both axes, and iterates to a stable complete tuple. Exact price, EV, grade, and stake remain downstream. A cycle or insufficient evidence retains the incumbent coherent forecast and stamps `incumbent_fallback`; it does not pretend that target exclusion succeeded.

No downstream calibration or grade layer changes the predicted winner. A sub-50% opposite-side Moneyline value selection remains a wager decision, not a forecast flip. Missing public or Circa evidence remains neutral, and a target-family Circa record is excluded rather than relabeled.

## Frozen current-board replay

The replay used all 16 latest immutable rows from `nfl_forward_evidence_snapshot_2026_09_01_r6_forecast_value_separation` and executed the exact candidate resolver used by the sole writer.

- Evidence mode: 13 `target_excluded_market`; 3 truthful `incumbent_fallback`.
- Predicted-winner changes: 0. Independent-prior-to-final winner switches remain 2 and are not newly introduced.
- Market-side tuple changes: 4, comprising one non-actionable Total direction change and three same-direction exact line/book reselections. No Moneyline or Spread forecast direction changes.
- Grade changes: 4. Actionable promotions/demotions: 1/1. Actionables: 20 -> 20.
- Grade board: 12 Best Angle / 8 Lean / 9 Watchlist / 19 No Play -> 9 / 11 / 9 / 19.
- Maximum selected-side probability delta: 1.3932 percentage points. Maximum expected-score component delta: 0.4882 points.
- Stake changes: 0; the product remains zero stake.

Changed decision rows:

| Game | Market | Current | Candidate | Effect |
|---|---|---|---|---|
| NYJ@TEN | Moneyline | TEN 59.49%, Best Angle, BetMGM -130 | TEN 58.36%, Lean, same quote | Tier attenuation only |
| NYJ@TEN | Spread | TEN 55.57%, Best Angle, BetMGM -1.5 -108 | TEN 54.36%, Lean, same quote | Tier attenuation only |
| TB@CIN | Total | Under 50.5 50.90%, No Play, DraftKings -102 | Over 50.5 50.67%, No Play, Fanatics -110 | Non-actionable forecast direction change |
| BAL@IND | Total | Under 47.5 53.56%, Best Angle, Caesars -104 | Under 48 54.70%, Watchlist, BetRivers -110 | Actionable demotion at new exact quote |
| ATL@PIT | Total | Under 42.5 54.06%, Watchlist, DraftKings -115 | Under 42 53.66%, Lean, BetRivers -108 | Actionable promotion at new exact quote |
| ARI@LAC | Total | Over 47.5 52.52%, Watchlist, FanDuel -102 | Over 46.5 53.92%, Watchlist, DraftKings -115 | Same-direction exact line/book reselection |

NE@SEA remains coherent: SEA remains the predicted winner, SEA Spread remains Lean, Over remains No Play, and no grade or side changes. The exact target-excluded adjustment is sub-tenth-point at the score level.

## Safety and rollback

The single `prediction_pipeline:nfl` lease, sole append writer, weekly slate, QB/injury substitution, immutable T-60 precedence, official tracking boundary, member fixture, quote provenance, and reader contract remain in their existing paths. The release family is versioned so the first natural wave is distinguishable. Automatic monitoring records whether each row used a stable target-excluded tuple or retained the incumbent. Roll back to the September 1 r8/r14/r11 model family, writer r20, member fixture r15, member snapshot r6, and tracking r8/r4/r5/r4 if a natural cycle shows mixed releases, a target family inside a qualified forecast axis, board collapse, lock drift, writer/lease failure, or member incoherence.

CFB was evaluated separately and is not part of this candidate. Its bounded qualified-only replay changed no winner and capped expected-score movement at 0.4206 points, but moved actionables 61 -> 66 with five promotions and zero demotions. CFB therefore remains on authoritative r51 with no source or release change.
