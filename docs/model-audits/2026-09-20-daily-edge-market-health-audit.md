# Daily Edge market health audit — 2026-09-20

## Tracking integrity

The repaired September 19 CFB slate is complete and settled with zero duplicate `(game, market)`
tuples: 97 Moneylines (81–16), 97 Spreads (54–41–2), and 97 Totals (48–49). The two Spread pushes are
why the win/loss arithmetic differs while the denominators remain equal. The append-only recovery did
not overwrite any prior row.

The release-pure September 19 winner scorecard contains 120 complete winner vectors and omits zero
rows for incomplete model probabilities. CFB winner direction was 81/97, MLB 12/15, WNBA 3/3, and
EPL 2/5. These one-day samples are monitoring evidence, not authorization for a threshold or side
change.

## Current boards and freshness

- NFL: 16 games / 48 game markets in the published Week 2 snapshot. Spread probabilities are low
  conviction and Total direction is heavily Under. The exact board is 2 Best Angles, 3 Leans, 9
  Watchlists, and 34 No Plays: Total contributes four actions and Spread one. All 48 markets have a
  same-book opening plus at least one later observation; there are zero single-price or missing-trail
  rows. Public market evidence is available for all 16 games, verified sharp evidence for two, and
  nonzero released adjustments reach four margin projections and 12 Total projections. The newly
  audited chronological challenger failed production gates, while the existing historically
  qualified grade lanes remain intact; no quota promotion, side inversion, or live threshold change
  is justified.
- CFB: the current weekly snapshot is readable and contains 106 games / 318 markets; the default
  `fbs_involved` board has 70 games / 210 markets. All 70 Moneyline forecasts are available. Spread and
  Total each have 42 available forecasts and 28 truthful market-data-unavailable states where a fresh,
  coherent two-sided reference is absent. Public-consensus fallback is present on 126 default-board
  markets; verified sharp-book splits are currently pending rather than fabricated. The board remains
  visible from its last-known-good snapshot.
- MLB: 15 games are published. A bounded live recovery refreshed 1,160 records through the existing
  `prediction_pipeline:mlb` lease and republished the coherent member snapshot. Three games remain
  internal No Play holds: Toronto–Texas has no current game-market rows, San Francisco–Los Angeles is
  missing the home probable pitcher and FI market, and Chicago–Cincinnati has stale/incomplete trusted
  price evidence. Model outlooks remain visible where valid; none of these gaps is converted into an
  actionable price. Public consensus is present for the slate while sparse verified sharp-book context
  remains a truthful optional-source gap.
- WNBA: four games / 12 current reader markets are coherent, with complete displayed prices,
  probabilities, movement, and consensus evidence in the direct member response.
- EPL and UCL: stored weekly member snapshots are readable. Their production member feature flags are
  currently disabled, so the generic World Cup/soccer route is not evidence of a broken EPL/UCL board.
- NBA, CBB, and NHL: no current Daily Edge slate is expected for this date.

## Capacity and operational health

CFB, NFL game-board, EPL, UCL, tracking, and scheduled health runs completed under their existing
sport-scoped leases. The material exception was NFL Player Props: two natural NFL writer cycles failed
closed after the retained-week canonical snapshot crossed its 16 MB decoded storage ceiling. The
last-known-good board remained readable with 3,254 evaluated rows across all eight supported markets,
but refreshes stopped advancing. The paired capacity repair is predeclared separately and does not
change forecasts, grades, board membership, calls, or the member transport ceiling.

The site-stability auditor's previous MLB FI high finding was a false positive: it treated the
writer-owned stale-price neutralization as inconsistent because the immutable prior forecast audit was
preserved. The coherence checker now recognizes only that exact explicit cleanup transition; malformed
or unexplained grade changes still fail.

## Team identity presentation

The shared card fallback incorrectly treated every abbreviation as MLB when a sport-owned color was
absent. That made the NFL Eagles inherit Phillies red and allowed the same class of cross-sport collision
elsewhere. The presentation lookup is now sport-scoped for all 32 NFL teams; `PHI` resolves to Eagles
green in NFL and remains Phillies red in MLB. Current CFB snapshot identity gaps use exact ESPN-reconciled
team fallbacks rather than MLB colors or a generic purple. This changes presentation only: predictions,
projected scores, prices, grades, stakes, locks, tracking, and writer behavior are unchanged.
