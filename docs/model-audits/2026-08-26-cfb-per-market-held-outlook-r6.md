# CFB per-market Held/outlook correction (r6)

Date: 2026-08-26

Status: superseded before publication by the r7 strict named-book price-fallback correction; no provider, cron, writer, or database mutation was used for the audit or replay.

## Production defect and frozen scope

A SELECT-only audit of the current production CFB evidence found 32 checksum-valid immutable rows across four complete eight-game waves. Twenty-one of 24 markets had complete named-book, target-excluded exact-price decisions. The only Held markets were all three SJSU at USC categories:

- BALLDONTLIE comparable named books: 0 for Moneyline, Spread, and Total;
- operational opening: unavailable;
- Playbook line and all three public-consensus split sets: available;
- projected quarterbacks: Luke Weaver and Jayden Maiava;
- independent score forecast: SJSU 16.1, USC 39.4; USC winner probability 92.1%;
- injuries and venue weather: provider-unavailable and explicitly labeled;
- SharpAPI NCAAF splits: unavailable and never substituted with Playbook.

At this audit stage the stored BALLDONTLIE rows appeared to support genuine exact-price holds, but that conclusion was later disproved by bounded current-market verification: SharpAPI's strict SJSU-USC event bucket carried coherent two-sided Spread and Total prices. The reader defect described here remained real, but this r6 candidate was not published because it did not repair the upstream price-coverage gap. See `2026-08-26-cfb-sharpapi-price-fallback-r7.md`.

The live reader also labeled an in-cadence early-week Playbook split wave stale. The DTO omitted the sport-specific freshness window, so the shared reader applied its generic 75-minute default. The correction stamps 390 minutes in the early six-hour window and 90 minutes inside the hourly 48-hour window; it does not change the split values or use them to regrade a decision.

The correction was frozen to three behaviors before replay:

1. Quote and consensus completeness is evaluated per market. Missing Total prices cannot suppress a coherent Moneyline or Spread; missing Spread prices cannot suppress a coherent Moneyline or Total when the already-frozen Moneyline calibration has a timestamped Playbook/consensus spread context.
2. A Held market may display the independent PMF outlook but may not acquire a sportsbook pick, offered price, fair market probability, EV, actionability, grade, or tracking eligibility. Moneyline uses the football-only winner probability. Spread and Total use the same PMF at the timestamped Playbook context line and label that line as context, not an offered sportsbook bet.
3. Playbook freshness follows the declared CFB collection cadence rather than the generic reader default.

No coefficient, calibration, grade threshold, stake, quota, selected side, evaluated quote, T-60 boundary, or tracking rule changes.

## Current-board paired replay

The latest checksum-valid production wave was replayed through the r6 candidate with the exact stored named-book quotes, Playbook context, and qualified PMF artifacts. Paired result:

- changed selected sides, grades, prices, or lines: 0 of 24;
- promotions: 0;
- demotions: 0;
- board: 1 Best Angle / 2 Lean / 11 Watchlist / 7 No Play / 3 Held;
- Held identity: SJSU at USC Moneyline, Spread, and Total only.

The r6 member representation retains USC 92.1% for Held Moneyline and computes the Spread/Total selected-outcome probabilities from the identical PMF at Playbook's timestamped line. Market fair probability, price, EV, and Bet actionability remain null. Sibling-market regressions prove that removing all Total quotes retains Moneyline and Spread decisions, and removing all Spread quotes retains Moneyline and Total decisions when the Playbook spread context exists.

## Release boundaries

- decision: `cfb_v1_daily_edge_decision_2026_08_26_r6_per_market`
- evidence schema: unchanged, `cfb_forward_evidence_snapshot_2026_08_25_r1`
- collector: `cfb_forward_evidence_collector_2026_08_26_r4_per_market_outlook`
- member: `cfb_v1_member_release_2026_08_26_r3_per_market_outlook`
- writer: `cfb_forward_evidence_writer_2026_08_26_r4_per_market_outlook`
- member fixture: `cfb_v1_member_fixture_2026_08_26_r4_per_market_outlook`

The score model, joint distribution, probability head, representative-score release, grade policy, and append-only database schema remain unchanged. The existing single `prediction_pipeline:cfb` lease/writer remains authoritative. The member adapter serves the last complete r2/r5 member wave until a natural release-refresh atomically appends all eight r3/r6 rows, preventing a blank or mixed-release board during deployment. No manual collection or seed is permitted.

## Rollback

Rollback restores decision r5, evidence r1, collector r3, member r2, writer r3, and fixture r3. Existing immutable evidence and official tracking records are never rewritten or deleted. Because the current paired board has zero grade/side/price changes, rollback affects only per-market completeness isolation and Held forecast visibility.
