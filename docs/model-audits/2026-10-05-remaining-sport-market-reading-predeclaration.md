# WNBA, EPL, and UCL sport-specific market reading — predeclaration

## Owner direction and product boundary

Daniel Mengel directed Oddsphere on 2026-10-05 to finish the remaining
sport-specific market-reading gaps in WNBA, Premier League, and UEFA Champions
League, then verify each Daily Edge and player-prop model independently. The
requested product behavior is a strong independent forecast married to
sport-specific, source-aware market reading that can confirm, adjust, or flip a
forecast only when the evidence supports it. The evaluated sportsbook quote
must remain downstream exact-price economics. This work may not introduce a
generic cross-sport reader, blindly follow consensus, collapse projections
toward the market, flatten a board, add member copy or labels, change layout,
add stakes, rewrite locks, or create another writer or schedule.

## Starting production authorities

The clean task worktree starts from remote `main` commit
`190dc70cd6494514d164a51785fe5bc77a4cf8d4`.

### WNBA

- Model: `wnba_v1_5_coherent_expected_margin`
- Distribution: `wnba_coherent_normal_2026_09_29_v7`
- Calibration: `wnba_core_calibration_v4_single_market_entry`
- Grade policy: `wnba_grade_policy_v10_coherent_expected_margin_2026_09_29`
- Sole writer: `lib/services/wnba/runWnbaModel.ts`
- Member reader: `lib/services/wnba/buildWnbaDailyEdgeAdapted.ts`
- Lease: `prediction_pipeline:wnba`

The isolated defect under review is the qualified Spread path's 25% independent
/ 75% market-implied expected-margin center. The Total head and all target-book
exclusion, price, lock, writer, and grade behavior are outside the candidate
unless a replay proves a directly dependent correction is necessary.

### Premier League

- Model: `epl_goals_coherent_2026_10_01_r19_draw_arbitration`
- Outcome contract:
  `epl_coherent_market_outcome_2026_09_02_r2_structural_target_exclusion`
- Grade policy: `epl_grade_policy_2026_10_01_v24_accuracy_first`
- Sole writer: `app/api/cron/epl-daily-refresh/route.ts`
- Targeted lock: `epl-pregame-lock`
- Lease: `prediction_pipeline:soccer`

The independent Dixon-Coles PMF and qualified target-excluded Total arbitration
are already active. Same-book movement is recorded but not used by the
forecast. The candidate may use movement only when it is a continuous,
predecision trail for one book, excludes the evaluated target, and improves a
chronological release-pure replay without changing the Match Result marginal by
accident.

### UEFA Champions League

- Model: `ucl_goals_coherent_2026_09_03_r6_authenticated_match_stats_manifest`
- Outcome contract:
  `ucl_coherent_market_outcome_2026_09_03_r2_independent_regulation_pmf`
- Grade policy:
  `ucl_grade_policy_2026_09_03_r6_owner_approved_epl_v23_transfer`
- Sole writers: `ucl-daily-refresh` and targeted `ucl-pregame-lock` through the
  existing shared soccer writer
- Lease: `prediction_pipeline:soccer`

All UCL market vectors are currently economics/evidence only. A candidate must
be UCL-owned and competition-specific. EPL behavior may be reused only after
UCL evidence independently validates it; no mutable EPL runtime is imported.

## Fixed evaluation plan

Each sport is evaluated separately. Candidate selection is fixed before
opening outcomes:

1. preserve the independent sport model as the default forecast;
2. exclude every evaluated sportsbook from its own forecast evidence;
3. require complete, fresh, predecision, source-identifiable evidence;
4. compare the incumbent with pure independent fallback and narrowly defined
   corroborated arbitration, never a broad market-weight sweep;
5. report score/projection error, directional accuracy, proper scores where the
   stored probability is reproducible, coherence, and chronological segments;
6. report same-input grade counts, promotions, demotions, side changes, and
   market mix; and
7. reject a candidate that worsens the relevant accuracy measures, fabricates
   evidence, loses coverage, creates contradictions, or unexpectedly flattens
   the board.

WNBA uses its release-stamped forward captures and official settled scores.
EPL uses exact release captures and the existing chronological tournament,
keeping its final evaluation block closed to candidate selection. UCL uses its
frozen manifest split plus only authentic predecision price evidence available
for the same games; missing historical movement cannot be reconstructed from a
later or different book.

## Publication gates

Any accepted behavior receives new immutable sport-owned release identifiers
and updates `docs/current-model-releases.md` in the same commit. Focused tests,
same-input board impact, `npm run verify:model-change`, current-main ancestry,
integration safety, protected PR checks, and production release/coverage/
coherence verification are mandatory. Old and locked rows remain immutable.
If no candidate clears a sport's evidence gate, that sport remains unchanged
and the result records the specific data or accuracy failure rather than
silently shipping an unvalidated market rule.
