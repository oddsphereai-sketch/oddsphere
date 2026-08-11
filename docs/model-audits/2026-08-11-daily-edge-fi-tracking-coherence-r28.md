# MLB Daily Edge FI tracking coherence — r28

Date: 2026-08-11  
Previous decision release: `mlb_daily_edge_decision_2026_08_11_r27`  
Candidate decision release: `mlb_daily_edge_decision_2026_08_11_r28`  
Candidate rule bundle: `mlb_daily_edge_rule_bundle_v27_2026_08_11`

The r27 production refresh completed successfully under the shared MLB `prediction_pipeline`
lease with 2,319 records updated and 93 provider calls. All 15 games had complete model
probability coverage, the three improper FI holds were eliminated, and the health monitor had
zero findings. Jake Irvin and Carson Whisenhunt produced directional provisional FI Leans;
TEX at LAA correctly produced a non-actionable Toss-Up because both named probables were present
but one side lacked verified starter history.

One downstream gap remained: `buildFiRecord` required `fresh_data_ready=true` before checking the
explicit sparse-named-starter Toss-Up reason, so TEX at LAA appeared correctly in the live reader
but was omitted from `prediction_records`. r28 permits only that exact audited Toss-Up through the
record writer. The row remains side-null, price-null, edge-null, no-bet, and ineligible for units.
Every other fresh-data blocker continues to fail closed.

Board impact is one tracking-only addition: 44 stored rows become 45, Held remains zero, and
actionable promotions/demotions are 0/0. The model picks, probabilities, ML/total grades, FI
directional grades, prices, and stakes are unchanged from r27.

The same audit found that data-health coverage treated any priced non-`no_bet` pick—including
Watchlist/`market_aligned` rows—as actionable. r28 makes the monitor count only member-facing Lean
and Best Angle grades. This diagnostic correction changes no member output or model behavior.
