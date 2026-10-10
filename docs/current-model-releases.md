# Current production model releases and qualified research candidates

This file is the human-readable production handoff registry. Runtime constants and stamped
prediction snapshots remain the machine authority. Future model work must start here, verify the
constants, and preserve the precedence and writer ownership below.

Last reviewed: 2026-10-09

## Cross-sport confidence / execution contract

- October 9 MLB tracking settlement continuity is
  `tracking_settlement_v5_mlb_provider_catchup_2026_10_09`. The hourly tracking
  orchestrator again runs the bounded historical-pending repair that had become
  disconnected from the active refresh path. Pending discovery is sport-scoped
  before its 1,000-row bound. For at most three older MLB slate dates per run,
  it performs one authoritative MLB Stats schedule/linescore read before the
  existing deterministic grader, allowing missed final scores and official
  postponed/canceled states to settle after they age out of the normal
  yesterday/today/tomorrow window. The production cleanup resolved 28 stale
  rows across ten dates: 25 records tied to nine postponed games became void,
  and three MIL–STL July 7 records settled from the official final and first
  inning. Locked predictions, sides, lines, prices, probabilities, play grades,
  stakes, releases, and member presentation remain unchanged. Evidence and
  rollback: `docs/model-audits/2026-10-09-mlb-pending-tracking-settlement-continuity.md`.

- October 8 CFB settlement continuity: postgame score ingest release is
  `cfb_score_ingest_2026_10_08_r3_official_score_fallback`. BALLDONTLIE remains
  primary. When an exact tracked game is omitted or remains non-final, the same
  tracking cycle performs one bounded ESPN slate read no earlier than five hours
  after scheduled kickoff and accepts a final only after strict canonical
  away/home identity, kickoff-within-90-minutes, unique event, completed status,
  and valid integer-score checks. The October 7
  NMSU–FIU omission is thereby settled as FIU 22–3. Existing locked predictions,
  model releases, sides, prices, lines, grades, stakes, copy, labels, and layout
  are unchanged. Evidence and rollback:
  `docs/model-audits/2026-10-08-cfb-official-score-fallback.md`.

- Shared contract `daily_edge_confidence_execution_contract_2026_09_04_r2_recommendation_resolution` keeps a
  sport-owned continuous confidence score independent of exact-price execution, supplies optional
  price-blind hysteresis for unlocked display tiers, and classifies a real named-book quote as
  `bet`, `shop`, or `unavailable`. It changes no live behavior unless an explicitly versioned sport
  release adopts it. CFB r54 is the first production consumer; all other models remain on the
  production releases recorded below. Evidence:
  `docs/model-audits/2026-09-04-daily-edge-price-portability-predeclaration.md` and
  `docs/model-audits/2026-09-04-daily-edge-grade-gate-inventory.md`.

- September 18 MLB split-display repair: the existing one-card hierarchy remains
  current complete Circa, then current complete DraftKings, then current complete
  BetMGM. The independent DraftKings display feed now matches all current MLB
  provider abbreviations and preserves a coherent provider-reported 0/100 pair
  only in the display-only fallback. The stricter decision-grade endpoint guard,
  Playbook consensus separation, presentation labels/copy, model inputs,
  predictions, probabilities, grades, stakes, locks, and tracking are unchanged.

- September 20 cross-sport split-continuity repair: the shared DraftKings Network
  display fallback now persists only complete, non-empty verified feeds in the
  existing response-snapshot store and reuses the bounded last-known-good feed
  after a provider failure or server cold start. Weekly feeds expire after eight
  days; daily-sport feeds expire after 36 hours; exact sport, game date, and team
  identity matching still applies before any row is attached. NFL and CFB member
  assembly also retain the newest exact-game named-book observation from their
  immutable movement history when a later provider capture is empty. Consensus
  is never relabeled, and predictions, model inputs, probabilities, grades,
  stakes, locks, tracking, copy, and labels are unchanged. Promotions,
  demotions, and actionable-board impact are 0 / 0 / 0.

- September 24 football sharp-book evidence capture: the sole NFL and CFB forward
  writers now collect strict-identity, main-line-only Circa and Pinnacle moneyline, spread,
  total, and American-price observations from SharpAPI into their existing
  contextual evidence snapshots. The evidence is explicitly target-ineligible
  and cannot enter the current quote, consensus, probability, score, side,
  grade, actionability, stake, member snapshot, or UI. A provider failure is
  isolated from board publication, pagination is bounded at twelve bulk pages per book,
  and there is no per-game request loop. Writer / context-capture releases are
  `nfl_forward_evidence_writer_2026_09_24_r38_sharp_price_capture` /
  `nfl_daily_edge_forward_context_capture_2026_09_24_r2_sharp_price_trail` and
  `cfb_forward_evidence_writer_2026_09_24_r69_sharp_price_release_seed` /
  `cfb_daily_edge_forward_context_capture_2026_09_24_r2_sharp_price_trail`.
  Promotions, demotions, side changes, and actionable-board impact are all
  0 / 0 / 0 / 0. Any later model weight requires release-pure settled forward
  validation and a separate versioned model release. Evidence and rollback:
  `docs/model-audits/2026-09-24-football-sharp-price-capture.md`.
  CFB writer r69 additionally treats a missing or superseded contextual-capture
  release on an upcoming game as a zero-cadence release refresh. This seeds the
  capture after deployment instead of waiting up to the ordinary six-hour
  far-slate cadence; once seeded, the established bounded cadence resumes.

- September 26 CFB sharp-price continuity: capture / sole-writer releases are
  `cfb_daily_edge_forward_context_capture_2026_09_26_r3_sharp_price_trail_continuity`
  (`cfbfec3`) / `cfb_forward_evidence_writer_2026_09_26_r75_sharp_price_trail_continuity`.
  The writer now carries prior target-ineligible Circa and Pinnacle landmarks from the compact
  contextual capture into the next capture's opening candidates, preserving a real same-book
  chronological trail across cycles. It adds zero provider calls and still cannot affect current
  quote selection, consensus, forecasts, scores, sides, grades, stakes, tracking, member copy, or
  labels. Its audit boundary and rollback are recorded in
  `docs/model-audits/2026-09-26-cfb-market-reading-marriage-predeclaration.md`.

## Cross-sport market-freshness ownership (2026-10-06)

- NHL daily refresh release is `nhl_daily_refresh_schedule_2026_10_08_r10_pregame_coverage_gate`.
  The existing leased `nhl_daily_refresh` writer now has a lightweight intraday mode every 30
  minutes during the active window: it seeds the slate, refreshes exact lines, syncs provider-
  separated splits, recomputes unlocked predictions, and republishes the coherent Daily Edge
  snapshot. Expensive team/goalie refreshes remain daily. No second writer, member copy, label,
  threshold, grade policy, stake, or lock rule is added.
  The default member board now changes dates at 03:00 America/New_York only
  after the incoming date-keyed snapshot exists; partial cycles retain the
  prior complete board without member copy or labels. Evidence and rollback:
  `docs/model-audits/2026-10-07-nhl-readiness-gated-rollover-predeclaration.md`.
- NBA daily refresh release is `nba_daily_refresh_schedule_2026_10_07_r3_readiness_gated_rollover`.
  Its existing writer refreshes seed/lines and publishes the coherent date-keyed member snapshot
  while the expensive ratings scrape remains daily. The default member board changes dates at
  03:00 America/New_York only after the incoming snapshot exists; a failed incoming cycle silently
  retains the last published prior board, and an explicit date never falls back. The writer uses
  the existing `prediction_pipeline:nba` lease. NBA Playbook splits remain in the provider-separated
  observation table in audit-only mode; the capability registry still forbids display or model use
  until NBA-specific validation clears it. No model, probability, side, projection, grade, stake,
  tracking, copy, label, or layout changes. Evidence and rollback:
  `docs/model-audits/2026-10-07-nba-readiness-gated-rollover-predeclaration.md`.
- The operator readiness audit now measures the newest line and split age per game and reports
  games with no line, rather than treating a recent snapshot publish time as proof of fresh source
  evidence. This is operational detection only and changes no prediction.
- Member continuity is fail-open for the last verified prediction, line, price and complete split
  pair: source age remains internal and never removes those values or adds a stale badge, warning
  or replacement label. MLB keeps current Circa primary, silently uses the newest complete approved
  named-book fallback when Circa stops updating, and otherwise retains the last complete Circa pair.
  Display fallback rows remain excluded from recommendation arbitration.

## Cross-sport prediction-accuracy denominator contract (2026-09-04)

- Public W-L accuracy counts every immutable locked prediction that has a real side, including Watchlist and No Play. Best Angle and Lean remain separate actionable-only cuts. Exact-price ROI remains separate and excludes null-price records. The aggregate contract is `tracking_aggregate_v9_append_only_correction_precedence_2026_09_14`; an append-only correction explicitly supersedes its erroneous original before grade/actionability precedence is evaluated. Unlocked records from every sport remain outside public accuracy while they can still change.
- NFL tracking record / sole writer are `nfl_official_tracking_record_2026_09_28_r16_market_marriage` / `nfl_forward_evidence_writer_2026_10_09_r60_provider_feed_continuity`. An eligible T-60 payload emits all three immutable forecast markets. The sole writer preserves exact-game injury, line, split, and named-book continuity and reads Circa/Pinnacle price chronology through `nfl_daily_edge_forward_context_capture_2026_10_09_r8_market_state_identity`. The r30 family preserves the r29 target-excluded authority while repairing exact SharpAPI provider team identities. Spread overrides require same-direction number and no-vig-price movement from at least two books plus aligned fresh money-minus-ticket flow; opposing named flow vetoes. Moneyline can change the winner only when its stable two-named-book price read agrees with the qualified Spread read. Total requires either two aligned named-book number moves or broad stable target-excluded retail agreement with selected-book and all-book confirmation and no opposition, reversal, or buyback. Unknown handle, ticket count, bet size, limits, origin, and suspension lifecycle are never inferred. Collector `nfl_forward_evidence_collector_2026_10_09_r19_provider_feed_continuity`, fixture `nfl_weekly_member_fixture_2026_10_09_r42_provider_feed_continuity`, and compact snapshot `nfl_forward_member_snapshot_2026_10_09_r34_provider_feed_continuity` preserve older valid locks unchanged. The one `prediction_pipeline:nfl` lease, request ceiling, capture cadence, exact-price grading, tracking serializer, lock boundary, copy, labels, layout, and zero-stake policy are unchanged. Evidence and rollback: `docs/model-audits/2026-10-09-football-provider-feed-continuity-predeclaration.md`.
- WNBA prediction-record contract is `wnba_prediction_record_contract_v8_exact_price_denominator_2026_09_19`. A side-bearing ML, Total, or Spread forecast no longer disappears solely because its exact price or current decision tuple is unavailable; it becomes the same accuracy-only Held No Play shape. A complete exact-price tuple now retains that quote's break-even probability as the economic denominator when the stricter target-excluded fair probability is unavailable, while preserving the latter as null with its original provenance. Null-side forecasts, invalid team identity, release mismatch, and unverified game identity remain withheld. Existing locked records are immutable.
- The September 4 denominator release changed no forecast, side, probability, grade policy, actionable count, stake, provider query, schedule, lease, or database schema. Evidence and rollback: `docs/model-audits/2026-09-04-cross-sport-complete-tracking-denominators.md`. The September 19 WNBA r8 change is limited to its explicitly versioned economic denominator handoff described below.

## NFL Daily Edge generalized weekly production release

### Provider feed continuity (r30 candidate)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_10_09_r30_provider_feed_continuity` / `nfl_v1_daily_edge_model_2026_10_09_r27_provider_feed_continuity` / `nfl_v1_daily_edge_calibration_2026_10_09_r26_provider_feed_continuity` / `nfl_v1_daily_edge_decision_2026_10_09_r32_provider_feed_continuity` / `nfl_v1_grade_policy_2026_10_09_r32_provider_feed_continuity`. Weekly outcome / distribution / probability / representative score are `nfl_v1_weekly_paid_team_score_2026_10_09_r15_provider_feed_continuity` / `nfl_pooled_discrete_residual_distribution_2026_10_09_r14_provider_feed_continuity` / `nfl_v1_weekly_pooled_discrete_probability_2026_10_09_r14_provider_feed_continuity` / `nfl_v1_market_evidence_representative_score_2026_10_09_r14_provider_feed_continuity`. Market outcome / Spread / Total / target exclusion are `nfl_v1_market_evidence_outcome_2026_10_09_r15_provider_feed_continuity` / `nfl_v1_spread_market_direction_2026_10_09_r15_provider_feed_continuity` / `nfl_v1_total_market_evidence_2026_10_09_r11_provider_feed_continuity` / `nfl_target_excluded_market_outcome_2026_10_09_r13_provider_feed_continuity`.
- The professional r29 market-reading rules, thresholds, score reconciliation, exact-price grading, and board policy are unchanged. The adapter now recognizes only SharpAPI's exact documented/provider-observed abbreviation-plus-nickname NFL identities, including explicit LA-to-LAR and WAS-to-WSH aliases. It does not add fuzzy matching or infer missing handle/ticket evidence.
- The October 9 zero-write current-board comparison restores complete SharpAPI split evidence from 1 of 15 to 7 of 15 games. Six games gain valid evidence; projected scores, all three prediction sides, probabilities, grades, promotions, demotions, and the 18-actionable board are identical because none of the restored rows clears the existing professional authority rules. This current-slate result is not a promise that a future qualified row will remain neutral.
- Publication set is writer / collector / fixture / compact snapshot `nfl_forward_evidence_writer_2026_10_09_r60_provider_feed_continuity` / `nfl_forward_evidence_collector_2026_10_09_r19_provider_feed_continuity` / `nfl_weekly_member_fixture_2026_10_09_r42_provider_feed_continuity` / `nfl_forward_member_snapshot_2026_10_09_r34_provider_feed_continuity`. The complete r29 family remains the immediate immutable-lock predecessor. Evidence, gates, and rollback: `docs/model-audits/2026-10-09-football-provider-feed-continuity-predeclaration.md` and `docs/model-audits/2026-10-09-football-provider-feed-continuity-result.md`.

### Professional target-excluded market authority (r29)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_10_09_r29_professional_market_authority` / `nfl_v1_daily_edge_model_2026_10_09_r26_professional_market_authority` / `nfl_v1_daily_edge_calibration_2026_10_09_r25_professional_market_authority` / `nfl_v1_daily_edge_decision_2026_10_09_r31_professional_market_authority` / `nfl_v1_grade_policy_2026_10_09_r31_professional_market_authority`. Weekly outcome / distribution / probability / representative score are `nfl_v1_weekly_paid_team_score_2026_10_09_r14_professional_market_authority` / `nfl_pooled_discrete_residual_distribution_2026_10_09_r13_professional_market_authority` / `nfl_v1_weekly_pooled_discrete_probability_2026_10_09_r13_professional_market_authority` / `nfl_v1_market_evidence_representative_score_2026_10_09_r13_professional_market_authority`. Market outcome / Spread / Total / target exclusion are `nfl_v1_market_evidence_outcome_2026_10_09_r14_professional_market_authority` / `nfl_v1_spread_market_direction_2026_10_09_r14_professional_market_authority` / `nfl_v1_total_market_evidence_2026_10_09_r10_professional_market_authority` / `nfl_target_excluded_market_outcome_2026_10_09_r12_professional_market_authority`.
- One runtime authority owns both audit and production semantics. It distinguishes number, no-vig price, hold, chronology, persistence, buyback, reversal, source class, fresh split flow, resistance, and target-book exclusion. Spread needs aligned number+price consensus and aligned qualifying flow; this blocks the unsupported ARI-NYG replay flip while retaining PHI-CHI and ATL-NO corrections. Moneyline winner replacement remains cross-market coupled to that qualified Spread. Total uses two named number moves or a stricter broad-retail path with five stable target-excluded movers, zero opposition, selected-book/all-book confirmation, and no buyback/reversal.
- Across 65 settled locks from Weeks 1-5, compared separately with each lock's historical independent release, the combined rule changes one Moneyline, two Spreads, and four Totals: seven corrections and zero harms. Direction moves 38-27 to 39-26 Moneyline, 36-27-2 to 38-25-2 Spread, and 32-32-1 to 36-28-1 Total; team/margin/Total MAE moves 7.5999/10.0970/10.9755 to 7.5096/9.9467/10.8666. A final exact target-family-exclusion review removed CAR-CLE from the qualified Total set because its broad confirmation depended on the evaluated family; that removed historical correction is not credited. This is opened retrospective development evidence, not a pristine holdout or promised hit rate.
- On the exact 18-lock paid-score replay against r28, Moneyline and Spread are identical. Total moves 11-7 to 12-6, decision Brier 0.26325 to 0.25892, actionable performance 7-5 of 12 to 8-5 of 13, and Total MAE 10.0353 to 9.8787. NE-BUF is one side correction; PIT-CLE is one Watchlist-to-Best-Angle promotion that lost; there are zero side harms and zero demotions. Board count is 23 to 24, so the board is not flattened. Upset precision/recall and all Moneyline/Spread actionables remain unchanged.
- Publication set is writer / context / fixture / compact snapshot `nfl_forward_evidence_writer_2026_10_09_r59_professional_market_authority` / `nfl_daily_edge_forward_context_capture_2026_10_09_r8_market_state_identity` / `nfl_weekly_member_fixture_2026_10_09_r41_professional_market_authority` / `nfl_forward_member_snapshot_2026_10_09_r33_professional_market_authority`. The r28 family is the immediate immutable-lock predecessor; r27 remains readable behind it. Evidence and rollback: `docs/model-audits/2026-10-09-nfl-professional-market-reading-standard.md`, `docs/model-audits/professional-market-reading-certification-standard.md`, and `docs/model-audits/2026-10-09-nfl-professional-market-authority-r29-result.md`.

### Truthful market-state identity and exact exclusion (r28, preceding)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_10_09_r28_market_state_identity` / `nfl_v1_daily_edge_model_2026_10_09_r25_market_state_identity` / `nfl_v1_daily_edge_calibration_2026_10_09_r24_market_state_identity` / `nfl_v1_daily_edge_decision_2026_10_09_r30_market_state_identity` / `nfl_v1_grade_policy_2026_10_09_r30_market_state_identity`. Weekly outcome / distribution / probability / representative score are `nfl_v1_weekly_paid_team_score_2026_10_09_r13_market_state_identity` / `nfl_pooled_discrete_residual_distribution_2026_10_09_r12_market_state_identity` / `nfl_v1_weekly_pooled_discrete_probability_2026_10_09_r12_market_state_identity` / `nfl_v1_market_evidence_representative_score_2026_10_09_r12_market_state_identity`. Market outcome / Spread / Total / target exclusion are `nfl_v1_market_evidence_outcome_2026_10_09_r13_market_state_identity` / `nfl_v1_spread_market_direction_2026_10_09_r13_market_state_identity` / `nfl_v1_total_market_evidence_2026_09_28_r9_market_marriage` / `nfl_target_excluded_market_outcome_2026_10_09_r11_market_state_identity`.
- The r27 score/probability marriage remains authoritative. The r28 correction makes evidence identity truthful: only collected Circa/Pinnacle prices are named, a split retains its actual source, number/price/hold movement is separate, persistence starts at the first material move, reversals must be material, followers occur after both named leaders, and authority is rebuilt after exact evaluated-family exclusion. Unknown handle, ticket count, bet size, limits, origin, and suspension lifecycle are never inferred. Named Total authority remains disabled.
- On the exact same 18 stored paid-score locks, r28 is prediction- and decision-identical to live r27: Moneyline 11-7, Spread 12-5-1, Total 11-7; team/margin/Total MAE 6.4020/8.0955/10.0353; 23 actionables; zero promotions, zero demotions, and identical exact-price economics. The independent-model-agnostic Weeks 3-4 market audit has usable two-book trails for 31/32 games; the corrected released gate is 1-0 Moneyline and 5-0 Spread, with one projection disagreement producing one correction and zero harms. This is opened retrospective evidence, not an untouched holdout. Weeks 1-2 predate named chronology. The rejected same-book-only, evidence-priced, and same-winner guard candidates worsened direction or flattened actionability and have no production path.
- Publication set is writer / context / fixture / compact snapshot `nfl_forward_evidence_writer_2026_10_09_r58_market_state_identity` / `nfl_daily_edge_forward_context_capture_2026_10_09_r8_market_state_identity` / `nfl_weekly_member_fixture_2026_10_09_r40_market_state_identity` / `nfl_forward_member_snapshot_2026_10_09_r32_market_state_identity`. The October 8 r27 family is the immediate immutable-lock predecessor. Evidence and rollback: `docs/model-audits/2026-10-09-nfl-market-state-r29-predeclaration.md` and `docs/model-audits/2026-10-09-nfl-market-state-r28-result.md`.

### Named-book sequence authority (r27, preceding)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_10_08_r27_named_sequence` / `nfl_v1_daily_edge_model_2026_10_08_r24_named_sequence` / `nfl_v1_daily_edge_calibration_2026_10_08_r23_named_sequence` / `nfl_v1_daily_edge_decision_2026_10_08_r29_named_sequence` / `nfl_v1_grade_policy_2026_10_08_r29_named_sequence`. Weekly outcome / distribution / probability / representative score are `nfl_v1_weekly_paid_team_score_2026_10_08_r12_named_sequence` / `nfl_pooled_discrete_residual_distribution_2026_10_08_r11_named_sequence` / `nfl_v1_weekly_pooled_discrete_probability_2026_10_08_r11_named_sequence` / `nfl_v1_market_evidence_representative_score_2026_10_08_r11_named_sequence`. Market outcome / Spread / Total / target exclusion are `nfl_v1_market_evidence_outcome_2026_10_08_r12_named_sequence` / `nfl_v1_spread_market_direction_2026_10_08_r12_named_sequence` / `nfl_v1_total_market_evidence_2026_09_28_r9_market_marriage` / `nfl_target_excluded_market_outcome_2026_10_08_r10_named_sequence`.
- The paid independent score remains primary. The qualified named sequence may genuinely move the projected score and flip Spread direction. It may replace the outright winner only when separately qualified Moneyline and Spread sequences agree, while opposing fresh named flow retains the winner veto. Missing, stale, conflicting, unstable, or unconfirmed evidence is neutral. One joint distribution still owns expected score, representative score, all three market sides, probabilities, and downstream exact-price grades.
- The 32-game Weeks 3-4 signal audit finds the release gate on five Spreads at 3-2; it disagrees with the released projection once and that disagreement is one correction with zero harms. On the exact 18-game paid-score replay, it changes only PHI-CHI: Philadelphia by 5.00 becomes Philadelphia by 1.97, which preserves the Moneyline winner but flips the Spread to Chicago. Spread projection record improves 11-6-1 to 12-5-1, team-score MAE 7.4679 to 7.3837, and margin MAE 7.8194 to 7.6510. Moneyline, Total, upset metrics, evaluated decisions, five Spread actionables, promotions, and demotions are unchanged. This is small retrospective evidence, not a promised future hit rate.
- Publication set is writer / context / fixture / compact snapshot `nfl_forward_evidence_writer_2026_10_08_r57_named_sequence` / `nfl_daily_edge_forward_context_capture_2026_10_08_r7_named_sequence` / `nfl_weekly_member_fixture_2026_10_08_r39_named_sequence` / `nfl_forward_member_snapshot_2026_10_08_r31_named_sequence`. The r26/r28/r38/r30 family remains the immediate immutable-lock transition predecessor. Publication remains pending owner approval and the protected-PR/live verification steps.

### Cross-market winner coherence (r26)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_10_05_r26_winner_coherence` / `nfl_v1_daily_edge_model_2026_10_05_r23_winner_coherence` / `nfl_v1_daily_edge_calibration_2026_10_05_r22_winner_coherence` / `nfl_v1_daily_edge_decision_2026_10_05_r28_winner_coherence` / `nfl_v1_grade_policy_2026_10_05_r28_winner_coherence`. Weekly outcome / distribution / probability / representative score are `nfl_v1_weekly_paid_team_score_2026_10_05_r11_winner_coherence` / `nfl_pooled_discrete_residual_distribution_2026_10_05_r10_winner_coherence` / `nfl_v1_weekly_pooled_discrete_probability_2026_10_05_r10_winner_coherence` / `nfl_v1_market_evidence_representative_score_2026_10_05_r10_winner_coherence`. Market outcome / Spread / Total / target exclusion are `nfl_v1_market_evidence_outcome_2026_10_05_r11_winner_coherence` / `nfl_v1_spread_market_direction_2026_10_05_r11_winner_coherence` / `nfl_v1_total_market_evidence_2026_09_28_r9_market_marriage` / `nfl_target_excluded_market_outcome_2026_10_05_r9_winner_coherence`.
- The paid independent score remains primary and the r25 Total path is unchanged. A Spread-driven margin correction may replace the independent Moneyline winner only when a same-book Moneyline no-vig move of at least 1pp supports the proposed winner, a fresh named sharp-book gap of at least 10pp or lower-trust Playbook gap of at least 8pp corroborates it, and no qualifying sharp gap vetoes it. The qualified correction is real and reversible; missing evidence cannot authorize it. One joint distribution still owns scores, probabilities, and sides before exact-price grading.
- The exact 14-game / 42-market r27 forward replay changes Moneyline `8-6→10-4`, Spread excluding two pushes `6-6→9-3`, team-score MAE `5.6509→5.5307`, and margin MAE `7.5731→5.7677`. Total remains `9-5` with identical side, probability, grade, projected Total, and Total MAE. Four Moneyline/Spread sides change; three correct the incumbent and one harms it. Grade counts and actionable counts are identical, with zero promotions and zero demotions, so the board is not flattened. These are small release-pure forward diagnostics, not a promised future hit rate.
- Publication set: writer / fixture / compact snapshot are `nfl_forward_evidence_writer_2026_10_08_r56_game_designation_continuity` / `nfl_weekly_member_fixture_2026_10_07_r38_exact_quote_label_coherence` / `nfl_forward_member_snapshot_2026_10_07_r30_exact_quote_label_coherence`. The r55 injury-continuity writer is the immediate availability predecessor, and the r25/r27/r36/r28 spread-grade family remains the immutable-lock transition predecessor. The October 8 writer repair changes injury-source completeness only; the October 7 reader repair changes only nine displayed Spread/Total line values so each matches its already-authoritative evaluated book and price. Predictions, scores, probabilities, prices, grades, locks, tracking, and actionability formulas remain unchanged. Evidence: `docs/model-audits/2026-10-08-nfl-game-designation-injury-continuity.md` and `docs/model-audits/2026-10-07-nfl-exact-quote-label-coherence-r38.md`.

### Spread actionable-grade recalibration (r25)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_10_02_r25_spread_grade_calibration` / `nfl_v1_daily_edge_model_2026_10_02_r22_spread_grade_calibration` / `nfl_v1_daily_edge_calibration_2026_10_02_r21_spread_grade_calibration` / `nfl_v1_daily_edge_decision_2026_10_02_r27_spread_grade_calibration` / `nfl_v1_grade_policy_2026_10_02_r27_spread_grade_calibration`.
- The r24 joint PMF, independent score, market-reading marriage, prediction sides, probabilities, expected scores, exact quotes, Moneyline grades, and Total grades remain unchanged. Spread actionability now requires at least 56.5% model probability in addition to the existing exact-price reliability, nonnegative-EV, nonnegative-edge, and cushion gates; Best Angle requires at least 59.0%. Grades remain downstream and cannot change a prediction or score.
- On the exact 47-game opened r23 replay, Weeks 1-2 selection is 9-4 across 13 actions and Week 3 confirmation is 4-2 across six actions. The combined candidate is 13-6 across 19 actions, with Best Angle 8-2 and Lean 5-4. These are opened diagnostics, not a promised future hit rate.
- The exact Week 4 no-write comparison retains 16 games / 48 markets and moves 20 Best Angles / 7 Leans / 5 Watchlists / 16 No Plays to 17 / 5 / 10 / 16. Spread moves 9 / 3 / 3 / 1 to 6 / 1 / 8 / 1: zero actionable promotions, five actionable demotions, one within-actionable demotion, seven actionable Spreads, and 22 total actionables. The symmetric promotion path remains active and boundary-tested for any future unlocked row that clears every released gate; the board remains above its predeclared non-flat floor.
- Publication set: writer / fixture / compact snapshot are `nfl_forward_evidence_writer_2026_10_02_r52_spread_grade_calibration` / `nfl_weekly_member_fixture_2026_10_02_r36_spread_grade_calibration` / `nfl_forward_member_snapshot_2026_10_02_r28_spread_grade_calibration`. The r24/r26/r27 joint-Moneyline family remains the explicit immutable-lock transition predecessor. No stake, provider call, cadence, schedule, second writer, member copy, label, or layout changes. Evidence and rollback: `docs/model-audits/2026-10-02-nfl-spread-grade-calibration-predeclaration.md` and `docs/model-audits/2026-10-02-nfl-spread-grade-calibration-result.md`.

### Joint-PMF Moneyline coherence repair (r24)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_09_29_r24_joint_moneyline_coherence` / `nfl_v1_daily_edge_model_2026_09_29_r21_joint_moneyline_coherence` / `nfl_v1_daily_edge_calibration_2026_09_29_r20_joint_moneyline_coherence` / `nfl_v1_daily_edge_decision_2026_09_29_r26_joint_moneyline_coherence` / `nfl_v1_grade_policy_2026_09_29_r26_joint_moneyline_coherence`.
- The r23 score model and complete market-reading marriage remain unchanged. Moneyline prediction probability and exact-price grading now consume the same final joint PMF as expected score, Spread, and Total; the legacy aligned-r6 probability can no longer replace it after score generation. Target-excluded exact-price selection and other-book fair consensus remain active downstream. This restores Week 4 complete-slate publication without a threshold, score, market-reading, call-budget, writer, schedule, stake, copy, label, or layout change.
- The production incident and exact no-write comparison are recorded in `docs/model-audits/2026-09-29-nfl-week-four-rollover-joint-moneyline-coherence.md`. The candidate restores 16/16 games and 48/48 markets with 20 Best Angles / 5 Leans / 4 Watchlists / 19 No Plays and no coherence holds. Publication set: writer `nfl_forward_evidence_writer_2026_09_29_r51_joint_moneyline_coherence`, fixture `nfl_weekly_member_fixture_2026_09_29_r35_joint_moneyline_coherence`, compact snapshot `nfl_forward_member_snapshot_2026_09_29_r27_joint_moneyline_coherence`.

### Preceding paid team-score and complete market-reading marriage (r23)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_09_28_r23_market_marriage` / `nfl_v1_daily_edge_model_2026_09_28_r20_market_marriage` / `nfl_v1_daily_edge_calibration_2026_09_28_r19_market_marriage` / `nfl_v1_daily_edge_decision_2026_09_28_r25_market_marriage` / `nfl_v1_grade_policy_2026_09_28_r25_market_marriage`. Weekly outcome / distribution / probability / representative score are `nfl_v1_weekly_paid_team_score_2026_09_28_r10_market_marriage` / `nfl_pooled_discrete_residual_distribution_2026_09_28_r9_total_direction_coherence` / `nfl_v1_weekly_pooled_discrete_probability_2026_09_28_r9_total_direction_coherence` / `nfl_v1_market_evidence_representative_score_2026_09_28_r9_market_marriage`. Market outcome / Spread / Total / target exclusion are `nfl_v1_market_evidence_outcome_2026_09_28_r10_market_marriage` / `nfl_v1_spread_market_direction_2026_09_28_r10_market_marriage` / `nfl_v1_total_market_evidence_2026_09_28_r9_market_marriage` / `nfl_target_excluded_market_outcome_2026_09_28_r8_market_marriage`.
- The r22 paid independent team-score center remains authoritative. Verified chronological same-book line movement may perform a real, reversible Spread or Total direction correction by rebuilding the distribution from the independent base; it is not a capped nudge and never compounds across refreshes. Circa is the preferred named split source, another named sharp-book split may substitute, and Playbook multi-book money/tickets is the lower-trust fallback. Missing evidence is unavailable rather than neutral. Split agreement, disagreement and reverse-line behavior remain source-separated internal context; the exact replay does not authorize a split-only direction flip. Exact-price evidence reliability selects the representative quote before the forecast is frozen, and the grade is assigned strictly downstream. No member copy, labels, layout, stake, writer, schedule or provider-call path changes.
- The exact 47-game current-release replay uses Weeks 1-2 as selection and Week 3 as later confirmation. Against r22, the complete candidate changes Moneyline `32-15→33-14`, holds Spread at `27-18`, and changes Total `24-23→28-19`; team-score / margin / Total MAE change `8.0946→7.9078`, `9.9729→9.9708`, and `11.5966→11.1901`. Week 3 Total improves `7-8→11-4`; selection does not decline in any market. The candidate has zero literal score/side contradictions, zero nonpositive-EV actionables, 18 genuine Total side flips with 11 corrections and 7 harms, and retains both Over and Under corrections. These opened samples are provisional evidence, not a guaranteed future win rate.
- Grade calibration retains 69/81 actionables (85.2%). Excluding two baseline Spread pushes, its settled actionable record changes from 47-32 (59.5%) to 44-23 (65.7%); there are four actionable promotions and sixteen actionable demotions. Final candidate actionables are 14 Moneylines, 39 Spreads and 16 Totals across 47 games, so the board is not flattened. Price or grade changes cannot alter the already-frozen side, probability distribution or displayed score.
- Publication set: paid score input / active score model `nfl_paid_projection_shadow_2026_09_28_r2_direct_score` / `nfl_v1_paid_team_score_model_2026_09_28_r2_market_marriage`; collector / sole writer / context / fixture / compact snapshot `nfl_forward_evidence_collector_2026_09_28_r16_injury_continuity` / `nfl_forward_evidence_writer_2026_09_28_r50_injury_continuity` / `nfl_daily_edge_forward_context_capture_2026_09_28_r6_paid_team_score_activation` / `nfl_weekly_member_fixture_2026_09_28_r34_expected_score_tenths` / `nfl_forward_member_snapshot_2026_09_28_r26_injury_continuity_tenths`; tracking lifecycle / composite / boundary / record `nfl_tracking_lifecycle_2026_09_28_r17_market_marriage` / `nfl_tracking_composite_release_bundle_2026_09_28_r13_market_marriage` / `nfl_evaluated_tuple_tracking_boundary_2026_09_28_r14_market_marriage` / `nfl_official_tracking_record_2026_09_28_r16_market_marriage`. The writer orders its decision timestamp after every consumed quote and silently preserves the newest verified exact-game injury report when a provider refresh is empty. Newly captured rows expose expected-score means at tenths; older eligible T-60 rows remain immutable during transition. Evidence and rollback: `docs/model-audits/2026-09-28-nfl-current-forward-marriage-r105-predeclaration.md` and `docs/model-audits/2026-09-28-nfl-current-forward-marriage-r106-result.md`.

### Preceding paid team-score and bounded market-reading marriage (r22)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_09_28_r22_paid_team_score` / `nfl_v1_daily_edge_model_2026_09_28_r19_paid_team_score` / `nfl_v1_daily_edge_calibration_2026_09_28_r18_paid_team_score` / `nfl_v1_daily_edge_decision_2026_09_28_r24_paid_team_score` / `nfl_v1_grade_policy_2026_09_28_r24_paid_team_score`. Weekly outcome / distribution / probability / representative score are `nfl_v1_weekly_paid_team_score_2026_09_28_r9_market_reading` / `nfl_pooled_discrete_residual_distribution_2026_09_28_r8_paid_team_score` / `nfl_v1_weekly_pooled_discrete_probability_2026_09_28_r8_paid_team_score` / `nfl_v1_market_evidence_representative_score_2026_09_28_r8_paid_team_score`. Market outcome / Spread / Total / target exclusion are `nfl_v1_market_evidence_outcome_2026_09_28_r9_paid_team_score` / `nfl_v1_spread_market_direction_2026_09_28_r9_paid_team_score` / `nfl_v1_total_market_evidence_2026_09_28_r8_paid_team_score` / `nfl_target_excluded_market_outcome_2026_09_28_r7_paid_team_score`.
- A complete pregame BALLDONTLIE weekly projection now supplies the independent away/home score center through the opposing D/ST `points_allowed` projections. The player-component construction remains an internal health cross-check. The former 90% market margin and 75% market Total center no longer overwrite a complete paid projection. Fresh strictly matched Circa/public margin evidence and target-free same-book opening-to-current Spread/price movement retain their existing bounded correction and rebuild the final PMF. Target exclusion is market-family scoped: excluding one book's Total cannot erase a separately target-free Spread/moneyline trail. Total movement and split gaps remain captured but receive zero Total-mean weight because the exact movement diagnostic reduced accuracy. Exact price remains a line-specific decision/grade input.
- On the exact 47 settled 2026 Week 1-3 snapshots, direct paid scores improve the preceding independent signal from 27/47 to 31/47 winners, 17/44 to 21/44 Spread direction, and 21/47 to 26/47 Total direction; team-score / margin / Total MAE improve from 8.4826 / 11.1221 / 12.0518 to 8.2301 / 10.6887 / 11.5406. The verified Spread-movement diagnostic reaches 22/44 with 8.1556 / 10.5402 / 11.5406 MAE. This is owner-approved provisional evidence, not a guaranteed future win rate.
- The exact live-data zero-write replay retains the one remaining Week 3 game and all three markets. PHI-CHI changes from representative 22-20, PHI ML Lean / CHI +3.5 Best Angle / Over 41.5 No Play to representative 24-19, PHI ML No Play / PHI -3.5 Lean / Over 41.5 Best Angle. That is one promotion, two demotions, one Spread side change, and no net actionable or grade-count change; the full board remains 6 Best Angles / 12 Leans / 6 Watchlists / 24 No Plays. The direct 25.03-18.90 input becomes expected 24.47-19.46 after the verified five-point Philadelphia line move and the opposing fresh Circa margin signal are combined under the established Circa-priority cap. All predictions, probabilities and the displayed score derive from that final PMF.
- Publication set: paid score input / active score model `nfl_paid_projection_shadow_2026_09_28_r2_direct_score` / `nfl_v1_paid_team_score_model_2026_09_28_r1_market_reading`; collector / sole writer / context / fixture / compact snapshot `nfl_forward_evidence_collector_2026_09_28_r14_paid_team_score_activation` / `nfl_forward_evidence_writer_2026_09_28_r47_paid_team_score_activation` / `nfl_daily_edge_forward_context_capture_2026_09_28_r6_paid_team_score_activation` / `nfl_weekly_member_fixture_2026_09_28_r32_paid_team_score_transition` / `nfl_forward_member_snapshot_2026_09_28_r24_paid_team_score_transition`; tracking lifecycle / composite / boundary / record `nfl_tracking_lifecycle_2026_09_28_r16_paid_team_score` / `nfl_tracking_composite_release_bundle_2026_09_28_r12_paid_team_score` / `nfl_evaluated_tuple_tracking_boundary_2026_09_28_r13_paid_team_score` / `nfl_official_tracking_record_2026_09_28_r15_paid_team_score`. Locked r21/r20/r18 rows remain immutable during the transition. Evidence and rollback: `docs/model-audits/2026-09-28-nfl-paid-team-score-activation-r22-predeclaration.md` and `docs/model-audits/2026-09-28-nfl-paid-team-score-activation-r22-result.md`.

### Preceding pressure-direction margin residual (r21)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_09_27_r21_pressure_direction` / `nfl_v1_daily_edge_model_2026_09_27_r18_pressure_direction` / `nfl_v1_daily_edge_calibration_2026_09_27_r17_pressure_direction` / `nfl_v1_daily_edge_decision_2026_09_27_r23_pressure_direction` / `nfl_v1_grade_policy_2026_09_27_r23_pressure_direction`. Weekly outcome / distribution / probability / representative score are `nfl_v1_weekly_market_anchored_outcome_2026_09_27_r8_pressure_direction` / `nfl_pooled_discrete_residual_distribution_2026_09_27_r7_pressure_direction` / `nfl_v1_weekly_pooled_discrete_probability_2026_09_27_r7_pressure_direction` / `nfl_v1_market_evidence_representative_score_2026_09_27_r7_pressure_direction`. Market outcome / Spread / Total / target exclusion are `nfl_v1_market_evidence_outcome_2026_09_27_r8_pressure_direction` / `nfl_v1_spread_market_direction_2026_09_27_r8_pressure_direction` / `nfl_v1_total_market_evidence_2026_09_27_r7_pressure_direction` / `nfl_target_excluded_market_outcome_2026_09_27_r6_pressure_direction`.
- The existing prior-week possession/efficiency signal remains 10% of the target-excluded margin center and the market remains 90%. A separately trained pressure/turnover direction head now adds a signed residual capped at three points. It uses only opponent-adjusted sack and turnover state available before the forecast week; its immutable artifact is trained through 2025 and updated in 2026 only from completed prior weeks. The existing Total center, target-excluded iteration, same-book movement reading, split evidence, exact-price decisions, coherent score distribution, representative score, and lock behavior remain. The historically promising quarterback Total residual remains shadow-only because exact current-slate runtime parity is not yet proven.
- Selection 2022-2023 margin MAE improves `9.3223→9.3098` with 54.72% against-market direction; untouched 2024-2025 confirmation improves `9.6664→9.6378` with 54.92% direction. Every individual season avoids margin-MAE regression, winner accuracy is unchanged, and coherence contradictions are zero. The final exact current replay retains 16 games / 48 forecasts and all ten immutable locks; actionables move 16→17 with one promotion, one within-actionable demotion, and zero Moneyline, Spread, or Total side changes. This is measured point-error improvement, not a guaranteed win rate.
- Publication set: pressure artifact / weekly signal `nfl_pressure_direction_runtime_artifact_2026_09_27_r1` / `nfl_weekly_raw_signal_2026_09_27_r3_pressure_direction`; collector / sole writer / fixture / compact snapshot `nfl_forward_evidence_collector_2026_09_28_r13_opening_timestamp_paid_projection_shadow` / `nfl_forward_evidence_writer_2026_09_28_r46_opening_timestamp_paid_projection_shadow` / `nfl_weekly_member_fixture_2026_09_27_r31_pressure_transition_continuity` / `nfl_forward_member_snapshot_2026_09_27_r23_pressure_transition_continuity`; tracking lifecycle / composite / boundary / record `nfl_tracking_lifecycle_2026_09_27_r15_pressure_direction` / `nfl_tracking_composite_release_bundle_2026_09_27_r11_pressure_direction` / `nfl_evaluated_tuple_tracking_boundary_2026_09_27_r12_pressure_direction` / `nfl_official_tracking_record_2026_09_27_r14_immutable_tuple_recovery`. The September 28 writer also captures direct paid weekly score projections in internal shadow release `nfl_paid_projection_shadow_2026_09_28_r2_direct_score` and repaired provider opening timestamps in context release `nfl_daily_edge_forward_context_capture_2026_09_28_r5_provider_opening_timestamp`; neither is consumed by production decisions or tracking. The failed r22 pressure snapshot contract and last complete member r20 / decision r22 / fixture r29 / snapshot r21 family are bounded availability predecessors. The transition fixture retains both the nine r20 and one r18 Week 3 immutable locks beside six current r21 unlocked games; exact production evidence reconstructs 16 games / 48 markets with 10 locked and 6 open. The tracking-isolation repair changes no forecast, probability, side, grade, provider call, database read, cron, lease, member copy, label, layout, or stake. Evidence and rollback: `docs/model-audits/2026-09-27-nfl-pressure-direction-predeclaration.md`, `docs/model-audits/2026-09-27-nfl-pressure-direction-result.md`, `docs/model-audits/2026-09-27-nfl-pressure-transition-continuity.md`, `docs/model-audits/2026-09-27-nfl-lock-tracking-isolation.md`, `docs/model-audits/2026-09-28-nfl-opening-odds-observed-at-repair-predeclaration.md`, and `docs/model-audits/2026-09-28-nfl-paid-projection-forward-shadow-r1-predeclaration.md`.

### Current-season raw-signal repair (r20)

- Active member / model / calibration / decision / grade are `nfl_v1_member_release_2026_09_25_r20_current_season_raw_signal` / `nfl_v1_daily_edge_model_2026_09_25_r17_current_season_raw_signal` / `nfl_v1_daily_edge_calibration_2026_09_25_r16_current_season_raw_signal` / `nfl_v1_daily_edge_decision_2026_09_25_r22_current_season_raw_signal` / `nfl_v1_grade_policy_2026_09_25_r22_current_season_raw_signal`. Weekly outcome / distribution / probability / representative score are `nfl_v1_weekly_market_anchored_outcome_2026_09_25_r7_current_season_raw_signal` / `nfl_pooled_discrete_residual_distribution_2026_09_25_r6_current_season_raw_signal` / `nfl_v1_weekly_pooled_discrete_probability_2026_09_25_r6_current_season_raw_signal` / `nfl_v1_market_evidence_representative_score_2026_09_25_r6_current_season_raw_signal`. Market outcome / Spread / Total / target exclusion are `nfl_v1_market_evidence_outcome_2026_09_25_r7_current_season_raw_signal` / `nfl_v1_spread_market_direction_2026_09_25_r7_current_season_raw_signal` / `nfl_v1_total_market_evidence_2026_09_25_r6_current_season_raw_signal` / `nfl_target_excluded_market_outcome_2026_09_25_r5_current_season_raw_signal`.
- Beginning after Week 1, the raw matchup margin uses prior-week final points, plays, sacks, turnovers, and red-zone conversion, blended 10% with the 90% target-excluded market margin. The existing price-neutral Total core remains; valid same-book movement outside the evaluated Total family may shift its mean, while money/ticket splits remain internal evidence and cannot directly overwrite the raw Total center. Week 1 remains the immutable released artifact.
- The exact 32-game raw-forecast replay keeps Moneyline 22/32, improves Spread 12/32 to 15/32 and Total 13/32 to 15/32, and improves team-score, margin, and Total MAE. Week 2 alone is 11/16 Moneyline, 10/16 Spread, and 8/16 Total. The current Week 3 replay preserves 16 games / 48 markets and one immutable T-60 game; actionables move 12 to 13 with five promotions, two demotions, and no Moneyline or Spread side changes. No UI copy, labels, stakes, schedules, leases, or per-game provider calls changed.
- Publication set: evidence schema remains `nfl_forward_evidence_snapshot_2026_09_01_r6_forecast_value_separation`; collector `nfl_forward_evidence_collector_2026_09_25_r11_current_season_raw_signal`, sole writer `nfl_forward_evidence_writer_2026_09_26_r42_context_capture_release_refresh`, context capture `nfl_daily_edge_forward_context_capture_2026_09_26_r4_sharp_price_trail_continuity`, fixture `nfl_weekly_member_fixture_2026_09_25_r29_current_season_raw_signal`, compact snapshot `nfl_forward_member_snapshot_2026_09_25_r21_current_season_raw_signal`, tracking lifecycle / composite / boundary / record `nfl_tracking_lifecycle_2026_09_25_r14_current_season_raw_signal` / `nfl_tracking_composite_release_bundle_2026_09_25_r10_current_season_raw_signal` / `nfl_evaluated_tuple_tracking_boundary_2026_09_25_r11_current_season_raw_signal` / `nfl_official_tracking_record_2026_09_25_r12_current_season_raw_signal`. Writer r41 and context r3 are the immediate predecessors, while r19/r21/r28/r20 remains the bounded member-availability predecessor. Evidence and rollback: `docs/model-audits/2026-09-25-nfl-raw-signal-repair-predeclaration.md`, `docs/model-audits/2026-09-25-nfl-raw-signal-repair-result.md`, and `docs/model-audits/2026-09-26-nfl-sharp-price-trail-continuity-predeclaration.md`.

### Preceding marginal-likelihood representative score (r18)

- Active member / model are `nfl_v1_member_release_2026_09_25_r19_marginal_likelihood_score` / `nfl_v1_daily_edge_model_2026_09_25_r16_marginal_likelihood_score`. Weekly outcome / representative score are `nfl_v1_weekly_market_anchored_outcome_2026_09_25_r6_marginal_likelihood_score` / `nfl_v1_market_evidence_representative_score_2026_09_25_r5_marginal_likelihood`. Distribution, probability, calibration, decision, grade, target-exclusion, and tracking releases remain the qualified r17 family because their behavior is unchanged.
- The displayed weekly score now selects a nonnegative, non-tied, parity-valid, winner-consistent pair with positive probability in both released marginal distributions, balancing joint marginal likelihood with a frozen `0.20` center-distance weight. It replaces independent rounding of expected team scores; it does not force a wider margin or change the distribution means.
- Untouched 2024–25 confirmation across 544 games improves team-score MAE `7.1618→7.1581` and margin MAE `9.6618→9.6397`, keeps winner accuracy identical at `68.3824%`, and leaves total MAE effectively flat at `10.0588→10.0625`. Absolute-margin-at-most-two forecasts move `18.3824%→17.2794%` toward the observed `11.0294%` rate. The current 16-game replay changes 12 score pairs, moves five one/two-point margins to four, preserves 48/48 predictions and 16/16 score/winner identities, and has zero promotions, demotions, side/probability/grade changes, or actionable-count change.
- Publication set: collector `nfl_forward_evidence_collector_2026_09_25_r10_marginal_likelihood_score`, sole writer `nfl_forward_evidence_writer_2026_09_25_r39_marginal_likelihood_score`, fixture `nfl_weekly_member_fixture_2026_09_25_r28_marginal_likelihood_score`, compact snapshot `nfl_forward_member_snapshot_2026_09_25_r20_marginal_likelihood_score`. Existing immutable r18/r21 T-60 rows and the r19 compact snapshot remain explicit bounded transition fallbacks. No UI copy or labels changed. Evidence and rollback: `docs/model-audits/2026-09-25-nfl-weekly-representative-score-predeclaration.md` and `docs/model-audits/2026-09-25-nfl-weekly-representative-score-result.md`.

### Preceding opening-to-market Spread direction (r17)

- Active member release: `nfl_v1_member_release_2026_09_21_r18_opening_market_direction`; model / calibration / decision / grade policy: `nfl_v1_daily_edge_model_2026_09_21_r15_opening_market_direction` / `nfl_v1_daily_edge_calibration_2026_09_21_r15_opening_market_direction` / `nfl_v1_daily_edge_decision_2026_09_21_r21_opening_market_direction` / `nfl_v1_grade_policy_2026_09_21_r21_opening_market_direction`. Weekly outcome model / distribution / probability are `nfl_v1_weekly_market_anchored_outcome_2026_09_21_r5_opening_market_direction` / `nfl_pooled_discrete_residual_distribution_2026_09_21_r5_opening_market_direction` / `nfl_v1_weekly_pooled_discrete_probability_2026_09_21_r5_opening_market_direction`; market-evidence outcome / representative score / Spread head are `nfl_v1_market_evidence_outcome_2026_09_21_r6_opening_market_direction` / `nfl_v1_market_evidence_representative_score_2026_09_21_r4_opening_market_direction` / `nfl_v1_spread_market_direction_2026_09_21_r6`; target exclusion is `nfl_target_excluded_market_outcome_2026_09_21_r4_opening_market_direction`.
- The Spread direction uses the operational opening against the current target-excluded consensus line: a move of at least 0.5 points selects its direction, otherwise the target-excluded no-vig price lean selects the side. An opposing incumbent PMF is reflected around 50% at the same probability distance rather than flattened. The coherent PMF, projected scores, representative score, exact-price economics, and all published surfaces derive from the oriented distribution. Every healthy game retains Moneyline, Spread, and Total predictions; no copy or label changes.
- Predeclared 2021-2023 selection was 413-374 (52.4778%), with every season above 50%. Untouched 2024-2025 confirmation was 281-257 (52.2305%), with 2024 at 51.3109% and 2025 at 53.1365%. The current-season locked diagnostic was 19-10 and improved Brier 0.255006→0.243361; it is diagnostic, not an untouched holdout. The Week 2 exact board replay keeps 48/48 predictions, changes nine Spread sides, makes two promotions and four demotions across tiers, and keeps Spread actionables 2→2. Moneyline and Total sides/grades are unchanged. The analogous Total movement rule failed selection and is not promoted.
- Publication set: collector `nfl_forward_evidence_collector_2026_09_21_r9_opening_market_direction`, sole writer `nfl_forward_evidence_writer_2026_09_24_r38_sharp_price_capture`, fixture `nfl_weekly_member_fixture_2026_09_22_r27_nonpush_side_alignment`, compact snapshot `nfl_forward_member_snapshot_2026_09_22_r19_nonpush_side_alignment`, coherence `football_cross_market_coherence_2026_09_22_r12_nfl_nonpush_side_alignment`, tracking lifecycle / composite / tuple boundary / record `nfl_tracking_lifecycle_2026_09_21_r13_opening_market_direction` / `nfl_tracking_composite_release_bundle_2026_09_21_r9_opening_market_direction` / `nfl_evaluated_tuple_tracking_boundary_2026_09_21_r10_opening_market_direction` / `nfl_official_tracking_record_2026_09_21_r11_opening_market_direction`. The evidence schema, active model/calibration/decision/grade releases, one `prediction_pipeline:nfl` lease, append-only T-60 records, score distribution, probabilities, sides, grades, actions, stakes, and cron cadence are unchanged. The evidence request budget adds at most twelve bulk SharpAPI pages per configured sharp book, never a per-game loop. The NFL caller now validates Spread and Total direction with the same push-excluded probability convention already used by its released decision selector; a near-normalized push-heavy distribution can no longer false-fail the whole game by comparing against half-push display math. This repairs the Week 3 `1392255` isolation and restores 16/16 fixture publication without weakening wider PMF/mean, score, market-count, price, value, or event-containment failures. Promotions/demotions and same-input tuple changes are 0/0/0. Evidence and rollback: `docs/model-audits/2026-09-22-nfl-week3-publication-continuity.md`.

### Preceding Moneyline / generalized Total coherence (r16)

- Active member release: `nfl_v1_member_release_2026_09_20_r17_ml_total_coherence`; model / calibration / decision / grade policy: `nfl_v1_daily_edge_model_2026_09_20_r14_ml_total_coherence` / `nfl_v1_daily_edge_calibration_2026_09_20_r14_ml_total_coherence` / `nfl_v1_daily_edge_decision_2026_09_20_r20_ml_total_coherence` / `nfl_v1_grade_policy_2026_09_20_r20_ml_total_coherence`. Weekly outcome model / distribution / probability are `nfl_v1_weekly_market_anchored_outcome_2026_09_20_r4_priced_neutral_total` / `nfl_pooled_discrete_residual_distribution_2026_09_20_r4_priced_neutral_total` / `nfl_v1_weekly_pooled_discrete_probability_2026_09_20_r4_priced_neutral_total`; market-evidence outcome / representative score are `nfl_v1_market_evidence_outcome_2026_09_20_r5_priced_neutral_total` / `nfl_v1_market_evidence_representative_score_2026_09_20_r3_priced_neutral_total`; Total head / target-exclusion resolver are `nfl_v1_total_market_evidence_2026_09_20_r5_priced_neutral` / `nfl_target_excluded_market_outcome_2026_09_20_r3_priced_neutral_total`.
- A healthy r6 Moneyline Lean may publish only when its exact team equals the holistic predicted winner and its exact price remains within -300..+300. Its probability, target-excluded fair probability, quote, EV, edge, model release, and calibration release stay together. A conflict is rejected; the forecast remains side-authoritative. The existing 2% EV / 4pp edge Best Angle gate is unchanged. Generalized Totals now shift the same discrete PMF until non-push Over probability matches fresh target-excluded same-line two-sided no-vig consensus, then apply the existing bounded signed sharp/public/movement evidence. Insufficient consensus uses the preceding coherent forecast; no side or grade quota exists.
- Historical 2024-2025 Total confirmation improves directional accuracy 46.9501%→53.6044%, Brier 0.251835→0.250094, calibration gap 0.052493→0.029959, and MAE 10.0616→10.0298, with both seasons above 50%. Frozen r6 Moneyline confirmation remains 121-55 and +18.375 units pooled across 2024-2025. The current 16-game replay keeps all 48 predictions, changes Total direction 15 Under / 1 Over→13 Under / 3 Over, makes six promotions and five demotions, and increases actionables 5→7. No promoted Moneyline opposes the predicted winner. Spread actionability is unchanged.
- Publication set: evidence schema `nfl_forward_evidence_snapshot_2026_09_01_r6_forecast_value_separation` (contract unchanged), collector `nfl_forward_evidence_collector_2026_09_20_r8_ml_total_coherence`, sole writer `nfl_forward_evidence_writer_2026_09_20_r34_boundary_handoff`, fixture `nfl_weekly_member_fixture_2026_09_20_r24_locked_transition`, compact snapshot `nfl_forward_member_snapshot_2026_09_20_r16_locked_transition`, tracking lifecycle / composite / tuple boundary / record `nfl_tracking_lifecycle_2026_09_20_r12_release_parity` / `nfl_tracking_composite_release_bundle_2026_09_20_r8_release_parity` / `nfl_evaluated_tuple_tracking_boundary_2026_09_20_r9_release_parity` / `nfl_official_tracking_record_2026_09_20_r10_boundary_handoff`. Tracking admits both already-active Moneyline model/calibration pairs and applies the exact released one-point NFL PMF/mean tolerance already enforced by the writer. Eligibility is recomputed from the immutable on-time T-60 tuple, and the sole writer explicitly hands that verified boundary to the serializer while preserving the original evidence hash. The frozen early-Sunday cohort remains the correct 8 games / 24 markets and can be recovered from the existing 16:06 UTC evidence without reconstructing a prediction. This parity hotfix changes zero forecasts, probabilities, sides, prices, grades, promotions, demotions, actions, stakes, member-board rows, provider calls, schedules, leases, copy, or labels. Promotions/demotions are 0/0. Existing locked records remain immutable. The transition reader retains only the valid immutable preceding r16/r19 T-60 game after kickoff; it cannot recompute or relabel that finished game. Evidence and rollback: `docs/model-audits/2026-09-20-nfl-daily-edge-moneyline-total-coherence-predeclaration.md`, `docs/model-audits/2026-09-20-nfl-daily-edge-moneyline-total-coherence-result.md`, `docs/model-audits/2026-09-20-nfl-locked-transition-publication-hotfix.md`, `docs/model-audits/2026-09-20-nfl-tracking-coherence-parity-hotfix.md`, and `docs/model-audits/2026-09-20-nfl-tracking-boundary-handoff-hotfix.md`.

### Preceding injury pagination and Player Props recovery (r15)

- Active member release: `nfl_v1_member_release_2026_09_16_r16_injury_pagination`; model / calibration / decision / grade policy: `nfl_v1_daily_edge_model_2026_09_16_r13_injury_pagination` / `nfl_v1_daily_edge_calibration_2026_09_16_r13_injury_pagination` / `nfl_v1_daily_edge_decision_2026_09_16_r19_injury_pagination` / `nfl_v1_grade_policy_2026_09_16_r19_injury_pagination`. The sole writer is `nfl_forward_evidence_writer_2026_09_16_r30_injury_pagination`, fixture `nfl_weekly_member_fixture_2026_09_16_r22_injury_pagination`, collector `nfl_forward_evidence_collector_2026_09_16_r7_injury_pagination`, and compact snapshot `nfl_forward_member_snapshot_2026_09_16_r14_injury_pagination`.
- Week 2 contains 488 injury rows across five pages. The prior four-page cap rejected the complete response and made every game look injury-unavailable. The bounded ceiling is now eight pages and is shared by collection and budget telemetry. A current no-write replay restores all 16 games and 48 evaluations with zero held games at **1 Best Angle / 2 Leans / 11 Watchlists / 34 No Plays**, versus the four-page failure state's **1 / 1 / 8 / 38**. No equation, threshold, side, stake, lock, tracking rule, cron, writer, or lease changed.
- NFL Player Props advances with the same repair and shared week selector. Its current no-write replay covers all 16 games, 22,406 observations, 10,085 exact offers, and 443 feature rows with zero context health holds; the nonempty board is 11 Best Angles / 33 Leans / 161 Watchlists / 920 No Plays / 135 existing role-or-identity Held exceptions. A single incomplete game is now excluded with an exact health reason rather than aborting all complete games. Evidence and rollback: `docs/model-audits/2026-09-16-nfl-injury-pagination-player-props-recovery-predeclaration.md` and `docs/model-audits/2026-09-16-nfl-injury-pagination-player-props-recovery-result.md`.

### Weekly PMF boundary recovery and actionable-health paging (r14)

- Active member release: `nfl_v1_member_release_2026_09_16_r15_sharp_league_contract`; model / calibration / decision / grade policy: `nfl_v1_daily_edge_model_2026_09_16_r12_sharp_league_contract` / `nfl_v1_daily_edge_calibration_2026_09_16_r12_sharp_league_contract` / `nfl_v1_daily_edge_decision_2026_09_16_r18_sharp_league_contract` / `nfl_v1_grade_policy_2026_09_16_r18_sharp_league_contract`. Publication uses coherence `football_cross_market_coherence_2026_09_15_r10_nfl_one_point_mean_median`, sole writer `nfl_forward_evidence_writer_2026_09_16_r29_sharp_league_contract`, fixture `nfl_weekly_member_fixture_2026_09_16_r21_sharp_league_contract`, Sharp split adapter `nfl_sharpapi_splits_2026_09_16_r1_league_contract`, and compact snapshot `nfl_forward_member_snapshot_2026_09_16_r13_sharp_league_contract`, with r12 retained only as bounded startup continuity. The split adapter uses the provider's `league=nfl` contract in one bounded weekly request; strict date/team identity, two-hour freshness, and complete-percentage validation remain mandatory. A zero-row provider response remains neutral and cannot manufacture a play.
- The exact released PMF continues to own the decision side. NFL now permits that side to publish when the mean of the same discrete distribution crosses the exact line by no more than one point; a wider mean/PMF contradiction still fails closed. The due-cycle live-input replay repaired games `1392238` and `1392239`, moving 14 games / 42 predictions / 2 isolated games to the complete 16 / 48 / 0. All 42 matching rows have zero forecast, probability, side, quote, grade, or actionability changes; identical-row promotions and demotions are 0/0. The complete due board is 0 Best Angles / 1 Lean / 8 Watchlists / 39 No Plays. The immediate current-time board is 0 / 0 / 8 / 40 and is not quota-promoted.
- A zero-actionable slate remains publishable and complete, but its existing audit warning now marks the NFL health cron partial and supplies the error message so operations are paged. This never creates a play or converts No Play to Held. The sole `prediction_pipeline:nfl` lease, append-only writer, T-60 lock/tracking path, provider budgets, and zero stake are unchanged. Evidence and rollback: `docs/model-audits/2026-09-15-nfl-weekly-pmf-boundary-predeclaration.md` and `docs/model-audits/2026-09-15-nfl-weekly-pmf-boundary-result.md`.
- September 16 flat-board health repair: snapshot health now warns on a materially flat complete slate (at most one actionable grade and at least 75% No Plays), not only a zero-actionable slate. The live 16-game / 48-prediction cohort remains byte-for-byte unchanged at 0 Best Angles / 1 Lean / 8 Watchlists / 39 No Plays; there are zero promotions, demotions, side, probability, projection, price, stake, lock, tracking, provider, writer, lease, or member-presentation changes. Evidence: `docs/model-audits/2026-09-16-nfl-weekly-forecast-grade-presentation.md`.

### Prediction-owned moneyline side and append-only tracking correction (r13)

- Active member release: `nfl_v1_member_release_2026_09_14_r13_prediction_owned_side`; model / calibration / decision / grade policy: `nfl_v1_daily_edge_model_2026_09_14_r10_prediction_owned_side` / `nfl_v1_daily_edge_calibration_2026_09_14_r10_prediction_owned_side` / `nfl_v1_daily_edge_decision_2026_09_14_r16_prediction_owned_side` / `nfl_v1_grade_policy_2026_09_14_r16_prediction_owned_side`. The holistic outcome forecast owns the Moneyline side at every surface. Exact-price EV, target-excluded consensus edge, availability, and grade are evaluated only on that predicted winner; they may demote it to No Play but can never substitute the opposite team. Spread and Total selection are unchanged.
- Active outcome releases remain the September 3 target-excluded coherent forecast family, with resolver `nfl_target_excluded_market_outcome_2026_09_14_r2_prediction_owned_side`. Publication releases are member snapshot `nfl_forward_member_snapshot_2026_09_15_r11_opening_follow_up`, sole leased writer `nfl_forward_evidence_writer_2026_09_15_r27_opening_follow_up`, fixture `nfl_weekly_member_fixture_2026_09_15_r19_verified_first_observation`, week selector `nfl_forward_week_selection_2026_09_15_r1_tuesday_et_rollover`, and coherence gate `football_cross_market_coherence_2026_09_15_r9_nfl_half_point_mean_median`; lifecycle / bundle / boundary / record remain `nfl_tracking_lifecycle_2026_09_14_r10_prediction_owned_side` / `nfl_tracking_composite_release_bundle_2026_09_14_r6_prediction_owned_side` / `nfl_evaluated_tuple_tracking_boundary_2026_09_14_r7_prediction_owned_side` / `nfl_official_tracking_record_2026_09_14_r7_prediction_owned_side`. The opening follow-up preserves the first writer-verified quote for each exact evaluated sportsbook and requires a distinct second capture before movement health passes; it never borrows another book's opening. Same-input forecasts, probabilities, sides, prices, and grades are unchanged, and the Week 2 replay remains 0 Best Angles / 0 Leans / 8 Watchlists / 40 No Plays by evidence rather than quota. The existing `prediction_pipeline:nfl` lease and sole-writer architecture are preserved. Evidence: `docs/model-audits/2026-09-15-nfl-opening-follow-up-health.md`.
- The locked-record audit checksum-verified all 45 published Week 1 rows and found six Moneylines whose stored exact-price choice opposed the immutable published winner: SF@LAR, NO@DET, BAL@IND, ATL@PIT, CHI@CAR, and WSH@PHI. The append-only correction release `nfl_published_tracking_correction_2026_09_14_r1_prediction_owned_side` preserves each original and adds a superseding record produced by the same prediction-owned selector. Public and admin readers prefer the explicit correction. The six corrected exact-price tuples are all No Play; no price or result was reconstructed and no original row is updated or deleted.
- Outcome-blind board impact on the audited 15 Moneylines is 10→4 actionable, with six demotions and zero promotions; the 15-game prediction denominator is unchanged. That reduction is explicit and accepted because the six old actions were bets on teams the product did not predict to win. After result attachment, the prediction-side record is 10-5 instead of the erroneous selected-price-side 6-9; Sunday is 9-4 instead of 4-9. These figures diagnose tracking identity and are not used to choose the correction. A complete locked side-bearing forecast without a quote remains a non-Held No Play and is tracked, so price loss cannot erase a game from accuracy.
- Shared price-movement presentation now classifies movement by selected-side implied probability. For the same predicted side, -200→-250 is supportive and -250→-200 is adverse; +105→-105 is supportive. A stale writer label cannot override the visible same-side price trail. This changes no forecast, probability, grade, stake, lock, or tracking tuple.
- Runtime authority: `lib/services/football/nflV1ProductionDecision.ts`, `lib/services/football/nflPublishedTrackingCorrection.ts`, `lib/services/football/nflOfficialTrackingRecord.ts`, `lib/services/football/nflForwardEvidenceWriter.ts`, `lib/services/football/nflTrackingLifecycle.ts`, `lib/services/trackingAggregateService.ts`, `lib/services/tracking/winnerAccuracyScorecardQuery.ts`, and `app/lab/lib/lineMoveTone.ts`. Evidence: `docs/model-audits/2026-09-14-nfl-prediction-owned-side-tracking-correction.md`. Roll back the complete r13 publication/model family together; retain all original and corrective immutable tracking rows and revert reader precedence only after an explicit audit.

### Preceding target-excluded forecast and exact-price value separation (r12; inactive rollback provenance)

- Preceding member release: `nfl_v1_member_release_2026_09_03_r12_target_excluded_forecast`; model / calibration / decision / grade policy: `nfl_v1_daily_edge_model_2026_09_03_r9_target_excluded_forecast` / `nfl_v1_daily_edge_calibration_2026_09_03_r9_target_excluded_forecast` / `nfl_v1_daily_edge_decision_2026_09_03_r15_target_excluded_forecast` / `nfl_v1_grade_policy_2026_09_03_r15_target_excluded_forecast`. The evaluated Moneyline and Spread operator families are excluded from the margin anchor and the evaluated Total family is excluded from the Total anchor before the existing 75% market / 25% football synthesis. Each axis requires at least three distinct complete families observed within 120 minutes, and the exact target set must reach a stable fixed point. A target-family Circa record is excluded; line-matched public evidence remains lower authority; missing/stale evidence is neutral. Current capture has fewer than two independent same-book trails per market, so movement is neutral on qualified target-excluded rows rather than being inferred. An insufficient or cycling row truthfully stamps `incumbent_fallback` and preserves the preceding coherent forecast and decision tuple.
- Moneyline prediction and exact-price value selection are distinct but coherent. A final win probability above 50% owns the predicted winner and expected-score direction before its exact price is graded. A positive-price underdog below 50% may oppose that prediction only when its own tuple has at least two target-excluded comparators, at least 2% EV, and at least 2pp consensus edge; weakening the favorite to No Play cannot manufacture an opposite-side pick. Best Angle still requires at least 2% EV and 4pp edge. The evaluated side carries its own PMF probability, named sportsbook price, consensus fair probability, EV, edge, and grade, while the prediction remains attached to the forecast winner.
- Active outcome set: weekly model / distribution / probability `nfl_v1_weekly_market_anchored_outcome_2026_09_03_r3_target_excluded_forecast` / `nfl_pooled_discrete_residual_distribution_2026_09_03_r3_target_excluded_forecast` / `nfl_v1_weekly_pooled_discrete_probability_2026_09_03_r3_target_excluded_forecast`; market-evidence outcome / representative score `nfl_v1_market_evidence_outcome_2026_09_16_r4_sharp_league_contract` / `nfl_v1_market_evidence_representative_score_2026_09_03_r2_target_excluded_forecast`; Spread / Total heads `nfl_v1_spread_event_contained_2026_09_03_r5_target_excluded_forecast` / `nfl_v1_total_market_evidence_2026_09_03_r4_target_excluded_forecast`; target-exclusion resolver `nfl_target_excluded_market_outcome_2026_09_03_r1`. The Week 1 game-specific residual-head corrections remain frozen to their verified 16-game artifact and are not copied to later weeks; later weeks use the qualified generalized weekly fallback until a deployable walk-forward core clears the model-change gates.
- Active publication set: evidence / collector remain `nfl_forward_evidence_snapshot_2026_09_01_r6_forecast_value_separation` / `nfl_forward_evidence_collector_2026_09_01_r6_forecast_value_separation`; member snapshot `nfl_forward_member_snapshot_2026_09_13_r9_bounded_continuity_read`; sole leased writer `nfl_forward_evidence_writer_2026_09_13_r24_bounded_current_release_read`; member fixture `nfl_weekly_member_fixture_2026_09_04_r17_split_history_window`; tracking lifecycle / bundle / tuple boundary / record `nfl_tracking_lifecycle_2026_09_03_r9_target_excluded_forecast` / `nfl_tracking_composite_release_bundle_2026_09_03_r5_target_excluded_forecast` / `nfl_evaluated_tuple_tracking_boundary_2026_09_03_r6_target_excluded_forecast` / `nfl_official_tracking_record_2026_09_04_r6_complete_prediction_denominators`. The weekly slate, quarterback substitution and injury-unavailable behavior, one `prediction_pipeline:nfl` lease, append-only writer, immutable T-60 precedence, settlement, member reader, UI, copy, and zero-stake policy are unchanged.
- Exact-runtime replay of the latest 16-game/48-market r6 wave: 13 games reach a stable target-excluded tuple and three retain the incumbent. Predicted-winner changes are zero. Actionables remain 20→20 with one promotion and one demotion; grades move **12 Best Angles / 8 Leans / 9 Watchlists / 19 No Plays** to **9 / 11 / 9 / 19**. Four exact market tuples change: one non-actionable Total direction and three same-direction line/book reselections. Maximum probability movement is 1.3932pp and maximum expected team-score movement is 0.4882 points. NE@SEA retains the SEA winner, SEA Spread Lean, Over No Play, and its exact-price separation. The current release has zero settled locked Week 1 Moneylines, so this is a structural/coherence result, not an accuracy or profitability claim.
- Runtime authority: `lib/services/football/nflTargetExcludedMarketOutcome.ts`, `lib/services/football/nflV1WeekOneOutcome.ts`, `lib/services/football/nflV1ProductionDecision.ts`, `lib/services/football/nflV1ActionableGradeCandidate.ts`, `lib/services/football/nflForwardEvidenceWriter.ts`, `lib/services/football/nflForwardMemberSnapshotStore.ts`, `lib/services/football/nflWeekOneHeldMemberFixture.ts`, `lib/services/football/nflTrackingLifecycle.ts`, and `lib/services/football/nflOfficialTrackingRecord.ts`. Evidence: `docs/model-audits/2026-09-03-nfl-cross-market-winner-arbitration-r1-predeclaration.md` and `docs/model-audits/2026-09-03-nfl-target-excluded-forecast-result.md`. Roll back the complete release family to the September 1 r11/r8/r14/r20/r15/r8/r4 set without reinterpreting or replacing an existing locked payload.

- Active member release: `nfl_v1_member_release_2026_08_31_r9_market_split_injury`; model / calibration / decision / grade policy: `nfl_v1_daily_edge_model_2026_08_31_r6_market_split_injury` / `nfl_v1_daily_edge_calibration_2026_08_31_r6_market_split_residual` / `nfl_v1_daily_edge_decision_2026_08_31_r12_market_split_injury` / `nfl_v1_grade_policy_2026_08_31_r12_market_split_injury`.
- Published Spread / Total market heads are `nfl_v1_spread_event_contained_2026_08_31_r3_market_split` / `nfl_v1_total_market_evidence_2026_08_31_r2_circa_public_bounded`; their frozen correction artifacts remain internal provenance and are never stamped as the new public forecast release.
- Outcome artifact / model / distribution / probability / representative-score releases remain exact for the frozen 16-game Week 1 set: `nfl_v1_week_one_outcome_artifact_2026_08_23_r2_discrete_joint` / `nfl_v1_discrete_drive_outcome_2026_08_23_r2` / `nfl_discrete_drive_score_distribution_2026_08_23_r5` / `nfl_v1_discrete_joint_probability_2026_08_23_r2` / `nfl_v1_representative_score_2026_08_23_r2`. The authoritative market-evidence outcome release is `nfl_v1_market_evidence_outcome_2026_08_31_r1_circa_public_bounded`: the current Spread/Total anchor owns 75% and the football projection owns 25%; strictly fresh Circa money-minus-bets evidence may move either anchor at most 1.5 points, while line-matched fresh public evidence may move it at most 0.75 points and cannot reverse Circa. Missing splits produce zero adjustment, never a Hold. Later weeks use `nfl_v1_weekly_market_anchored_outcome_2026_08_31_r1` / `nfl_pooled_discrete_residual_distribution_2026_08_31_r1` / `nfl_v1_weekly_pooled_discrete_probability_2026_08_31_r1`; pooled centered Week 1 residual shapes supply distribution shape only. The adjusted PMF is rebuilt before winner/side selection, so coherent evidence may reverse a prediction before exact-price EV and grade are computed. One malformed or previously unseen game ID cannot abort healthy siblings. Prediction surfaces never inherit an exact-price selection, grade, or sportsbook-availability state.
- Predictive confirmation: the football-only outcome package beat its frozen football baseline in both untouched confirmation seasons. Win probability was 0.21209 Brier / 0.61431 log loss / 7.61% ECE in 2024 and 0.22119 / 0.63212 / 3.03% in 2025. The r10 reachable-score functional retained 100% PMF support and winner fidelity with zero tie contradictions; team-score MAE was 7.28125 in 2024 and 7.37868 in 2025. The opening market remained better (0.20231 / 0.21288 Brier), so OddSphere does not misrepresent the independent head as market-superior. Exact-price grade qualification and immutable 2026 forward tracking remain separate evidence.
- Exact-price contract: every Bet grade carries one coherent model probability, evaluated named sportsbook/line/price, target-excluded same-line consensus fair probability, timestamp, and release tuple. Unlocked material price/personnel changes are recomputed by the writer. A valid T-60 capture freezes that tuple; later prices are context-only. Outcome confidence remains distinct from Bet grade.
- Grade policy: Moneyline Best Angle requires an already-qualified direction-coherent r6 Lean plus at least 2% EV and 4pp target-excluded consensus edge. Spread Lean requires corrected probability >=51%, nonnegative EV/edge, and nonnegative expected-score cushion after key-number sensitivity. Total Lean requires probability >=53.5%, EV >=2%, edge >=1pp, and at least one point of cushion after total-zone sensitivity. Frozen lower monitoring thresholds create Watchlist; all other complete tuples are No Play. Event containment cannot improve a pre-correction grade, and a correction-caused side flip is capped at No Play. Bet count is an output with no quota. An expected QB listed Out/Doubtful selects the next healthy depth-chart QB and uses that QB's historical state; a provider starter change recomputes the game. If no replacement or injury report is available, the projection remains live with explicit uncertainty. Identity, quote, market-completeness or late-lock failures may withhold only the incomplete exact-price Bet tuple as member-facing No Play; they do not erase the outcome projection. No stake sizing is authorized.
- Confirmation evidence: Moneyline Best Angle was +3.887u / +10.50% ROI in 2024 and +2.396u / +3.63% in 2025, positive after each season's largest win; pooled mean CLV +0.236pp. Spread Lean was +3.626u / +30.22% in 2024 and +5.146u / +18.38% in 2025, positive after each largest win; the lane is capped at Lean because 37/40 confirmation actions selected home. Total Lean was +0.160u / +0.69% in 2024 and +1.418u / +1.97% in 2025; pooled +1.578u / +1.66%, but the 2024 largest-win-independent result was negative and bootstrap uncertainty is wide, so it is capped at Lean and must remain forward-monitored. 2024/25 are repeated confirmation; immutable 2026 captures are the true forward holdout.
- Current authoritative replay: the latest stored 16-game/48-market wave captured 2026-08-31T14:51:09.472Z moves **3 Best Angles / 11 Leans / 5 Watchlists / 26 No Plays / 3 incomplete internal Holds** to **3 / 12 / 6 / 27 / 0**. Actionable markets move 14→15 with 11 promotions, five demotions, 17 side changes, 32 probability changes, and all 48 prediction markets present. Moneyline becomes 3 / 6 / 1 / 6; Spread 0 / 5 / 5 / 6; Total 0 / 1 / 0 / 15. The replay is balanced rather than quota-calibrated: market evidence can promote, demote, or reverse a side upstream, while fragmented one-comparator cohorts cannot become actionable. Every game passes score/winner identity and cross-market coherence.
- Writer/releases: evidence schema / collector remain `nfl_forward_evidence_snapshot_2026_08_31_r4_weekly_market_injury` / `nfl_forward_evidence_collector_2026_08_31_r4_weekly_market_injury`; the single authoritative leased writer is `nfl_forward_evidence_writer_2026_09_01_r18_serialized_history_reads`, and the compact member snapshot is `nfl_forward_member_snapshot_2026_08_31_r4_cross_release_odds_history`. The store reads r4/r3/r2/r1 with bounded 1,000-row pagination and a 5,000-row per-release cap. R18 serializes those four release reads: retained r3 history is 3,360 large immutable payloads, and launching all four paginated reads concurrently intermittently caused Postgres statement timeouts. The repair retains every historical odds observation while removing the writer's self-induced query contention. The NFL health route now audits this same compact snapshot consumed by the live member reader, with the established six-hour far-window and hourly inside-48h cadence, instead of checking the retired manual preseason publication key and reporting a false unavailable alarm. The member fixture `nfl_weekly_member_fixture_2026_08_31_r13_cross_release_odds_history` still selects predictions and exact-price decisions only from current r4, while reconstructing each same-book movement trail from all compatible immutable r4/r3/r2/r1 observations. It changes no forecast, side, probability, grade, stake, lock, provider call, or tracking tuple. Writer r18 contains a malformed game at game scope, preserves one `prediction_pipeline:nfl` lease, one append path and immutable T-60 priority, and retains strict named-book split provenance. A fragmented exact-line board may use one target-excluded same-line comparator to keep a complete conservative prediction tuple, but it cannot receive an actionable grade unless at least two target-excluded same-line comparators exist.
- Official tracking: `nfl_tracking_lifecycle_2026_08_31_r6_market_split_heads` with bundle `nfl_tracking_composite_release_bundle_2026_08_31_r2` validates the approved Moneyline, Spread and Total model/calibration head separately, then inserts the same immutable market-scoped T-60 `prediction_records`. One unavailable sibling cannot block a coherent market. The official ET boundary, exact-game score ingest, settlement and no-backfill rules are unchanged.
- Reader/rollback: member fixture `nfl_weekly_member_fixture_2026_08_31_r13_cross_release_odds_history` consumes the release-keyed weekly evidence, preserves the stored opening price during an exact-price health exception, shows writer-owned cross-release movement and real availability/health reasons instead of release identifiers, and keeps the existing grade/copy product. Roll back fixture/snapshot/writer to r12/r3/r16 without changing the evidence rows. `NFL_WEEK_ONE_EVIDENCE_BOARD_ENABLED=true` selects the evidence board; `NFL_DAILY_EDGE_ENABLED` remains the visibility rollback.
- Reader-axis patch retained by shared presentation release `daily_edge_member_presentation_2026_08_28_r14_fi_same_book_pulse` keeps the prediction tab label and probability attached to `marketPrediction`, while the Quick Read exact-price panel keeps the evaluated side, book, price, selected-side probability, and Bet Grade attached to `pick`. Moneyline prediction copy says the exact-price grade is separate rather than incorrectly implying that a visible sportsbook quote is missing. MLB/NFL/CFB retain exactly one Public Consensus card and one Sharp Book Splits card; a current Circa row wins, otherwise a complete named-book fill-in occupies that same card until Circa is current again. Typed payload provenance retains the actual source internally. MLB first-inning Market Pulse now derives its direction from the exact same named-book NRFI/YRFI board rendered beneath it; a different evaluated-book price trail can no longer label the visible FI board. This changes zero model outputs, exact tuples, grades, stakes, locks, or tracking rows.
- Runtime authority: `lib/services/football/nflV1WeekOneOutcome.ts`, `lib/services/football/nflV1ActionableGradeCandidate.ts`, `lib/services/football/footballCrossMarketCoherence.ts`, `lib/services/football/nflForwardEvidenceWriter.ts`, `lib/services/football/nflForwardMemberSnapshotStore.ts`, `lib/services/football/nflOfficialTrackingRecord.ts`, `lib/services/football/nflWeekOneHeldMemberFixture.ts`, and `lib/services/football/nflScoreIngestService.ts`.
- Evidence: `docs/model-audits/2026-08-28-football-cross-market-coherence-predeclaration.md`, `docs/model-audits/2026-08-28-football-cross-market-coherence-r19.md`, `docs/model-audits/2026-08-26-football-market-scoped-t60-predeclaration.md`, `docs/model-audits/2026-08-25-nfl-odds-history-reader-repair.md`, `docs/model-audits/2026-08-25-nfl-public-release-transition.md`, `docs/model-audits/2026-08-25-nfl-actionable-grades-production-r9.md`, `docs/model-audits/2026-08-25-nfl-actionable-grades-r9.md`, `docs/model-audits/2026-08-25-nfl-projected-qb-context-r11.md`, `docs/model-audits/2026-08-23-nfl-discrete-drive-joint-r10.md`, and `docs/model-audits/2026-08-23-nfl-v1-comprehensive-outcome.md`.

## CFB Daily Edge generalized weekly production release

- October 9 provider-continuity and started-game retention correction: evidence schema, availability authority, calibration, grade, decision, tuple, tracking, professional score, and market-reader releases remain the October 9 joint-reconciliation family. Collector / member are `cfb_forward_evidence_collector_2026_10_09_r56_provider_continuity_board_retention` / `cfb_v1_member_release_2026_10_09_r59_provider_continuity_board_retention`.
- Playbook injury requests translate Oddsphere's internal `ncaaf` identity to the provider's documented uppercase `CFB` identity and normalize both the current `teams[].injuries[]` contract and the legacy `data[].players[]` contract. The newest verified per-game report survives a failed, omitted, empty, or older refresh. Newly normalized documented-contract rows are report-only in this release and cannot change projections or grades until their live payload and exact board impact are validated; existing qualified legacy rows retain their prior exact-quarterback authority. The independent score, joint PMF, market-reader artifact, market-reading rules, provider request count, cadence, one writer, and `prediction_pipeline:cfb` lease are unchanged.
- Sole writer / fixture / outcome / compact snapshot / reader are `cfb_forward_evidence_writer_2026_10_09_r113_provider_continuity_board_retention` / `cfb_v1_member_fixture_2026_10_09_r85_provider_continuity_board_retention` / `cfb_market_sharp_public_outcome_contract_2026_10_09_r75_provider_continuity_board_retention` / `cfb_forward_member_snapshot_2026_10_09_r45_provider_continuity_board_retention` / `cfb_member_snapshot_reader_2026_10_09_r30_provider_continuity_board_retention`; tracking remains `cfb_official_tracking_record_2026_10_09_r44_joint_moneyline_spread_reconciliation`. The r58/r44 provider-continuity family is the immediate immutable-lock predecessor, the r57/r43 joint-reconciliation family remains readable behind it, and the prior r39 snapshot remains readable behind both. Production proved the first repair's release, lease, snapshot, and lock continuity while exposing the `NCAAF` request failure and post-kickoff release-wave contractions that removed locked FAMU-ALST and FSU-LOU. R59 corrects the provider identity and carries exact immutable locked games through the shared 03:00 ET Daily Edge rollover. Evidence, gates, and rollback: `docs/model-audits/2026-10-09-football-provider-feed-continuity-predeclaration.md`, `docs/model-audits/2026-10-09-football-provider-feed-continuity-result.md`, `docs/model-audits/2026-10-09-playbook-cfb-league-identity-live-correction.md`, and `docs/model-audits/2026-10-09-cfb-started-game-board-retention.md`.

- October 9 CFB professional joint Moneyline/Spread market-reconciliation release:
  `cfb_forward_evidence_snapshot_2026_10_09_r43_joint_moneyline_spread_reconciliation` /
  `cfb_forward_evidence_collector_2026_10_09_r54_joint_moneyline_spread_reconciliation` /
  `cfb_v1_member_release_2026_10_09_r57_joint_moneyline_spread_reconciliation` /
  `cfb_market_sharp_aware_production_2026_10_09_r35_joint_moneyline_spread_reconciliation` /
  `cfb_v1_daily_edge_decision_2026_10_09_r47_joint_moneyline_spread_reconciliation` /
  `cfb_forward_evidence_writer_2026_10_09_r111_joint_moneyline_spread_reconciliation`.
  Fixture / outcome / compact snapshot / reader / tracking are
  `cfb_v1_member_fixture_2026_10_09_r83_joint_moneyline_spread_reconciliation` /
  `cfb_market_sharp_public_outcome_contract_2026_10_09_r73_joint_moneyline_spread_reconciliation` /
  `cfb_forward_member_snapshot_2026_10_09_r43_joint_moneyline_spread_reconciliation` /
  `cfb_member_snapshot_reader_2026_10_09_r28_joint_moneyline_spread_reconciliation` /
  `cfb_official_tracking_record_2026_10_09_r44_joint_moneyline_spread_reconciliation`.
  The frozen artifact is `cfb_market_reader_artifact_2026_10_09_r4_joint_moneyline_spread_reconciliation`,
  trained through October 8 on 301 target-excluded pregame records. It removes 8pp/10pp split cliffs,
  keeps money percentage, ticket percentage, their difference and change separate, reconciles the
  legacy market shift against the independent projection, explicitly models Moneyline/Spread split and
  price-movement agreement or resistance, and preserves one coherent PMF. Total-side
  flips keep their chronologically validated full-conviction projection inside observed support; beyond
  that range, reflection authority decays continuously toward the fitted posterior with its edge bounded
  by the observed support. This contains extrapolation without blocking a flip or imposing an evidence
  cutoff. Missing split feeds remain neutral. The 218-game chronological replay remains 168–50
  Moneyline, 73–57–3 Spread and 82–57 Total; the joint reader preserves every directional intervention
  while reducing margin MAE from 12.3108 to 12.2948. Historical locked payloads retain exact reader precedence. Evidence
  and limitations: `docs/model-audits/2026-10-09-cfb-professional-market-reconciliation-result.md`.

### Independent-price market completion and bounded Spread Lean lane (writer r107; fixture r79; snapshot r39; tracking r40)

- Active evidence / collector / member / market reader / decision / sole writer are
  `cfb_forward_evidence_snapshot_2026_10_08_r39_independent_price_spread_lane` /
  `cfb_forward_evidence_collector_2026_10_08_r50_independent_price_spread_lane` /
  `cfb_v1_member_release_2026_10_08_r53_independent_price_spread_lane` /
  `cfb_market_sharp_aware_production_2026_10_08_r31_independent_price_spread_lane` /
  `cfb_v1_daily_edge_decision_2026_10_08_r43_independent_price_spread_lane` /
  `cfb_forward_evidence_writer_2026_10_09_r108_odds_history_continuity`.
  Grade/calibration / fixture / outcome / compact snapshot / reader / tracking are r21/r18 / r79 /
  r69 / r39 / r24 / r40. R38 remains the explicit reader transition authority for valid prior rows
  and immutable locks.
- Missing public or sharp splits are neutral evidence, never a global health hold. When the canonical
  complete-game anchor is unavailable but an individual market still has a verified target quote and
  target-excluded same-line named-book consensus, the independent PMF remains prediction authority and
  that market now publishes its real side, price and ordinary grade. Missing exact-price evidence remains
  Held; negative economics may remain No Play. No side, probability, score, PMF, stake, copy, label or
  layout is fabricated or changed by this completion path.
- Anchorless Best Angles and Moneyline/Total actionability are not authorized. An anchorless actionable
  candidate is capped at Watchlist except for a Spread already graded Lean by the existing exact-price
  and sport-specific market-evidence policy with model probability at least 58%. That lane is capped at
  Lean and cannot become Best Angle. It does not require splits and does not treat their absence as either
  support or resistance.
- Chronological FCS reconstruction selected the lane on September 19–27 at 25-9 (+14.31u) and retained it
  on untouched October 3–4 confirmation at 10-7 (+2.10u), for 35-16 (+16.41u) combined. The rejected broad
  unlock went 20-24 (-7.48u) on confirmation; confirmation Best Angles were 6-13, so the broad rule and
  anchorless Best Angle path remain disabled. Moneyline lacked the predeclared minimum selection sample,
  while Total Lean candidates were 3-5 in selection.
- The paired exact 86-game current-board replay moves 163 evaluated / 95 Held markets to 242 / 16. Counts
  move from 15 Best Angles / 79 Leans / 55 Watchlists / 14 No Plays to 14 / 96 / 115 / 17. Seventy-nine
  Held slots gain exact decisions; 18 formerly Held Spreads become Leans, while the bounded caps leave net
  actionability +16. Reconstructed forecast means are byte-equivalent, no negative score is created, and
  all writes remained disabled during acceptance.
- The paid FCS fallback still makes one three-credit sport-level request, now asking for ten supported
  books. FanDuel, DraftKings and Rebet retain execution and market-reading eligibility. BetMGM, BetRivers,
  Caesars, Fanatics, theScore Bet, BetOnline and Bally Bet are target-excluded consensus only: they cannot
  become the evaluated quote, score/side anchor, opening authority or movement signal. The provider,
  cadence, weekly limits and 5,000-credit reserve are unchanged. Identical ordered market-history reads
  are partitioned into 10-game batches after a live 25-game batch still intermittently exceeded the
  database statement timeout. Current-price and historical-opening request counters are now separate,
  so a transition-only historical lookup cannot postpone an hourly live-price refresh. Historical
  recovery also stops once any verified operational opening exists, or after its one recorded attempt.
- The existing `prediction_pipeline:cfb` lease, one writer, hourly/T-60 cadence, immutable lock boundary,
  settlement and tracking denominator remain authoritative. Evidence and rollback are in
  `docs/model-audits/2026-10-08-cfb-multi-book-gap-fill-predeclaration.md`. Roll back the complete
  r39/r53/r31/r43/r107/r79/r69/r39/r24/r40 family to r38 without rewriting any lock or result.

### Paid FCS named-book odds-gap fallback (writer r106; fixture r78; snapshot r38; tracking r39)

- Active evidence / collector / member / market reader / decision / sole writer are
  `cfb_forward_evidence_snapshot_2026_10_08_r38_the_odds_api_fcs_gap_fallback` /
  `cfb_forward_evidence_collector_2026_10_08_r49_the_odds_api_fcs_gap_fallback` /
  `cfb_v1_member_release_2026_10_08_r52_the_odds_api_fcs_gap_fallback` /
  `cfb_market_sharp_aware_production_2026_10_08_r30_the_odds_api_fcs_gap_fallback` /
  `cfb_v1_daily_edge_decision_2026_10_08_r42_the_odds_api_fcs_gap_fallback` /
  `cfb_forward_evidence_writer_2026_10_08_r106_immediate_the_odds_api_seed`.
  Member fixture / outcome / compact snapshot / reader / tracking are r78 / r68 / r38 / r23 / r39.
  R37 and r36 remain explicit transition authorities for valid immutable locks and recovery.
- Current quote authority remains BALLDONTLIE, then bounded exact-event SharpAPI named books, then
  CFBD, then the paid The Odds API FCS feed. The last tier fills an absent FanDuel, DraftKings or
  Rebet book only; it cannot replace the same book from a higher tier. Strict away/home orientation,
  exact canonical team identity, kickoff proximity, complete two-sided pairs, market timestamps and
  pregame chronology are mandatory.
- The October 9–11 transition slate may perform two bounded historical-snapshot calls to recover the
  earliest retained same-book context. That quote is stored as first-observed context, never falsely
  labeled a provider opening. Future slates use the real primary-provider opening where available and
  otherwise retain the earliest verified observation. Current pulls are one sport-level request, at
  most hourly while an upcoming FCS price gap exists, forced once at T-60 when due, capped at 176
  ordinary and 192 total weekly pulls, and protected by a 5,000-credit reserve.
- Writer r106 closes the deployment-transition seed gap: when an unlocked FCS price gap has no
  recorded paid-provider attempt or verified paid-provider book, the existing leased writer runs
  one immediate FCS-only seed instead of waiting for the ordinary hourly game-capture boundary. A
  success or failure is recorded in the existing request budget, so the trigger cannot repeat;
  subsequent updates remain hourly and T-60 under the same ceilings. It adds no writer or timer.
- The exact October 8 zero-write replay moves paired Moneyline / Spread / Total coverage from
  59 / 58 / 57 of 88 games to 85 / 84 / 84 of 86 upcoming games. FCS-only coverage moves from
  2 / 1 / 0 of 31 to 30 / 29 / 29; Montana–Northern Arizona remains unavailable rather than
  fabricated. Actionables remain 91 with zero promotions and zero demotions because existing
  target-excluded comparison requirements continue to control exact-price actionability.
- Independent score equations, market arbitration, probability and grade thresholds, stakes, copy,
  labels, layout, the sole `prediction_pipeline:cfb` lease, immutable T-60 definitions and tracking
  denominators are unchanged. Valid older locks and tracking results remain authoritative; only
  unlocked/current and future games advance to r38.
- Evidence and rollback:
  `docs/model-audits/2026-10-08-cfb-the-odds-api-fcs-gap-fallback-r38.md`. Roll back the complete
  r38/r52/r106/r78/r68/r38/r23/r39 family to r37 without rewriting a lock or tracking result.
  The immediate-seed scheduling amendment is documented in
  `docs/model-audits/2026-10-08-cfb-immediate-paid-provider-seed-r106-predeclaration.md`.

### Release-wave completeness over retained terminal games (writer r104; fixture r77; snapshot r37; tracking r38)

- Active evidence / collector / member / market reader / decision / sole writer are
  `cfb_forward_evidence_snapshot_2026_10_07_r37_release_wave_completeness` /
  `cfb_forward_evidence_collector_2026_10_07_r48_release_wave_completeness` /
  `cfb_v1_member_release_2026_10_07_r51_release_wave_completeness` /
  `cfb_market_sharp_aware_production_2026_10_07_r29_fcs_price_public_injury_continuity` /
  `cfb_v1_daily_edge_decision_2026_10_07_r41_fcs_price_public_injury_continuity` /
  `cfb_forward_evidence_writer_2026_10_07_r104_release_wave_completeness`.
  Member fixture / outcome / compact snapshot / reader / tracking are r77 / r67 / r37 / r22 / r38.
  The immediately preceding r36 / r50 / r29 / r41 / r76 / r36 family remains the explicit
  transition authority and movement-history source.
- A new evidence release now defines its expected slate from the unique games that actually have a
  capture plan. Lifecycle-only games retained for tracking after they become final do not inflate a
  new release's completeness denominator. Later partial refreshes retain all games already present
  in that release and add a newly scheduled game once. A genuine capture failure therefore still
  leaves the release incomplete and fail-closed.
- This repairs the October 7 handoff in which the completed USM-Troy game remained in the writer's
  lifecycle set but correctly had no new prediction capture. The r36 writer produced 88 valid rows
  with an expected count of 89, so the compact reader retained the older r35 board even though the
  new paid Sharp/CFBD context was stored. R37 expects the 88-game active capture wave and publishes
  those same model/market decisions. Forecast equations, probabilities, sides, prices, grades,
  stakes, schedules, locks, tracking definitions, provider budgets, copy, labels and layout are
  unchanged.
- Same-book opening/prior/current history remains release-spanning and source-preserving. The paid
  exchange context remains visible but target-excluded, and representative-price selection retains
  its paired-quote, source-priority and isolated-outlier protections. Existing immutable T-60 rows
  and official tracking remain untouched.
- Evidence and rollback:
  `docs/model-audits/2026-10-07-cfb-release-wave-completeness-r37.md`. Roll back the complete
  r37/r51/r104/r77/r67/r37/r22 publication family to r36 while preserving immutable locks.

### Prior FCS price hierarchy and official-report continuity (writer r103; fixture r76; snapshot r36; tracking r38)

- Active evidence / collector / member / market reader / decision / sole writer are
  `cfb_forward_evidence_snapshot_2026_10_07_r36_fcs_price_public_injury_continuity` /
  `cfb_forward_evidence_collector_2026_10_07_r47_fcs_price_public_injury_continuity` /
  `cfb_v1_member_release_2026_10_07_r50_fcs_price_public_injury_continuity` /
  `cfb_market_sharp_aware_production_2026_10_07_r29_fcs_price_public_injury_continuity` /
  `cfb_v1_daily_edge_decision_2026_10_07_r41_fcs_price_public_injury_continuity` /
  `cfb_forward_evidence_writer_2026_10_07_r103_paid_sharp_cfbd_price_hierarchy`.
  Member fixture / outcome / compact snapshot / reader / tracking are r76 / r66 / r36 / r21 / r38.
  The immediately preceding r35 / r49 / r28 / r40 / r75 / r35 family remains the explicit
  transition authority for already-captured and immutable T-60 rows.
- Current quote authority is ordered and source-preserving: paid BALLDONTLIE books, bounded exact-
  event SharpAPI named books, then CFBD named DraftKings/Bovada rows. A lower source fills absence
  but never replaces the same named book from a higher source in the same capture. Stored same-book
  evidence survives temporary omission, and a later higher-priority quote silently resumes
  authority. No anonymous line or synthetic price is accepted.
- SharpAPI's exact-event Novig and SX Bet pairs may supply display/line context only. They remain
  excluded from sportsbook consensus, canonical market anchors, exact-price grading, actionability,
  movement arbitration and opening-price authority. Kalshi remains excluded because provider rows
  have exhibited inverted team sides; Polymarket remains excluded because question-shaped identity
  is not equivalent to a conventional game market.
- CFBD makes one exact season/week request at most every six hours for FCS-only gaps. Its free-tier
  request ceiling is therefore at most 124 calls in a 31-day month. It supplies real Moneyline prices
  and provider-reported current/open Spread and Total lines, but never fabricates the missing Spread
  or Total prices. The production `CFBD_API_KEY` is a sensitive server environment value.
- The exact October 7 zero-write replay retained complete paired sportsbook pricing for all 57
  FBS-involved games. For 31 FCS-only games, paired sportsbook coverage remains honestly 2 / 1 / 0
  Moneyline / Spread / Total, while paid Sharp exchange context increases line-specific prediction
  coverage from 31 / 1 / 0 to 31 / 14 / 29. The two remaining Total and 17 remaining Spread gaps
  have no acceptable provider line; none is fabricated. FCS exact-price decisions remain 0
  evaluated / 93 held: 0 promotions, 0 demotions, and no hidden board flattening.
- Official SEC, ACC, Big Ten, and Big 12 reports now populate the existing injury panel only after
  exact date/team matching, behind Playbook, with last-verified continuity. They are display evidence
  in this release and cannot alter a projection or grade; blanket report-driven demotion is not
  authorized without a release-pure paired-promotion validation. No copy, label, layout, writer,
  lease, lock, settlement, or tracking-definition change is included.
- Evidence and rollback:
  `docs/model-audits/2026-10-07-cfb-fcs-price-public-injury-continuity-result.md`. Roll back the
  complete r36/r50/r29/r41/r103/r76/r66/r36/r21/r38 family together while preserving immutable locks.

### FBS current-price and quarterback-context continuity (writer r100; fixture r75; snapshot r35; tracking r37)

- Active evidence / collector / member / market reader / decision / sole writer are
  `cfb_forward_evidence_snapshot_2026_10_07_r35_price_qb_continuity` /
  `cfb_forward_evidence_collector_2026_10_07_r46_price_qb_continuity` /
  `cfb_v1_member_release_2026_10_07_r49_price_qb_continuity` /
  `cfb_market_sharp_aware_production_2026_10_07_r28_price_qb_continuity` /
  `cfb_v1_daily_edge_decision_2026_10_07_r40_price_qb_continuity` /
  `cfb_forward_evidence_writer_2026_10_07_r100_price_qb_continuity`. Member fixture / outcome /
  compact snapshot / reader / tracking are r75 / r65 / r35 / r20 / r37. The immediately preceding
  r34 / r48 / r27 / r39 / r74 / r34 family remains the explicit transition authority for already
  captured and immutable T-60 rows.
- For an FBS-involved game whose paid BALLDONTLIE board is incomplete, the existing writer may make
  one bounded ESPN scoreboard request per slate date and accept only a strict team-and-kickoff match
  with a coherent paired current DraftKings Moneyline, Spread, or Total. Paid and retained named-book
  evidence retains precedence; an incomplete or malformed fallback market remains unavailable. The
  fallback is limited to 32 games and seven dates per run and adds no writer, schedule, database loop,
  copy, label, layout, or inferred price.
- The October 7 production acceptance case is ODU at Appalachian State. The current board was missing
  exactly its three FBS-involved prices while ESPN/DraftKings published all three paired markets. The
  zero-write candidate restores Moneyline `+295 / -375`, Spread `ODU +9.5 -105 / APP -9.5 -115`, and
  the currently published paired Total. Because one book cannot satisfy target-excluded consensus,
  all three markets remain held from exact-price grading: zero actionable promotions, zero actionable
  demotions, and zero board flattening. The other 90 missing prices are 30-31 FCS-only market rows not
  currently published by BALLDONTLIE or ESPN and remain honestly unavailable rather than fabricated.
- Active-quarterback roster context now refreshes at least every 24 hours and at T-60 within the
  existing 24-team bound. An empty refresh cannot erase the last nonempty verified roster. Playbook's
  NCAAF injury endpoint still returns no usable report; this release does not relabel active-roster or
  ESPN leader status as an injury designation. A complete timestamped injury feed still requires a
  configured provider that actually publishes NCAAF availability.
- Evidence and rollback:
  `docs/model-audits/2026-10-07-cfb-price-qb-continuity-predeclaration.md`. Roll back the complete
  r35/r49/r28/r40/r100/r75/r65/r35/r20/r37 family together while preserving immutable locks.

### Held-price T-60 accuracy lock (writer r99; fixture r74; snapshot r34; tracking r36)

- Active sole writer / member fixture / compact snapshot / reader / tracking releases are
  `cfb_forward_evidence_writer_2026_10_06_r99_held_t60_accuracy_lock` /
  `cfb_v1_member_fixture_2026_10_06_r74_held_t60_accuracy_lock` /
  `cfb_forward_member_snapshot_2026_10_06_r34_held_t60_accuracy_lock` /
  `cfb_member_snapshot_reader_2026_10_06_r19_held_t60_accuracy_lock` /
  `cfb_official_tracking_record_2026_10_06_r36_held_t60_accuracy_lock`.
- A complete, on-time T-60 forecast with all three exact-price decisions held solely because a
  permitted target quote is unavailable now freezes at T-60. It produces the same three
  accuracy-only No Play rows already supported by the recovery path; it never reconstructs
  price, edge, EV, grade, actionability, or stake. Any model-input health hold remains ineligible.
- Southern Miss at Troy supplied the production acceptance case: its complete T-60 forecast was
  captured at `2026-10-06T23:10:04.623Z`; all three accuracy rows were recovered idempotently at
  kickoff with that immutable timestamp. Same-input board impact is zero forecast, score,
  probability, side, price, grade, promotion, demotion, or actionable-count changes. No provider
  call, cadence, copy, label, layout, writer, table, or lease was added. Evidence and rollback:
  `docs/model-audits/2026-10-06-cfb-held-t60-accuracy-lock.md`.

### Fresh sharp-context held price map (fixture r73; snapshot r33; reader r18)

- Active member fixture / compact snapshot / reader releases are
  `cfb_v1_member_fixture_2026_10_06_r73_fresh_sharp_context_price_map` /
  `cfb_forward_member_snapshot_2026_10_06_r33_fresh_sharp_context_price_map` /
  `cfb_member_snapshot_reader_2026_10_06_r18_fresh_sharp_context_price_map`. The evidence schema,
  collector, sole writer, independent model, market reader, decisions, grades, locks and tracking
  remain unchanged.
- When the bounded full SharpAPI odds fallback is deliberately deferred, the same writer row can
  still contain a fresher complete Circa, Pinnacle or Bookmaker pair in its compact forward-context
  capture. Held-market price maps now consider those verified pairs alongside retained display
  books. This is presentation-only fallback selection: it cannot become an evaluated quote, create
  a pick, clear a hold, change a forecast, or alter a Bet grade.
- Read-only production replay keeps **89 games / 267 market forecasts** and the exact existing
  **12 Best Angles / 77 Leans / 66 Watchlists / 112 No Plays**. There are zero forecast, side,
  probability, score, evaluated-price, grade, actionability, lock or tracking changes and therefore
  zero promotions and zero demotions. Only Southern Miss at Troy's three held-market display rows
  move from older Rebet context to fresher Circa context. Its honest same-book trails are Moneyline
  `-405 → -400`, Spread `Troy -10.5 (-110) → Troy -10 (-105)`, and Total `51.5 (-110) → 51.5
  (-110)` at distinct verified timestamps. Complete opening/first-to-current trails rise 168→171.
- No provider request, cadence, user-facing copy, label or warning was added. Evidence and rollback
  are recorded in `docs/model-audits/2026-10-06-cfb-fresh-sharp-context-price-map.md`. Roll back
  fixture/snapshot/reader to r72/r32/r17; no stored evidence or tracking row requires reversal.

### Evaluated-book opening trail repair (fixture r72; snapshot r32; reader r17)

- Active member fixture / compact snapshot / reader releases are
  `cfb_v1_member_fixture_2026_10_06_r72_evaluated_book_opening_trails` /
  `cfb_forward_member_snapshot_2026_10_06_r32_evaluated_book_opening_trails` /
  `cfb_member_snapshot_reader_2026_10_06_r17_evaluated_book_opening_trails`. The evidence schema,
  collector, sole writer, independent model, market reader, decisions, grades, locks and tracking
  remain unchanged.
- The exact-price shopper may evaluate a different named book from the one representative
  provider opening used for forecast arbitration. The member history reader now projects only the
  compact per-market opening-family arrays already stored in the forward context capture and uses
  the evaluated sportsbook's own opening. It does not load full historical forecast payloads and
  never mixes books. The exact graded quote remains the terminal point.
- The live 89-game candidate restores complete opening-to-current trails for Jacksonville State at
  Kennesaw State Spread and New Mexico State at Florida International Spread and Total. Complete
  multi-point trails rise 165→168. Predictions, probabilities, expected scores, sides, exact
  quotes, grades, actionability, locks and tracking are byte-identical: zero promotions, zero
  demotions and zero changed decision identities. Southern Miss at Troy remains an honest
  current-only SharpAPI context quote because neither primary provider nor stored history has yet
  supplied an earlier same-book point; no opening is inferred.
- Evidence and rollback are recorded in
  `docs/model-audits/2026-10-06-cfb-evaluated-book-opening-trails.md`. Roll back fixture/snapshot/
  reader to r71/r31/r16; no evidence or tracking row requires reversal.

### Tuesday-through-Monday midweek coverage (window r5; collector r45; writer r98; fixture r71; snapshot r31)

- Active weekly window / collector / sole writer releases are
  `cfb_weekly_window_2026_10_06_r5_midweek_board_coverage` /
  `cfb_forward_evidence_collector_2026_10_06_r45_midweek_board_coverage` /
  `cfb_forward_evidence_writer_2026_10_06_r98_midweek_board_coverage`; member fixture / compact
  snapshot / reader are `cfb_v1_member_fixture_2026_10_06_r71_midweek_board_coverage` /
  `cfb_forward_member_snapshot_2026_10_06_r31_midweek_board_coverage` /
  `cfb_member_snapshot_reader_2026_10_06_r16_midweek_board_coverage`; shared presentation is
  `daily_edge_member_presentation_2026_10_08_r24_mlb_fi_opening_continuity`.
  Independent score, PMF, probabilities, market arbitration, decisions, grades, lock and tracking
  releases remain unchanged.
- The authoritative product week now covers Tuesday through Monday Eastern instead of dropping
  Tuesday and Wednesday FBS games from an otherwise complete weekly board. Sunday lookahead still
  preserves the active board while seeding only the adjacent next window. The provider query keeps
  the same bounded eight-date UTC-safe maximum; the writer, sport-scoped lease, model, market
  reader, T-60 lock and tracking paths are unchanged. Southern Miss at Troy, Jacksonville State at
  Kennesaw State, and New Mexico State at Florida International are the production acceptance
  cases for the October 6-12 window.
- The current 86-game slate has complete model scores and winner forecasts. Playbook presently
  supplies complete Moneyline, Spread and Total rows for all 55 FBS-involved games; 31 visible
  FCS-only games do not yet have a verified Spread or Total quote. Those 62 prediction surfaces
  now retain the authoritative score-derived projected margin/total instead of showing an
  unavailable label. All 62 exact-price contracts remain No Play; no price or betting line is
  inferred.
- Within the existing 24-game SharpAPI fallback budget, games with zero verified paired prices are
  attempted before games that already have a price but need broader consensus. Prior-cycle
  deferrals still rotate first within the same coverage tier. The 192-request ceiling, one
  `prediction_pipeline:cfb` lease and single append path remain unchanged. Every unlocked game is
  now collected at least hourly instead of waiting six hours early in the week. If Playbook or
  SharpAPI temporarily omits a previously verified exact-game line/split observation, the writer
  retains it with its original timestamp until fresher evidence silently replaces it; existing
  sport-specific freshness gates still exclude old evidence from forecast arbitration.
- Snapshot `publishedAt` is now the later of writer start and the newest included provider
  observation, so a response received during a run cannot create a negative publication lag or an
  apparently pre-published source. The immediately preceding r29 snapshot remains the sole reader
  fallback during deployment; fixture, evidence, member, prediction, grade, lock and tracking
  releases are unchanged.
- Board impact is zero promotions, zero demotions and zero exact-tuple changes. Evidence and
  rollback are recorded in
  `docs/model-audits/2026-10-06-cfb-missing-price-forecast-continuity-predeclaration.md`.
  The priority and timestamp repair is documented in
  `docs/model-audits/2026-10-06-cfb-zero-price-fallback-priority.md`.
  Midweek coverage evidence and rollback are documented in
  `docs/model-audits/2026-10-06-cfb-midweek-board-coverage.md`.

### Moneyline market-confirmation grade repair (decision r39; writer r94)

- Active Moneyline grade / decision releases are
  `cfb_v1_composite_grade_policy_2026_10_04_r17_moneyline_market_confirmation` /
  `cfb_market_sharp_aware_candidate_2026_10_04_r25_moneyline_market_confirmation` /
  `cfb_market_sharp_aware_production_2026_10_04_r27_moneyline_market_confirmation` /
  `cfb_v1_daily_edge_decision_2026_10_04_r39_moneyline_market_confirmation` /
  `cfb_v1_exact_price_decision_tuple_2026_10_04_r27_moneyline_market_confirmation`.
  The independent score, joint PMF, probability, selected side, Spread and Total releases remain
  unchanged.
- An actionable Moneyline with at least a five-point model-over-market gap is capped at Watchlist
  unless two independent market channels support it with no resistance. A price-aware favorite
  Watchlist between -201 and -700 may become only a Lean when model probability is at least 65%
  and target-excluded market probability is at least 60%. The rule preserves execution state and
  cannot manufacture EV, Best Angle status, a price, side, score or probability.
- The release-stamped locked replay moves 111 actionables to 114 through 27 promotions and 24
  demotions. Current actionables were 78-33, +4.512u and 0.2295 Brier; the candidate subset is
  96-18, +17.209u and 0.1571 Brier. The exact r38 cohort moves 11-12 to 16-2. These are historical
  counterfactuals, not guaranteed future performance.
- Active publication releases are evidence / member / fixture / snapshot / reader / sole writer /
  tracking r34 / r48 / r70 / r29 / r14 / r94 / r35. The immediately preceding r33 / r47 / r38 and
  r28 / r69 payloads remain explicitly readable during handoff; locked cards remain immutable.
  Provider budgets, calls, cadence, the `prediction_pipeline:cfb` lease, copy, labels and layout do
  not change.
- Evidence and rollback:
  `docs/model-audits/2026-10-04-cfb-moneyline-market-confirmation-r39.md`.

### Five-page Sharp main-market completion (Sharp odds r16; collector r41; writer r93)

- Active Sharp named-book fallback / collector / sole writer releases are
  `cfb_sharpapi_named_book_fallback_2026_10_03_r16_five_page_main_market` /
  `cfb_forward_evidence_collector_2026_10_03_r41_five_page_main_market` /
  `cfb_forward_evidence_writer_2026_10_03_r93_five_page_main_market`. Score, PMF, calibration,
  market arbitration, grade, member, fixture, snapshot, reader, tracking and presentation releases
  are unchanged. Writer r93 retains the r91 lock and r92 partition-resolution contracts.
- SharpAPI currently returns exactly five 200-row pages for GASO-CCU and MRSH-JMU because its
  `market=main` response also includes hundreds of explicitly marked alternate lines. The former
  four-page limit isolated those two events and preserved every sibling, but unnecessarily omitted
  their named-book fallback evidence and marked otherwise successful runs partial.
- R16 raises only the per-event completion bound from four to five pages. The weekly 24-game and
  192-request hard caps, 60-second attempt deadline, exact event identity, sportsbook-partition
  resolver, repeated-page guard, forward-offset validation and fail-closed sixth-page behavior are
  unchanged. The current remaining-slate reproduction completes and matches 24/24 games in 48
  requests. Raising the event cap adds at most one odds request for each of the two affected events;
  the independently paginated event catalog accounts for the remaining dynamic total. No synthetic
  quote or cross-event merge is permitted.
- The zero-write production-path replay publishes all 111 outlooks for 37 remaining games with zero
  capture failures and no Sharp fallback warning. Sixty-five exact-price markets remain evaluated
  and 46 remain held; the refreshed board is 9 Best Angles / 30 Leans / 23 Watchlists / 3 No Plays.
  Relative to the immediately preceding r92 production refresh, actionables move 40 to 39 through
  one Best Angle-to-Watchlist change from the newer captured inputs; no grade rule or threshold is
  changed. The only remaining health states are genuine missing canonical anchors and Playbook's
  verified HTTP 404 NCAAF injury endpoint.
- Evidence and rollback:
  `docs/model-audits/2026-10-03-cfb-five-page-main-market-r93.md`. Roll back r16/r41/r93 together
  while preserving append-only evidence and immutable locks.

### Exact-kickoff sportsbook-partition recovery (Sharp odds r15; collector r40; writer r92)

- Active Sharp named-book fallback / collector / sole writer releases are
  `cfb_sharpapi_named_book_fallback_2026_10_03_r15_sportsbook_partition_resolution` /
  `cfb_forward_evidence_collector_2026_10_03_r40_sportsbook_partition_resolution` /
  `cfb_forward_evidence_writer_2026_10_03_r92_sportsbook_partition_resolution`. The active score,
  PMF, calibration, decision, grade, member, fixture, snapshot, reader, tracking and presentation
  releases remain unchanged. Writer r92 retains the complete r91 T-60 accuracy-lock contract.
- SharpAPI can publish one exact matchup/kickoff under several event IDs partitioned by sportsbook.
  A still-current retained event ID remains authoritative. Without one, r15 selects an event only
  when one exact-kickoff partition has a unique lexicographically strongest verified footprint:
  trusted consensus-book count, then eligible target-book count, then declared book count. A tie,
  non-exact kickoff, or non-matching team remains ambiguous and triggers no odds request. Quotes
  from different event IDs are never merged.
- Exact team identity now accepts the provider's otherwise identical omission of a single leading
  `U` university marker (for example Albany Great Danes versus UAlbany Great Danes). It does not
  loosen date, kickoff, home/away, abbreviation, or other team-name identity.
- Collector r40 is an immediate forward refresh boundary for unlocked games, so deployment does
  not wait for the ordinary hourly cadence. Locked and started cards remain terminal. The existing
  maximum of 24 fallback games and 192 requests is unchanged; the bounded attempt timeout is 60
  seconds inside the five-minute leased route so the verified 46-request batch is not discarded at
  the former 40-second boundary.
- The live-provider prepublication proof resolved all three audited partitioned games. SDST-ILST
  recovered six named books with complete Moneyline, Spread and Total context; NWST-LAM recovered
  six named books with Spread and Total context while Moneyline remained truthfully unavailable;
  DSU-UALB resolved to its real sportsbook partition but its existing lock is not rewritten. The
  39-game production-path replay produced all 117 ML/Spread/Total forecasts, zero capture or score/
  side coherence failures, and a non-flat 11 Best Angle / 33 Lean / 23 Watchlist / 4 No Play exact-
  price surface across 71 evaluated markets; 46 markets stayed held rather than receiving invented
  prices. Evidence and rollback:
  `docs/model-audits/2026-10-03-cfb-sharp-sportsbook-partition-recovery-r92.md`.

### T-60 prediction-lock continuity (fixture r69; writer r91)

- The active CFB score, PMF, probability, market-reading, decision, grade, evidence, collector,
  and member releases remain unchanged. Fixture / compact snapshot / reader / tracking advance to
  `cfb_v1_member_fixture_2026_10_03_r69_t60_accuracy_lock` /
  `cfb_forward_member_snapshot_2026_10_03_r28_t60_accuracy_lock` /
  `cfb_member_snapshot_reader_2026_10_03_r13_t60_accuracy_lock` /
  `cfb_official_tracking_record_2026_10_03_r34_t60_accuracy_lock`; the sole leased writer advances
  to `cfb_forward_evidence_writer_2026_10_03_r91_t60_accuracy_lock`.
- A current-release T-60 payload captured within the existing 20-minute boundary now freezes the
  member card when it contains all three coherent published forecast directions and exact Spread
  and Total context lines, even if the sole health hold is a missing canonical exact-price market
  anchor. Those markets are persisted immediately as accuracy-only No Play records: price, fair
  market probability, edge, EV, recommendation, stake and ROI remain null and cannot be inferred.
- Any late capture, missing direction/line, incomplete model profile, mixed release, post-kickoff
  quote, or additional health hold still fails closed. Existing exact-price locks remain immutable
  and retain priority. The production read-only audit at 2026-10-03T18:55:02.833Z found 27 eligible
  lock/tracking games and 81 forecast markets; 63 rows already existed and the repair identifies
  exactly 18 missing rows across six complete T-60 cards. It changes zero scores, sides,
  probabilities, prices, grades, promotions, demotions, actionables, provider calls, schedules,
  copy, labels or layout.
- Evidence and rollback are recorded in
  `docs/model-audits/2026-10-03-cfb-t60-accuracy-lock-continuity.md`. Roll back fixture r69,
  snapshot r28, reader r13, tracking r34 and writer r91 together while preserving all append-only
  evidence and tracking rows.

### Display-book verified context outlook (r26; writer r90)

- Active numerical score / market / decision releases remain
  `cfb_v1_joint_score_runtime_2026_10_03_r15_verified_quote_market_flip_continuity` /
  `cfb_market_sharp_aware_candidate_2026_10_03_r24_verified_quote_market_flip_continuity` /
  `cfb_market_sharp_aware_production_2026_10_03_r26_verified_quote_market_flip_continuity` /
  `cfb_v1_daily_edge_decision_2026_10_03_r38_verified_quote_market_flip_continuity` /
  `cfb_v1_exact_price_decision_tuple_2026_10_03_r26_verified_quote_market_flip_continuity`.
  Grade policy r16 is unchanged.
- Active evidence / collector / member / writer releases are
  `cfb_forward_evidence_snapshot_2026_10_03_r33_display_context_outlook` /
  `cfb_forward_evidence_collector_2026_10_03_r39_display_context_outlook` /
  `cfb_v1_member_release_2026_10_03_r47_display_context_outlook` /
  `cfb_forward_evidence_writer_2026_10_03_r90_display_context_outlook`.
  Fixture / outcome / snapshot are r68 / r63 / r27; reader and tracking remain r12 / r33.
- A verified display-only book can supply the joint PMF context line even when it is not eligible
  to become an exact-price grading target. Target eligibility still gates fair-price grading and
  Bet selection, so the context cannot create a synthetic offer or actionability grade.
- Terminal locks retain priority over every new release row. No already-started or noon game is
  refreshed by this release.
- The current no-write production audit covered 99 games and 133 evaluated markets with zero
  capture failures: 15 Best Angles, 61 Leans, 46 Watchlists, and 11 No Plays; 107 exact-price
  markets remained held. The grade policy is unchanged, so these fresh-input counts are not a new
  promotion or demotion rule.

### One-sided verified context outlook (r26; writer r89; superseded evidence surface)

- Active numerical score / market / decision releases remain
  `cfb_v1_joint_score_runtime_2026_10_03_r15_verified_quote_market_flip_continuity` /
  `cfb_market_sharp_aware_candidate_2026_10_03_r24_verified_quote_market_flip_continuity` /
  `cfb_market_sharp_aware_production_2026_10_03_r26_verified_quote_market_flip_continuity` /
  `cfb_v1_daily_edge_decision_2026_10_03_r38_verified_quote_market_flip_continuity` /
  `cfb_v1_exact_price_decision_tuple_2026_10_03_r26_verified_quote_market_flip_continuity`.
  Grade policy r16 is unchanged.
- Active evidence / collector / member / writer releases are
  `cfb_forward_evidence_snapshot_2026_10_03_r32_one_sided_context_outlook` /
  `cfb_forward_evidence_collector_2026_10_03_r38_one_sided_context_outlook` /
  `cfb_v1_member_release_2026_10_03_r46_one_sided_context_outlook` /
  `cfb_forward_evidence_writer_2026_10_03_r89_one_sided_context_outlook`.
  Fixture / outcome / snapshot are r67 / r62 / r26; reader and tracking remain r12 / r33.
- A verified one-sided named-book main-line quote may now supply the Spread or Total context line for
  the authoritative joint PMF. This restores a line-specific prediction while keeping exact-price
  grading held: one side never becomes a synthetic fair-price pair, grade, or Bet selection.
- The no-write production-evidence audit retained 99 games, proposed 81 release-refresh captures,
  and produced 148 evaluated markets with zero capture failures: 19 Best Angles, 66 Leans,
  48 Watchlists, and 15 No Plays; 95 exact-price markets remained held. The underlying score,
  decision, and grade-policy releases are unchanged. Terminal locks retain priority over every new
  release row.

### Verified-quote prediction and schedule continuity (r26; writer r88; superseded evidence surface)

- Active numerical score / market / decision releases remain
  `cfb_v1_joint_score_runtime_2026_10_03_r15_verified_quote_market_flip_continuity` /
  `cfb_market_sharp_aware_candidate_2026_10_03_r24_verified_quote_market_flip_continuity` /
  `cfb_market_sharp_aware_production_2026_10_03_r26_verified_quote_market_flip_continuity` /
  `cfb_v1_daily_edge_decision_2026_10_03_r38_verified_quote_market_flip_continuity` /
  `cfb_v1_exact_price_decision_tuple_2026_10_03_r26_verified_quote_market_flip_continuity`.
  Grade policy r16 is unchanged.
- Evidence remains r31. Active member / writer releases are
  `cfb_v1_member_release_2026_10_03_r45_verified_quote_prediction_continuity` /
  `cfb_forward_evidence_writer_2026_10_03_r88_verified_quote_prediction_continuity`.
  Fixture / outcome / snapshot are r66 / r61 / r25; reader and tracking remain r12 / r33.
- The weekly collector now keeps a previously verified upcoming matchup in refresh planning when a
  later schedule response temporarily omits it. A currently returned provider game remains
  authoritative, and the immutable-boundary selector still prevents any terminal lock from being
  rewritten or reopened.
- The member contract accepts a stored release-pure legacy market outlook when the immediately
  newer decision bundle omitted that optional field. It publishes only when the outlook is tied to
  the identical verified sportsbook line; it does not recompute a probability in the reader,
  fabricate an exact-price grade, or manufacture a Bet selection.
- The no-write production-evidence audit retained 99 games and planned 71 unlocked refreshes with
  no capture failures. It published 142 evaluated markets: 19 Best Angles, 65 Leans, 46 Watchlists,
  and 12 No Plays; 71 markets remained exact-price held. No grade rule changed, so the one-count
  Best-Angle/Lean difference from the preceding live run is ordinary fresh-input movement rather
  than a new demotion rule. Existing locks remain unchanged.

### Retained market-prediction continuity (r26; writer r87; superseded member surface)

- Active numerical score / market / decision releases remain
  `cfb_v1_joint_score_runtime_2026_10_03_r15_verified_quote_market_flip_continuity` /
  `cfb_market_sharp_aware_candidate_2026_10_03_r24_verified_quote_market_flip_continuity` /
  `cfb_market_sharp_aware_production_2026_10_03_r26_verified_quote_market_flip_continuity` /
  `cfb_v1_daily_edge_decision_2026_10_03_r38_verified_quote_market_flip_continuity` /
  `cfb_v1_exact_price_decision_tuple_2026_10_03_r26_verified_quote_market_flip_continuity`.
  Grade policy r16 is unchanged.
- Evidence remains r31. Active member / writer releases are
  `cfb_v1_member_release_2026_10_03_r44_retained_market_prediction_continuity` /
  `cfb_forward_evidence_writer_2026_10_03_r87_retained_market_prediction_continuity`.
  Fixture / outcome / snapshot are r65 / r60 / r24; reader and tracking remain r12 / r33.
- A verified retained Spread or Total line continues to publish the authoritative PMF prediction
  at that exact line when a later provider response omits the quote. The real sportsbook, price,
  line, and original observation time remain intact. Retention does not manufacture an exact-price
  grade, alter a score, or create a Bet selection.
- The current 99-game board changes 15 verified retained-line Spread predictions and 15 verified
  retained-line Total predictions from unavailable to available. Five games without any verified
  timestamped quote remain unavailable rather than manufacturing market evidence. Numerical
  forecasts, sides, grades, and actionable board counts are unchanged; locked rows remain terminal
  and immutable.

### Verified-quote, release-transition, and market-flip continuity (r26; writer r86; superseded member surface)

- Active score / market / decision releases are
  `cfb_v1_joint_score_runtime_2026_10_03_r15_verified_quote_market_flip_continuity` /
  `cfb_market_sharp_aware_candidate_2026_10_03_r24_verified_quote_market_flip_continuity` /
  `cfb_market_sharp_aware_production_2026_10_03_r26_verified_quote_market_flip_continuity` /
  `cfb_v1_daily_edge_decision_2026_10_03_r38_verified_quote_market_flip_continuity` /
  `cfb_v1_exact_price_decision_tuple_2026_10_03_r26_verified_quote_market_flip_continuity`.
  Grade policy r16 is unchanged.
- Active evidence / collector / member / writer releases are
  `cfb_forward_evidence_snapshot_2026_10_03_r31_verified_quote_market_flip_continuity` /
  `cfb_forward_evidence_collector_2026_10_03_r37_verified_quote_market_flip_continuity` /
  `cfb_v1_member_release_2026_10_03_r43_verified_quote_market_flip_continuity` /
  `cfb_forward_evidence_writer_2026_10_03_r86_verified_quote_market_flip_continuity`.
  Fixture / outcome / snapshot / reader / tracking are r64 / r59 / r23 / r12 / r33.
- The writer now loads the immediately previous release plus the bounded older transition base, so
  fresh evidence can assemble a complete member board instead of republishing an older slate.
  A valid immutable lock always wins over a later unlocked refresh; releases can no longer reopen a
  locked game or revert its kickoff state.
- Latest verified paired named-book quotes are retained independently by sportsbook and market when
  a later provider cycle omits them. A fresh quote supersedes retained evidence. Spread and Total
  outlooks use their own verified book, so one incomplete sibling market cannot erase the other.
- Spread divergence may reflect the full score distribution only when the selected Spread side owns
  at least half of reported Spread money and current Moneyline money does not explicitly support the
  opposing winner. Missing evidence remains neutral; the released book-count and divergence tests
  remain in force.
- Release-pure replay covers 230 settled games. Overall Moneyline moves 193-37 to 194-36, Spread
  120-110 to 122-108, margin MAE 13.391 to 13.318, and team-score MAE 9.471 to 9.392. The untouched
  confirmation segment improves Moneyline 109-25 to 111-23 and Spread 68-66 to 70-64. The exact
  current-board replay remains non-flat and has zero score/side coherence failures. There is no new
  provider request, writer, schedule, copy, label, or layout.
- Evidence and rollback:
  `docs/model-audits/2026-10-03-cfb-spread-arbitration-continuity-predeclaration.md` and
  `docs/model-audits/2026-10-03-cfb-spread-arbitration-continuity-result.md`. Roll back the complete
  r25/r37/r30/r42/r85 release family together; do not rewrite immutable correct locks.

### Exact-kickoff duplicate-event disambiguation (writer r84)

- Active named-book fallback / sole writer releases are
  `cfb_sharpapi_named_book_fallback_2026_10_03_r14_exact_kickoff_disambiguation` /
  `cfb_forward_evidence_writer_2026_10_03_r84_exact_kickoff_disambiguation`. When the provider
  publishes duplicate exact-team/date catalog events within the existing 15-minute identity
  window, one and only one event at the scheduled kickoff may resolve the duplicate. Two events
  at the same exact kickoff, no exact kickoff, or a stale trusted ID remain ambiguous and trigger
  no odds request. A still-current previously trusted event ID retains priority.
- This repairs the confirmed SJSU-Hawaii one-minute duplicate without loosening team, date, or
  kickoff identity, adding provider calls, or changing model equations, grades, schedules, locks,
  member copy, labels, layout, or the `prediction_pipeline:cfb` lease. Previously complete games
  are unchanged. Evidence and rollback:
  `docs/model-audits/2026-10-03-cfb-exact-kickoff-disambiguation-r84.md`.

### Verified-quarterback and same-book market continuity (r16; writer r83)

- Active availability / market / grade / decision releases are
  `cfb_verified_availability_2026_10_02_r1_source_attributed_likely_out` /
  `cfb_market_sharp_aware_candidate_2026_10_02_r22_same_book_qb_availability` /
  `cfb_market_sharp_aware_production_2026_10_02_r24_same_book_qb_availability` /
  `cfb_v1_composite_grade_policy_2026_10_02_r16_verified_qb_market_continuity` /
  `cfb_v1_daily_edge_decision_2026_10_02_r36_verified_qb_market_continuity` /
  `cfb_v1_exact_price_decision_tuple_2026_10_02_r24_verified_qb_market_continuity`.
- Active publication releases are evidence / collector / member
  `cfb_forward_evidence_snapshot_2026_10_02_r29_verified_qb_market_continuity` /
  `cfb_forward_evidence_collector_2026_10_02_r35_verified_qb_market_continuity` /
  `cfb_v1_member_release_2026_10_02_r41_verified_qb_market_continuity`; sole
  writer `cfb_forward_evidence_writer_2026_10_02_r83_verified_qb_market_continuity`;
  fixture / outcome
  `cfb_v1_member_fixture_2026_10_02_r62_verified_qb_market_continuity` /
  `cfb_market_sharp_public_outcome_contract_2026_10_02_r57_verified_qb_market_continuity`;
  compact snapshot / reader
  `cfb_forward_member_snapshot_2026_10_02_r21_verified_qb_market_continuity` /
  `cfb_member_snapshot_reader_2026_10_02_r10_verified_qb_market_continuity`; and
  tracking `cfb_official_tracking_record_2026_10_02_r31_verified_qb_market_continuity`.
- Source-attributed expected-QB absence selects the active replacement in the
  existing field, and later league-provider evidence supersedes the provisional
  report. One bounded league injury read runs per writer collection; successful
  responses use the existing shared cache, while failed or empty responses
  cannot erase retained exact-game evidence or the board. Availability selects
  only from already captured active-roster context and does not add a second
  T-60 roster-fetch path. An explicit active/available status clears the
  absence; omission remains unknown rather than healthy. Unvalidated
  replacement-QB score impact cannot stay actionable, but the prediction and
  three-market tracking denominator remain present.
- Opening/current movement is same-sportsbook only; price shopping remains a
  separate exact-price decision. The 99-game stored-board replay pairs nine
  promotions with fifteen demotions and moves actionables 44 to 40. The
  live-provider zero-write replay contains 17 Best Angles and 72 Leans among
  158 evaluated markets, with zero capture failures. No member copy, labels,
  layout, stake, writer, schedule, or lease changed. Evidence and rollback:
  `docs/model-audits/2026-10-02-cfb-verified-qb-market-continuity-r16.md`.

### Preceding last-verified price continuity (fixture r61; writer r82)

- Preceding member publication releases were
  `cfb_forward_evidence_writer_2026_10_01_r82_last_verified_price_continuity` /
  `cfb_v1_member_fixture_2026_10_01_r61_last_verified_price_continuity` /
  `cfb_market_sharp_public_outcome_contract_2026_10_01_r56_last_verified_price_continuity` /
  `cfb_forward_member_snapshot_2026_10_01_r20_last_verified_price_continuity` /
  `cfb_member_snapshot_reader_2026_10_01_r9_last_verified_price_continuity`.
- When a later provider response omits a previously verified named-book quote,
  the member snapshot silently retains the newest pregame quote for that exact
  market side from bounded compatible history. A fresh quote always wins. The
  fallback keeps the real sportsbook and observation timestamp, adds no copy or
  label, and cannot create a selection, probability, grade, stake, or tracking
  tuple.
- The October 1 live replay retains all 99 games and 297 markets, restores the
  two previously observed McNeese-LSU Spread/Total prices, and changes zero
  predictions, scores, probabilities, sides, grades, actionables, locks, or
  provider requests. Evidence and rollback:
  `docs/model-audits/2026-10-01-cfb-last-verified-price-continuity-r61.md`.

### Retained professional independent score + validated market marriage (r15; writer r82)

- Retained independent/runtime releases are
  `cfb_professional_weekly_runtime_2026_10_01_r7_compact48` /
  `cfb_professional_independent_score_model_2026_10_01_r7_compact48` /
  `cfb_professional_empirical_joint_distribution_2026_10_01_r7_compact48`.
  The portable score engine uses matchup-specific rolling offense and defense,
  QB/passing, rushing/trench, scoring opportunity, pace, field position,
  red-zone, third-down, turnover, special-teams, rest, venue, Elo and personnel
  inputs. A weekly cross-family scoring-domain correction is applied only when
  the predeclared disagreement gate is met.
- Preceding market candidate / production releases were
  `cfb_market_sharp_aware_candidate_2026_10_01_r21_split_spread_arbitration` /
  `cfb_market_sharp_aware_production_2026_10_01_r23_split_spread_arbitration`.
  Consensus is not a score anchor. The only validated score mutation is a real
  Spread-side arbitration when retained Playbook evidence spans at least eight
  books, money-minus-ticket divergence is at least five points, and the signal
  conflicts with the independent cover side. It preserves the independent
  Total and rebuilds one coherent joint PMF. Other split, price and same-book
  movement evidence remains source-separated in the established confidence
  path and may not create an unvalidated score nudge.
- Retained probability / calibration releases and preceding grade / decision / tuple releases were
  `cfb_v1_professional_joint_probability_2026_10_01_r14_market_marriage` /
  `cfb_v1_exact_price_calibration_2026_10_01_r12_professional_market_marriage` /
  `cfb_v1_composite_grade_policy_2026_10_01_r15_professional_market_marriage` /
  `cfb_v1_daily_edge_decision_2026_10_01_r35_professional_market_marriage` /
  `cfb_v1_exact_price_decision_tuple_2026_10_01_r23_professional_market_marriage`.
- Preceding publication set: evidence / collector / member
  `cfb_forward_evidence_snapshot_2026_10_01_r28_professional_market_marriage` /
  `cfb_forward_evidence_collector_2026_10_01_r34_professional_market_marriage` /
  `cfb_v1_member_release_2026_10_01_r40_professional_market_marriage`; sole
  writer `cfb_forward_evidence_writer_2026_10_01_r82_last_verified_price_continuity`;
  fixture / outcome
  `cfb_v1_member_fixture_2026_10_01_r61_last_verified_price_continuity` /
  `cfb_market_sharp_public_outcome_contract_2026_10_01_r56_last_verified_price_continuity`;
  compact snapshot / reader
  `cfb_forward_member_snapshot_2026_10_01_r20_last_verified_price_continuity` /
  `cfb_member_snapshot_reader_2026_10_01_r9_last_verified_price_continuity`; and
  tracking `cfb_official_tracking_record_2026_10_01_r30_professional_market_marriage`.
  The existing writer and `prediction_pipeline:cfb` lease remain sole owners.
- 2024–25 validate only the independent model because they lack complete market
  evidence. Full marriage validation uses 2026 Weeks 1–2 for development and
  Weeks 3–4 for confirmation. The current exact-input board replay contains 77
  promotions, 15 demotions, 46 side changes and 86 actionables versus 44, with
  zero coherence failures. The live-provider zero-write replay covers all 99
  games and all 297 markets without adding copy, labels, layout, stakes,
  schedules or writers. Evidence and rollback:
  `docs/model-audits/2026-10-01-cfb-professional-independent-market-marriage-r15.md`.

### Retained next-window seed priority behavior (introduced in writer r80)

- The active r82 sole writer retains the next-window priority behavior first
  introduced by `cfb_forward_evidence_writer_2026_09_28_r80_next_window_seed_priority`.
  During the established Sunday/Monday two-window overlap, the one-time
  `opening_seed` for an empty adjacent week now runs before terminal
  `opening_incomplete` bookkeeping from the completed week. Valid current-week
  T-60 captures, release refreshes, and reference-line completion remain higher
  priority.
- This repairs a live starvation case in which all 106 September 24–28 games
  had started, six games lacked a separate opening-stage row, and every
  15-minute writer cycle selected the old week, produced no capture plan, and
  left the October 1–5 window empty. Prediction math, model inputs, PMFs,
  projected scores, sides, probabilities, grades, actions, stakes, member copy,
  labels, and layout are unchanged. Promotions / demotions / actionable changes
  on the already-published board are 0 / 0 / 0. Evidence and rollback:
  `docs/model-audits/2026-09-28-cfb-next-window-seed-priority-r80.md`.

### Member-facing play-grade tracking parity (aggregate v12)

- Active tracking aggregate contract is
  `tracking_aggregate_v12_nhl_member_grade_parity_2026_10_01`. CFB Best Angle
  and Lean performance cuts now follow the exact immutable grade displayed on
  the member card. A CFB Lean whose locked offer was internally marked
  shop/no-bet remains a Lean for grade-accuracy tracking instead of silently
  disappearing from that cut. Other sports retain their existing
  actionable-only Best Angle / Lean cuts.
- NHL's immutable writer uses the established Daily Edge presentation tokens
  `best_signal`, `model_only`, and `market_watch`. The aggregate now translates
  those locked tokens to Best Angle, Lean, and Watchlist respectively; a
  `model_only` row explicitly marked no-bet remains No Play. This restores NHL
  market-category and play-grade cuts without rewriting a prediction, grade,
  result, or historical row. The September 29 canonical release-pure ledger
  restores **4 Moneyline Leans, 4 puck-line Leans, and 2 Total Leans**; the
  September 30 ledger restores **1 / 1 / 3** respectively. Those locked cohorts
  contain zero authoritative Best Angles, so none are invented. A future
  eligible `best_signal` row enters the Best Angle cut automatically.
- For the September 26 slate, the member-facing CFB grade ledger is exactly
  **4 Best Angles (3-1), 58 Leans (39-19), 75 Watchlists (46-29), and 161 No
  Plays (101-60)**. The previous CFB Lean panel incorrectly showed only 27
  rows (15-12), including just 3 of 34 Moneyline Leans. Correct Moneyline Lean
  grade tracking is 34 rows at 25-9; Spread remains 20 at 12-8 and Total
  remains 4 at 2-2.
- This is a reader aggregation repair only. It changes no locked prediction,
  score, probability, side, line, price, grade, action, stake, result, overall
  W-L record, Daily Edge card, UI copy, label, or layout. Evidence and rollback:
  `docs/model-audits/2026-09-27-cfb-play-grade-tracking-parity-v11.md`.

### Displayed fallback-line tracking recovery (writer r79; tracking r29)

- Active sole writer / tracking record releases are
  `cfb_forward_evidence_writer_2026_09_27_r79_displayed_book_line_tracking_recovery` /
  `cfb_official_tracking_record_2026_09_27_r29_displayed_book_line_recovery`.
  A held immutable pregame payload can now recover Spread and Total accuracy records from the
  same complete paired fallback-book line already retained for member display when no
  target-eligible book occupied `market.current`. The line must match the exact provider game,
  be observed no later than the immutable capture and before kickoff, remain internally paired,
  and survive deterministic cross-book representative-line filtering. The exact independent PMF
  is replayed and verified against its stored hash and summary before it is evaluated at that
  line. Prices remain context-only and odds, edge, EV, recommendation, stake, and ROI remain null.
- The September 26 audit therefore adds only Southern–Jackson State Spread and Total at the real
  stored fallback lines (Jackson State -20.5 and 55.5), moving the immutable denominator from
  100/98/98 to 100/99/99 for Moneyline/Spread/Total. Prairie View–Grambling remains Moneyline-only
  because no Spread or Total existed in any stored pregame evidence. No line is fabricated to
  force equal counts. Forecasts, PMFs, scores, member cards, sides, grades, actions, stakes, copy,
  labels, layouts, provider calls, cadence, and the `prediction_pipeline:cfb` lease are unchanged.
  Promotions / demotions / actionable changes are 0 / 0 / 0. Evidence and rollback:
  `docs/model-audits/2026-09-27-cfb-displayed-line-tracking-recovery-r79.md`.

### Stored named-book tracking recovery (writer r78; tracking r28)

- Active sole writer / tracking record releases are
  `cfb_forward_evidence_writer_2026_09_26_r78_named_line_tracking_recovery` /
  `cfb_official_tracking_record_2026_09_26_r28_named_line_recovery`.
  When a published held game has an immutable pregame named-book line but lacks the redundant
  Spread or Total outlook, the writer replays the exact independent PMF, verifies every replayed
  output against its stored hash and summary, and evaluates that exact stored line for an
  accuracy-only record. Odds, edge, EV, recommendation, stake, and ROI remain null. If no pregame
  line ever existed, the game still locks its published Moneyline prediction and no missing
  Spread or Total is fabricated.
- The tracking planner now filters candidate rows to the exact planned game/market keys. One
  missing market cannot block complete sibling games, and a supplemental recovery cannot insert
  an unplanned market. Prediction PMFs, scores, member cards, sides, grades, actions, stakes,
  copy, labels, layouts, provider collection cadence, and the sole `prediction_pipeline:cfb`
  lease are unchanged. Evidence and rollback:
  `docs/model-audits/2026-09-26-cfb-named-line-tracking-recovery-r78.md`.

### Published-pregame tracking completeness (writer r77; tracking r27)

- Active sole writer / tracking record releases are
  `cfb_forward_evidence_writer_2026_09_26_r77_published_pregame_tracking` /
  `cfb_official_tracking_record_2026_09_26_r27_published_pregame_tracking`.
  Tracking insertion is atomic per game instead of across the entire weekly slate. When the T-60
  writer misses, the latest immutable prediction published before kickoff supplies accuracy-only
  Moneyline, Spread, and Total records even when its exact American price is unavailable. No odds,
  edge, EV, recommendation, stake, or ROI is reconstructed. A game without a required reference
  line remains explicitly reported, but it cannot suppress complete sibling locks. An older payload
  that contains exact-price predictions but omits the redundant outlook map is still recoverable.
  Existing records remain immutable and retries remain idempotent.
- Prediction models, PMFs, expected and representative scores, probabilities, sides, grades,
  actions, stakes, evidence, member snapshots, copy, labels, provider calls, cron cadence, and the
  sole `prediction_pipeline:cfb` lease are unchanged. Same-input prediction impact is zero
  promotions, zero demotions, zero side changes, and zero score changes. Evidence and rollback:
  `docs/model-audits/2026-09-26-cfb-tracking-game-scope-isolation-r76.md`.

### Sharp price-trail continuity (writer r75; retains r74 member transition)

- Active sole writer is `cfb_forward_evidence_writer_2026_09_26_r75_sharp_price_trail_continuity`.
  Its existing metadata-first reader now loads one latest payload per game from the immediately
  previous verified release, in addition to current game/stage rows and immutable cutoff recovery.
  This supplies the compact snapshot's existing started-game transition without reloading the
  season's historical JSON payloads or adding a writer/provider call.
- Prediction math, releases, sides, probabilities, grades, actions, stakes, locks, tracking,
  provider budgets, member copy, labels, and layout are unchanged. Evidence and rollback:
  `docs/model-audits/2026-09-26-cfb-member-transition-completion-r74.md`.

### Directional probability normalization (writer r73)

- Active sole writer is `cfb_forward_evidence_writer_2026_09_26_r73_directional_probability_normalization`.
  When finite-precision accumulation leaves both sides of an otherwise valid binary Spread or Total
  outlook infinitesimally below 50%, the writer normalizes that pair before enforcing the existing
  majority-probability invariant. Pairs with either side already at or above 50% are returned
  unchanged, so ordinary probabilities, sides, prices, grades, actions, stakes, promotions, and
  demotions are identical.
- Live-provider zero-write proof completed all 106 games, proposed 100 payloads, produced 168
  evaluated markets with zero capture failures, and performed zero writes. The existing model,
  evidence, member, snapshot, tracking, provider-budget, lease, copy, label, and layout releases
  remain unchanged. Evidence and rollback:
  `docs/model-audits/2026-09-26-cfb-directional-probability-normalization-r73.md`.

### SharpAPI exact-event failure isolation (writer r72)

- Active named-book fallback / sole writer releases are
  `cfb_sharpapi_named_book_fallback_2026_09_26_r13_event_failure_isolation` /
  `cfb_forward_evidence_writer_2026_09_26_r72_sharpapi_event_failure_isolation`. An oversized,
  malformed, or non-advancing exact-event odds response is recorded only for its verified game
  and cannot abort healthy sibling games before the atomic append. The four-page per-event and
  192-request run ceilings remain unchanged; canonical discovery, global exhaustion, shared
  transport failures, and ambiguous identity still fail closed.
- Live-provider zero-write proof completed 106 games and proposed 100 opening payloads with 158
  exact-price evaluations and zero capture failures after the James Madison–Old Dominion event
  exceeded four pages. There were zero writes. The active r71 score/side prediction, evidence,
  member, fixture, snapshot, and tracking family is unchanged, as are model math, board tiers,
  stakes, copy, labels, layout, cron cadence, and the `prediction_pipeline:cfb` lease. Evidence
  and rollback: `docs/model-audits/2026-09-26-cfb-sharpapi-event-failure-isolation-r72.md`.

### Score/Spread side coherence (r71)

- Active probability / calibration / grade / decision / tuple releases are
  `cfb_v1_market_sharp_joint_probability_2026_09_26_r13_score_side_coherent` /
  `cfb_v1_market_sharp_exact_price_calibration_2026_09_26_r11_score_side_coherent` /
  `cfb_v1_composite_grade_policy_2026_09_26_r14_score_side_coherent` /
  `cfb_v1_daily_edge_decision_2026_09_26_r34_score_side_coherent` /
  `cfb_v1_exact_price_decision_tuple_2026_09_26_r22_score_side_coherent`. Spread selection now
  defaults to the same authoritative joint PMF that produces the displayed expected and
  representative score. The prior bounded counter-signal remains explicit diagnostic code for
  upstream margin-model research, but it cannot silently publish the opposite team.
- Active market candidate / production, evidence / collector / member, writer, fixture / outcome,
  compact snapshot / reader, and tracking releases are
  `cfb_market_sharp_aware_candidate_2026_09_26_r20_score_side_coherent` /
  `cfb_market_sharp_aware_production_2026_09_26_r22_score_side_coherent`,
  `cfb_forward_evidence_snapshot_2026_09_26_r27_score_side_coherent` /
  `cfb_forward_evidence_collector_2026_09_26_r33_score_side_coherent` /
  `cfb_v1_member_release_2026_09_26_r39_score_side_coherent`,
  `cfb_forward_evidence_writer_2026_09_26_r71_score_side_coherent`,
  `cfb_v1_member_fixture_2026_09_26_r59_score_side_coherent` /
  `cfb_market_sharp_public_outcome_contract_2026_09_26_r54_score_side_coherent`,
  `cfb_forward_member_snapshot_2026_09_26_r18_score_side_coherent` /
  `cfb_member_snapshot_reader_2026_09_26_r7_score_side_coherent`, and
  `cfb_official_tracking_record_2026_09_26_r25_score_side_coherent`.
- The prior r70/r26/r38/r58/r17 family is the explicit transition fallback until the sole writer
  publishes r71. Expected scores, PMF values, market/sharp inputs, thresholds, stakes, provider
  budgets, copy, labels, and layout are unchanged. Evidence and rollback:
  `docs/model-audits/2026-09-26-cfb-score-side-coherence-r71.md`.

### Playbook failure isolation and last-valid carry-forward (writer r70)

- Preceding sole writer is `cfb_forward_evidence_writer_2026_09_26_r70_playbook_failure_isolation`;
  its behavior is retained by active r71.
  Playbook lines and splits requests are independently optional: an HTTP 429 or other request failure
  is reported in cron/operator health but cannot abort healthy BallDontLie, SharpAPI, ESPN-reference,
  quarterback, weather, tracking, and compact-snapshot work.
- When a Playbook response fails or omits an exact event, the writer retains that game's newest valid
  timestamped Playbook line and split observations. Their original observation times remain unchanged;
  nothing is fabricated or relabeled as fresh. No member copy, stale tag, substitute label, badge, or
  layout is added.
- Evidence schema, collector, member, fixture, snapshot, reader, model, PMF, probability, calibration,
  decision, grade, stake, and tracking releases remain r72's existing active family. The successful-
  provider math and sole `prediction_pipeline:cfb` lease are unchanged. Evidence and rollback:
  `docs/model-audits/2026-09-26-cfb-playbook-failure-isolation-predeclaration.md`.

### Bounded reference-coverage cursor and carry-forward (r72)

- Active ESPN reference / evidence / collector / member releases are
  `cfb_espn_reference_line_2026_09_20_r2_coverage_cursor` /
  `cfb_forward_evidence_snapshot_2026_09_20_r26_reference_coverage_cursor` /
  `cfb_forward_evidence_collector_2026_09_20_r32_reference_coverage_cursor` /
  `cfb_v1_member_release_2026_09_20_r38_reference_coverage_cursor`. Sole writer / fixture / outcome are
  `cfb_forward_evidence_writer_2026_09_26_r70_playbook_failure_isolation` /
  `cfb_v1_member_fixture_2026_09_20_r58_reference_coverage_cursor` /
  `cfb_market_sharp_public_outcome_contract_2026_09_20_r53_reference_coverage_cursor`; compact snapshot /
  reader are `cfb_forward_member_snapshot_2026_09_20_r17_reference_coverage_cursor` /
  `cfb_member_snapshot_reader_2026_09_20_r6_reference_coverage_cursor`; tracking is
  `cfb_official_tracking_record_2026_09_20_r24_reference_coverage_cursor`.
- Live verification after r71 proved the historical repair at 97/97/97 and the board healthy, but also
  exposed that the eight-game prospective bound revisited the nearest missing games instead of advancing
  across the slate. r72 raises the bounded batch to the provider module's existing 32-game ceiling,
  carries a verified opening reference forward, prioritizes never-attempted deferred games, and schedules
  targeted zero-cadence completion batches only while deferred work remains. Once every candidate has
  been attempted, genuinely unpublished openings wait for the ordinary six-hour/hourly refresh cadence;
  there is no provider hot loop or per-card request.
- Exact ESPN schedule inspection added verified identities for TCU, UTSA, Robert Morris, Lehigh, UT
  Martin, and East Tennessee State. The exact-team, exact-orientation, bounded-kickoff, DraftKings-opening
  requirements are unchanged. A line that has not been published stays unavailable rather than being
  fabricated. Playbook retains per-market precedence, and r71's append-only 52-row historical repair is
  untouched.
- Score model, PMF, probabilities, calibration, exact-price decisions, grades, actionability, stakes,
  copy, labels, and page structure remain unchanged; promotions / demotions / actionable-board impact are
  0 / 0 / 0. Evidence and rollback are in
  `docs/model-audits/2026-09-20-cfb-reference-coverage-cursor.md`.

### Complete three-market tracking and strict reference fallback (r71; retained by r72)

- Active ESPN reference / evidence / collector / member releases are
  `cfb_espn_reference_line_2026_09_20_r1_strict_opening_fallback` /
  `cfb_forward_evidence_snapshot_2026_09_20_r25_complete_tracking_reference` /
  `cfb_forward_evidence_collector_2026_09_20_r31_complete_tracking_reference` /
  `cfb_v1_member_release_2026_09_20_r37_complete_tracking_reference`. Sole writer / fixture / outcome
  are `cfb_forward_evidence_writer_2026_09_20_r66_complete_tracking_reference` /
  `cfb_v1_member_fixture_2026_09_20_r57_complete_tracking_reference` /
  `cfb_market_sharp_public_outcome_contract_2026_09_20_r52_complete_tracking_reference`; compact
  snapshot / reader are `cfb_forward_member_snapshot_2026_09_20_r16_complete_tracking_reference` /
  `cfb_member_snapshot_reader_2026_09_20_r5_complete_tracking_reference`; tracking is
  `cfb_official_tracking_record_2026_09_20_r23_complete_tracking_reference`.
- The September 19 production denominator was 97 Moneylines / 71 Spreads / 71 Totals even though all
  239 existing grades independently re-graded exactly. Twenty-six games lacked both Spread and Total.
  The outcome-blind repair reproduces all 26 immutable pre-cutoff PMFs and matches all 26 exact ESPN
  events plus complete DraftKings opening lines. It proposes exactly 52 append-only accuracy-only No
  Plays—26 Spreads and 26 Totals—with zero duplicate keys and zero reconstructed economic fields. One
  game's two rows retain its earlier immutable published exact prediction; 50 rows use the strict opening
  reference. Normal settlement yields equal 97/97/97 denominators. Existing rows are never changed.
- Prospectively, Playbook remains the primary per-market context. Its absent Spread or Total may use the
  strictly identified ESPN/DraftKings opening reference only to evaluate the already-authoritative PMF.
  The fallback is never a current quote, multi-book consensus, sharp input, exact-price decision, grade,
  promotion, stake, or ROI source. Collection is slate-scoped, bounded, and isolated inside the existing
  `/api/cron/cfb-forward-evidence` writer and `prediction_pipeline:cfb` lease. Actionable promotions /
  demotions and board-count impact are 0 / 0 / 0; the September 19 r69 score, PMF, probability,
  calibration, exact-price decision, grade, and stake releases remain unchanged.
- The release-transition reader now validates the immediately previous snapshot against that snapshot's
  exact r24/r36/r56 release tuple, keeping the verified board visible until r25/r37/r57 is first published.
  The market-history reader retains r22, r23, r24, and r25 price-only chronology. Evidence, verification,
  corrected result counts, load bounds, and atomic rollback are recorded in
  `docs/model-audits/2026-09-20-cfb-complete-tracking-recovery-predeclaration.md` and
  `docs/model-audits/2026-09-20-cfb-complete-tracking-recovery-result.md`.

### Same-book history continuity across prediction releases (r70; retained by r71)

- Preceding sole writer / member fixture / compact snapshot / reader were
  `cfb_forward_evidence_writer_2026_09_19_r65_price_history_continuity` /
  `cfb_v1_member_fixture_2026_09_19_r56_price_history_continuity` /
  `cfb_forward_member_snapshot_2026_09_19_r15_price_history_continuity` /
  `cfb_member_snapshot_reader_2026_09_19_r4_price_history_continuity`. The contained Spread r69
  prediction, probability, calibration, decision, evidence, collector, member, grade, outcome,
  and tracking releases remain active and unchanged.
- The bounded market-only history reader now accepts exactly the compatible r22, r23, and r24
  immutable evidence releases. Database and embedded release IDs must match, and exact game,
  capture-stage, and captured-at identity still fail closed. Historical forecast, PMF, context,
  decision, and tracking payloads remain unread; older releases contribute only real same-book
  opening/current price and split chronology to the member DTO.
- This repairs the release-boundary regression that left the current 97-game board with only one
  visible odds observation per market after the r23/r24 prediction releases. It adds no provider
  call, cron, writer, lease, probability, side, projection, grade, promotion, demotion, stake,
  lock, tracking, or settlement behavior. The existing 100-game query batch, 1,000-row page,
  12,000-row board cap, gzip limits, sole `/api/cron/cfb-forward-evidence` writer, and
  `prediction_pipeline:cfb` lease are unchanged. Evidence and rollback are recorded in
  `docs/model-audits/2026-09-19-cfb-price-history-release-continuity.md`.

### Contained Spread counter-signal calibration (r69; superseded as production default by r71)

- Historical probability / calibration / decision / tuple releases were `cfb_v1_market_sharp_joint_probability_2026_09_19_r12_contained_spread_counter_signal` / `cfb_v1_market_sharp_exact_price_calibration_2026_09_19_r10_contained_spread_counter_signal` / `cfb_v1_daily_edge_decision_2026_09_19_r33_contained_spread_counter_signal` / `cfb_v1_exact_price_decision_tuple_2026_09_19_r21_contained_spread_counter_signal`. Their 53–55% Spread counter-signal is retained only for explicit diagnostic replay after r71; it is no longer the production default.
- Contained chronology still clears every gate: 2023 selection improves 429–453 to 454–428 with Brier/log loss .251485/.696127→.249459/.692066; 2024 confirmation improves 487–478 to 490–475 and .251065/.695284→.250564/.694278; 2025 improves 508–450 to 512–446 and .247629/.688359→.247079/.687257. Release-pure settled 2026 sides remain 66–77→82–61 overall and 16–20→19–17 among actionables.
- The first r63 production cycle isolated four event-containment failures and refused the incomplete compact snapshot; the declared previous r12 snapshot remained readable and prevented an empty board. r64 keeps that validator intact and corrects the probability before grading. The post-incident SELECT-only exact-price replay passed the production coherence assertion on every bundle: 52 evaluable Spreads, seven side changes, 26→28 actionables, two promotions, zero demotions. No provider call or write occurred in that replay.
- Publication set: evidence / collector / member `cfb_forward_evidence_snapshot_2026_09_19_r24_contained_spread_counter_signal` / `cfb_forward_evidence_collector_2026_09_19_r30_contained_spread_counter_signal` / `cfb_v1_member_release_2026_09_19_r36_contained_spread_counter_signal`; market grade candidate / production `cfb_market_sharp_aware_candidate_2026_09_19_r19_contained_spread_counter_signal` / `cfb_market_sharp_aware_production_2026_09_19_r21_contained_spread_counter_signal`; sole writer `cfb_forward_evidence_writer_2026_09_19_r65_price_history_continuity`; fixture / outcome `cfb_v1_member_fixture_2026_09_19_r56_price_history_continuity` / `cfb_market_sharp_public_outcome_contract_2026_09_19_r51_contained_spread_counter_signal`; compact snapshot / reader `cfb_forward_member_snapshot_2026_09_19_r15_price_history_continuity` / `cfb_member_snapshot_reader_2026_09_19_r4_price_history_continuity`; tracking `cfb_official_tracking_record_2026_09_19_r22_contained_spread_counter_signal`. r14/r55 are the immediate publication-transition fallbacks. The sole `/api/cron/cfb-forward-evidence` writer and `prediction_pipeline:cfb` lease are unchanged. Evidence and rollback: `docs/model-audits/2026-09-19-cfb-spread-counter-signal-calibration.md` and `docs/model-audits/2026-09-19-cfb-price-history-release-continuity.md`.

### Validated Spread counter-signal calibration (r68; superseded by contained r69)

- Active probability / calibration / grade / decision / tuple releases are `cfb_v1_market_sharp_joint_probability_2026_09_19_r11_spread_counter_signal` / `cfb_v1_market_sharp_exact_price_calibration_2026_09_19_r9_spread_counter_signal` / `cfb_v1_composite_grade_policy_2026_09_19_r13_spread_counter_signal` / `cfb_v1_daily_edge_decision_2026_09_19_r32_spread_counter_signal` / `cfb_v1_exact_price_decision_tuple_2026_09_19_r20_spread_counter_signal`. When the authoritative PMF selects a Spread side above 53% and at most 55%, the versioned calibration publishes the opposite side with the same calibrated confidence. Its raw PMF probability remains separately exposed as `forecastProbability`. Moneyline, Total, the joint score PMF, expected and representative scores, provider inputs, stakes, and UI copy are unchanged.
- 2023 selection improved 429–453 to 455–427; repeated 2024 confirmation improved 487–478 to 491–474 and 2025 improved 508–450 to 513–445, with Brier and log loss improving in all three seasons. Release-pure settled 2026 Spreads improve 66–77 to 82–61; the actionable subset improves 16–20 to 19–17. The current r19-only settled sample is only four Spreads with no qualified rows, so this is not described as an r19-only result. The Total candidate failed confirmation and was rejected.
- The September 19 SELECT-only exact-price replay changes 10 of 60 evaluated Spread sides while preserving 29 actionables: one evidence-resisted Lean demotion is paired with one positive-EV, resistance-free large-Spread promotion under the already approved 54% / 3pp / 3% / 24-point lane. Grade counts remain 0 Best Angles / 29 Leans / 20 Watchlists / 11 No Plays. This is an accuracy-directed side correction, not board flattening or quota filling.
- Publication set: evidence / collector / member `cfb_forward_evidence_snapshot_2026_09_19_r23_spread_counter_signal` / `cfb_forward_evidence_collector_2026_09_19_r29_spread_counter_signal` / `cfb_v1_member_release_2026_09_19_r35_spread_counter_signal`; market grade candidate / production `cfb_market_sharp_aware_candidate_2026_09_19_r18_spread_counter_signal` / `cfb_market_sharp_aware_production_2026_09_19_r20_spread_counter_signal`; sole writer `cfb_forward_evidence_writer_2026_09_19_r63_spread_counter_signal`; fixture / outcome `cfb_v1_member_fixture_2026_09_19_r54_spread_counter_signal` / `cfb_market_sharp_public_outcome_contract_2026_09_19_r50_spread_counter_signal`; compact snapshot / reader `cfb_forward_member_snapshot_2026_09_19_r13_spread_counter_signal` / `cfb_member_snapshot_reader_2026_09_19_r2_spread_counter_signal`; tracking `cfb_official_tracking_record_2026_09_19_r21_spread_counter_signal`; shared coherence runtime `football_cross_market_coherence_2026_09_22_r12_nfl_nonpush_side_alignment`. The CFB caller retains its established half-push convention and behavior; r12 changes only the explicitly opted-in NFL decision-side comparison. The existing sole writer and `prediction_pipeline:cfb` lease are unchanged. Evidence, limitations, and atomic rollback are documented in `docs/model-audits/2026-09-19-cfb-spread-counter-signal-calibration.md`.

### Complete same-book price history (r67; retained by r70)

- Original release set: `cfb_forward_evidence_writer_2026_09_18_r62_complete_price_history` / `cfb_v1_member_fixture_2026_09_18_r53_complete_price_history` / `cfb_forward_member_snapshot_2026_09_18_r12_complete_price_history` / `cfb_member_snapshot_reader_2026_09_18_r1_transition_fallback`; r70 above is the active continuation. The existing `/api/cron/cfb-forward-evidence` writer remains the sole owner under `prediction_pipeline:cfb`. Its fast forecast reader still loads only the latest checksum-verified payload per game/stage, while a separate bounded visible-board query projects only immutable market prices, openings, and split fields from the append-only evidence rows. The member snapshot therefore preserves each sportsbook's real chronological open/first, material moves, and current/T-60 price instead of collapsing most markets to one terminal observation. Same-book identity remains mandatory; prices from different books are never presented as movement.
- The live pre-change September 17–21 snapshot contained 101 games but only 9–13 two-point trails per market, while the evidence table held 15,581 season rows and roughly ten current-week observations for most priced games. The compact history path is capped at 12,000 visible-board rows, paged in 1,000-row reads, and never selects the historical forecast, PMF, quarterback, weather, decision, or contextual payload. Model, PMF, calibration, side, probability, projection, evaluated quote, grade, actionability, stake, T-60 lock, tracking, settlement, provider calls, evidence schema, and cron cadence are unchanged. Roll back writer r62, fixture r53, and snapshot r12 together; immutable evidence and prediction records require no rollback.
- Rollout incident and reader recovery: the r12 deployment changed the versioned snapshot key before the first scheduled writer had published that key, producing a temporary empty CFB board from 15:20 until the 15:24 writer completed at 15:25 UTC. The page then retained the cached miss after the valid 101-game snapshot existed. Reader r1 prevents both failure modes: it accepts only the explicitly declared current or immediately previous verified release pair from `cfb_forward_evidence_writer`, and a cached miss is retried directly against the compact snapshot store. It never rebuilds the evidence season or changes a prediction, price, grade, stake, lock, or tracking record.

### Complete published prediction denominators (r66)

- Active sole writer / tracking record: `cfb_forward_evidence_writer_2026_09_18_r62_complete_price_history` / `cfb_official_tracking_record_2026_09_13_r20_complete_published_denominators`. The existing `/api/cron/cfb-forward-evidence` job remains the only prediction-record writer under `prediction_pipeline:cfb`; there is no second writer or backfill endpoint. The bounded evidence reader retains one additional checksum-verified row per game: the last immutable prediction published at or before the scheduled T-60 boundary. A started game without a valid official T-60 record may use only that pre-boundary snapshot to restore the prediction-accuracy denominator missed by the tracking writer. Selection validates the boundary against that exact payload's own scheduled kickoff so a historical provider schedule correction cannot admit a row that the record builder correctly rejects.
- Recovered rows are real side-bearing `No Play` predictions, never Held or Toss-Up. They retain the exact published side, model probability, reference line when one exists, evidence hash, release and original capture timestamp. They count in W-L-push accuracy exactly like every other side-bearing prediction. Price, market probability, edge, EV, recommendation, stake and ROI remain null/excluded rather than being reconstructed after the result. The same non-Held contract applies to future CFB no-price prediction rows. A missing historical Spread or Total reference line remains absent because it cannot be graded truthfully; Moneyline remains trackable for every game.
- Outcome-blind production audit for September 12: 105 games had a qualifying immutable pre-boundary prediction. The recoverable denominator is 259 predictions—105 Moneylines, 77 Spreads and 77 Totals. Six records already exist and the idempotent writer proposes 253 missing records. This changes zero sides, probabilities, projections, grades, exact-price tuples, recommendations, stakes or current Daily Edge board entries; actionable promotions/demotions are 0/0 and the actionable board count is unchanged. Evidence and rollback: `docs/model-audits/2026-09-13-cfb-published-tracking-denominator-recovery.md`. Roll back writer r61 and tracking r20 together, preserve all immutable evidence and prediction records, and investigate any count other than the audited 105/259 or any recovered row with `held=true`, a reconstructed price/economic field, or a post-cutoff source snapshot.

### Complete week-ahead availability and tracking recovery (r65)

- Active weekly window / sole writer / member fixture / compact snapshot: `cfb_weekly_window_2026_09_07_r4_overlapping_week_ahead` / `cfb_forward_evidence_writer_2026_09_18_r62_complete_price_history` / `cfb_v1_member_fixture_2026_09_18_r53_complete_price_history` / `cfb_forward_member_snapshot_2026_09_18_r12_complete_price_history`. Candidate / production grade releases are `cfb_market_sharp_aware_candidate_2026_09_13_r17_balanced_positive_value` / `cfb_market_sharp_aware_production_2026_09_13_r19_balanced_positive_value`. The writer selects one checksum-verified latest current-release payload per game and capture stage instead of reloading 12,024 superseded and repeated large JSON payloads; the lightweight identity/date trail remains complete for unchanged prior-results inputs, and the separate market-only projection restores the complete price chronology. The complete member DTO is stored in an integrity-checked gzip envelope so database transport does not repeatedly transfer the multi-megabyte JSON document that caused member-page timeouts. Decompression preserves the exact fixture and fails closed on checksum, byte-limit, or release mismatch. The balanced value boundary demotes an actionable with nonpositive target-excluded value to Watchlist and retains a tested resistance-free positive-value Watchlist-to-Lean promotion path at the already approved market thresholds. The September 17–21 provider window contains 101 model-covered games. Every game retains three model predictions; missing exact-price evidence remains a tracked No Play at a valid T-60 lock.
- Score model, PMF, calibration, side, probability, stake, T-60 lock, and settlement behavior are unchanged. The frozen live September 17–21 replay covered all 101 games in 138.4 seconds with zero capture failures, zero balanced-rule promotions, zero balanced-rule demotions, and 2 actionable Leans; the board contains 0 Best Angles, 7 Watchlists, 2 No Plays, and 292 held markets. Existing 266 CFB records remain immutable and release-separated. Evidence and rollback: `docs/model-audits/2026-09-13-football-daily-edge-availability-predeclaration.md`.

### Overlapping week-ahead slate publication and reader recovery (r63, retained)

- Active weekly window / sole writer / member fixture / compact snapshot: `cfb_weekly_window_2026_09_07_r4_overlapping_week_ahead` / `cfb_forward_evidence_writer_2026_09_08_r56_week_ahead_schedule_continuity` / `cfb_v1_member_fixture_2026_09_07_r51_overlapping_week_ahead` / `cfb_forward_member_snapshot_2026_09_07_r9_overlapping_week_ahead`. Once a complete current opening wave reaches Sunday Eastern time, the current Thursday-through-Monday window stays visible while the adjacent next window is seeded and displayed. This prevents a lone Sunday/Monday tail game from hiding the already-published next slate.
- The existing `cfb_forward_evidence` job remains the only writer under `prediction_pipeline:cfb` and still fetches only one bounded weekly provider window per invocation. A due current-game T-60 capture or release refresh outranks lookahead work; an unseeded/incomplete next opening wave outranks only an ordinary unlocked-cadence refresh. Each window retains its own exact provider identities, expected game count, cadence, evidence, and locks. Tuesday naturally makes the prefetched window primary. The member fixture combines at most those two adjacent independently complete release waves and labels the overlap explicitly.
- September 7 pre-change evidence was 106 stored September 3-7 model-covered games with only SMU@FSU still future; the verified September 10-14 provider window contained 131 scheduled and 111 model-covered games. This is coverage-only behavior: no existing tuple is recomputed or removed, and the score model, PMF, calibration, probability, side, quote, EV, confidence/economics bridge, grade, execution status, stake, T-60 timing, tracking, settlement, and provider budgets remain unchanged. Evidence and rollback: `docs/model-audits/2026-09-07-cfb-overlapping-week-ahead-r1.md`. Roll back all four r63 releases together without modifying stored evidence, locks, or prediction records.

#### Provider schedule-correction continuity and fast member recovery

- Active sole CFB writer / member fixture / compact snapshot: `cfb_forward_evidence_writer_2026_09_08_r56_week_ahead_schedule_continuity` / `cfb_v1_member_fixture_2026_09_07_r51_overlapping_week_ahead` / `cfb_forward_member_snapshot_2026_09_07_r9_overlapping_week_ahead`. Prior-result reads now select the newest immutable kickoff date for each exact BALLDONTLIE game ID. A legitimate schedule correction that crosses a UTC date boundary can no longer abort the entire writer; two different dates at the same capture timestamp still fail closed as contradictory evidence.
- Incident evidence: BALLDONTLIE game `458875` (Illinois State at Western Illinois) was first stored at `2026-09-05T23:00:00Z` and later corrected to `2026-09-06T00:00:00Z`. Every natural writer run after the compact snapshot published at `2026-09-07T23:24:48.538Z` failed on the conflicting-date guard, so the eight-hour member LKG expired at `2026-09-08T07:24:48.538Z`. The member page then attempted a full season evidence reconstruction and remained on `Loading…` for roughly 40 seconds before showing an unavailable board.
- Reader continuity remains read-only and release-stamped: the compact weekly snapshot may be used for at most eight days by its own `publishedAt`, while the normal weekly lifecycle removes already-played games. The request path no longer rebuilds the full immutable evidence season and returns a visible unavailable state within four seconds if the compact read itself fails. The snapshot header continues to expose the stored `as_of` timestamp. This changes no forecast, PMF, side, probability, projection, selected quote, EV, grade, execution status, stake, T-60 lock, tracking record, provider budget, writer ownership, or lease. Same-input promotion/demotion and actionable-board impact is zero.
- The sole scheduled writer remains `/api/cron/cfb-forward-evidence` under `prediction_pipeline:cfb`; there is no new refresh or write path. Roll back writer r56 to r54 and the r63 weekly-window, fixture, snapshot, and reader-continuity changes together if a natural cycle produces mixed releases, a duplicate prior-result identity, member/writer incoherence, timeout growth, or any unexpected same-input decision change. Preserve all immutable evidence and prediction records. Evidence: `docs/model-audits/2026-09-08-cfb-schedule-correction-continuity.md`.

### Authoritative lock truth and per-game capture isolation (r61)

- Active sole CFB writer / member fixture / compact snapshot: `cfb_forward_evidence_writer_2026_09_05_r54_per_game_lock_isolation` / `cfb_v1_member_fixture_2026_09_05_r50_authoritative_lock_truth` / `cfb_forward_member_snapshot_2026_09_05_r8_authoritative_lock_truth`. One synchronous game-specific calculation or coherence failure is now quarantined and reported by provider game ID and capture stage; every other planned opening, unlocked, and T-60 payload continues through the existing single append, tracking, and member-snapshot path. Shared provider, storage, lease, and append failures remain fail-closed.
- A card says `LOCKED` only when its stored row passes the complete immutable T-60 contract: on-time capture within the existing 20-minute maximum lag, zero health holds, tracking enabled, and coherent exact-price decisions whose evaluated and locked timestamps equal the capture timestamp. A game inside its scheduled T-60 window without that tuple says `LOCKS`; after kickoff it says `LOCK MISSED`, with `lockedAt=null`. No late, unhealthy, unlocked, or started row is relabeled as locked, retroactively backfilled, or admitted to tracking.
- Production evidence showed a prior all-slate calculation failure stopped before append, leaving otherwise-due games without T-60 rows. The earlier model-coherence repair resolved that triggering matchup; r61 removes the systemic all-game failure coupling and makes any remaining missed boundary explicit. Forecasts, sides, probabilities, projections, evaluated prices, EV, grades, stakes, tracking eligibility, the one leased writer, provider budgets, and immutable evidence are unchanged. Evidence and rollback: `docs/model-audits/2026-09-05-cfb-lock-capture-isolation-r61-predeclaration.md` and `docs/model-audits/2026-09-05-cfb-lock-capture-isolation-r61-result.md`. Roll back writer r54, fixture r50, and compact snapshot r8 together to r53/r49/r7; do not alter stored evidence or prediction records.

### Verified PMF mean/median winner publication repair (r60)

- Active shared validator / sole CFB writer: `football_cross_market_coherence_2026_09_05_r8_verified_pmf_mean_median_winner` / `cfb_forward_evidence_writer_2026_09_05_r53_verified_pmf_mean_median_winner`. The explicit CFB 0.5-point same-PMF mean/median tolerance now applies consistently to the top-level winner/expected-score check as well as exact-market decision checks. It is available only when the caller explicitly supplies the tolerance and a normalized PMF independently proves probability mass, expected scores, and winner probability. Wider crosses, calls without the explicit tolerance, unverified forecasts, malformed PMFs, representative-winner disagreement, market and every other coherence failure remain fatal before the atomic append.
- Incident evidence: production run `f37de959-50c1-43f9-846e-a62f258f20dd` stopped before append on UCLA at California because its verified PMF assigned UCLA 51.4531% win probability while its expected-score mean placed California ahead by 0.0489 points. That is a valid discrete-distribution mean/median crossover inside the existing CFB tolerance, not inconsistent inputs. The repair changes no PMF, side, probability, projection, quote, EV, grade, execution status, stake, lock, tracking row, provider request, lease, or reader rule. Evidence and rollback: `docs/model-audits/2026-09-05-cfb-verified-pmf-mean-median-winner-r60-predeclaration.md` and `docs/model-audits/2026-09-05-cfb-verified-pmf-mean-median-winner-r60-result.md`. Roll back validator r8 and writer r53 together to r7/r52 while preserving all immutable evidence.

### Confidence / economics bridge (r58)

- Active confidence / grade / decision: `cfb_holistic_confidence_2026_09_05_r4_confidence_economics_bridge` / `cfb_v1_composite_grade_policy_2026_09_05_r12_confidence_economics_bridge` / `cfb_v1_daily_edge_decision_2026_09_05_r31_confidence_economics_bridge`. The selected-side model probability remains primary and the existing bounded, signed Circa, Playbook, same-book line-movement, and same-book implied-price-movement evidence may affirm or resist it. Missing optional evidence is neutral. No new weighted model/market blend, fixed spread-size rule, EV gate, or one-source veto was added.
- A Spread's final confidence grade ordinarily finishes at most one tier above its underlying exact-price decision grade. A second-tier exception requires at least two independent identity-valid affirming channels among strict Sharp splits, same-book movement, and public splits, with no resistance. Because the frozen historical Spread Best Angle subgroup did not qualify, a Spread reaches Best Angle only from an already-qualified Best Angle foundation or that same multi-channel affirmation. A lone signal never vetoes or flips a prediction, and the UMass Watchlist-to-Lean path remains. The already-released graduated Moneyline price ceilings remain: -200 or better is uncapped, -201 through -499 is capped at Lean, and -500 or worse is capped at Watchlist. Price and EV still select `bet` versus `shop`; they do not erase the prediction or force No Play. Stakes are unchanged.
- Publication set: evidence / member `cfb_forward_evidence_snapshot_2026_09_05_r22_confidence_economics_bridge` / `cfb_v1_member_release_2026_09_05_r34_confidence_economics_bridge`; candidate / production `cfb_market_sharp_aware_candidate_2026_09_05_r16_confidence_economics_bridge` / `cfb_market_sharp_aware_production_2026_09_05_r18_confidence_economics_bridge`; sole writer / collector `cfb_forward_evidence_writer_2026_09_05_r53_verified_pmf_mean_median_winner` / `cfb_forward_evidence_collector_2026_09_05_r28_optional_sharp_rejection_isolation`; fixture / outcome `cfb_v1_member_fixture_2026_09_05_r49_confidence_economics_bridge` / `cfb_market_sharp_public_outcome_contract_2026_09_05_r49_confidence_economics_bridge`; compact snapshot `cfb_forward_member_snapshot_2026_09_05_r7_confidence_economics_bridge`; tracking `cfb_official_tracking_record_2026_09_05_r19_confidence_economics_bridge`. The reader preserves the immediately prior r21/r33/r30 family and older valid immutable T-60 rows. One leased writer, provider budgets, sides, PMF, probabilities, projections, evaluated quotes, EV, T-60 timing, tracking semantics, settlement, and stakes are unchanged. A source-proven SharpAPI HTTP 400 on one optional exact-event `/odds` fallback is isolated like an optional network/404 failure: primary named-book rows continue, fallback-dependent rows remain held, and the warning is published. Authentication, rate-limit, identity, pagination, and request-cap failures remain fail-closed.
- Outcome-blind September 5 comparison: 63 games / 159 markets move from 4 Best Angles / 57 Leans / 76 Watchlists / 22 No Plays to 1 / 60 / 76 / 22. VMI +55.5, Tulsa +13.5, and New Hampshire +33.5 move from Best Angle to Lean; all 61 confidence-actionables remain, containing 54 `bet` and seven `shop` rows. There are zero side, probability, projection, quote, execution, stake, or actionability changes, and large-spread actionables remain 21. The September 4 diagnostic remains 0 / 8 / 9 / 4 with no retrospective changes. Across all 25 release-separated locked CFB Spreads through September 4, the model side is 8-15-2 and 55%+ rows are 1-7-1; that small mixed-release cohort rejects confidence-only premium placement but does not authorize a side flip or re-fit. The UMass +29.5 regression retains its evidence-supported Watchlist-to-Lean path. Evidence and rollback: `docs/model-audits/2026-09-05-cfb-confidence-reliability-r58-predeclaration.md` and `docs/model-audits/2026-09-05-cfb-confidence-reliability-r58-result.md`. Roll back the complete r58 release family to r57 without rewriting any immutable T-60 payload or tracking row.

### Holistic confidence with graduated favorite-price ceilings and immutable lock visibility (r57 reader)

- Active confidence / grade / decision: `cfb_holistic_confidence_2026_09_04_r3_favorite_price_tier_ceiling` / `cfb_v1_composite_grade_policy_2026_09_04_r11_favorite_price_tier_ceiling` / `cfb_v1_daily_edge_decision_2026_09_04_r30_favorite_price_tier_ceiling`. The authoritative selected-side probability plus a maximum four-point combined adjustment from exact-identity Circa splits, Playbook splits, same-book line movement and same-book implied-price movement determines confidence. Ordinary evidence is signed and bounded; no single channel is an automatic veto or flip. The attached moneyline price then supplies a graduated maximum display tier: -200 or better is uncapped, worse than -200 through -499 cannot exceed Lean, and -500 or worse cannot exceed Watchlist. This ceiling never creates a No Play. EV and the exact quote separately select `bet` versus `shop`.
- Publication set: evidence / member `cfb_forward_evidence_snapshot_2026_09_04_r21_favorite_price_tier_ceiling` / `cfb_v1_member_release_2026_09_04_r33_favorite_price_tier_ceiling`; sole writer `cfb_forward_evidence_writer_2026_09_04_r50_cross_release_lock_visibility`; fixture / outcome `cfb_v1_member_fixture_2026_09_04_r48_cross_release_lock_visibility` / `cfb_market_sharp_public_outcome_contract_2026_09_04_r48_cross_release_lock_visibility`; compact member snapshot `cfb_forward_member_snapshot_2026_09_04_r6_cross_release_lock_visibility`; tracking `cfb_official_tracking_record_2026_09_04_r18_favorite_price_tier_ceiling`. Shared validator remains `football_cross_market_coherence_2026_09_04_r7_confidence_execution_status`. The reader explicitly recognizes r19/r31/r28 and r20/r32/r29 as the two immediate transition families. If r20 is incomplete, only independently valid immutable T-60 rows may overlay the preceding complete authority before r21 is assembled; unlocked or unhealthy rows cannot cross the boundary. The live dry comparison changes only SJSU@EMU: its already-recorded 21:39:53.584Z T-60 tuple replaces the stale unlocked card. All other 105 games are unchanged. The forecast PMF, side, probability, projection, quote calculation, EV, grade policy, stake, tracking rows, one leased writer, T-60 immutability and provider budget are unchanged. Price-tier evidence: `docs/model-audits/2026-09-04-cfb-extreme-favorite-confidence-cap-r56-predeclaration.md` and `docs/model-audits/2026-09-04-cfb-extreme-favorite-confidence-cap-r56-result.md`. Lock-visibility evidence: `docs/model-audits/2026-09-04-cfb-lock-visibility-r57-predeclaration.md` and `docs/model-audits/2026-09-04-cfb-lock-visibility-r57-result.md`. Roll back the reader publication identifiers to writer r49, fixture/outcome r47 and snapshot r5 without modifying r21 evidence, the immutable r20 lock, or any prediction record.

### Superseded holistic confidence / price-portable execution research

- The original implementation checkpoint `cfb_holistic_confidence_shadow_2026_09_04_r1_continuous_evidence` was the outcome-blind predecessor of active r2. It evaluated one continuous confidence score from the coherent selected-side probability plus bounded, source-weighted Circa, same-book movement, and Playbook contributions. Exact sportsbook price and EV remained attached but selected `bet` versus `shop`; they did not change confidence. There was no team, price-band, EV-floor, or absolute-line veto.
- The September 3 diagnostic moved Massachusetts +29.5 from Watchlist to Lean/Bet, while aligned resistance demoted Akron +27.5 from Watchlist to No Play. The complete ET-day board changed 2 Best Angles / 4 Leans / 17 Watchlists / 5 No Plays to 6 / 11 / 6 / 5, with 13 promotions, 6 demotions and zero side changes. That frozen evidence fed the r2 publication review above. Evidence: `docs/model-audits/2026-09-04-cfb-holistic-confidence-predeclaration.md` and `docs/model-audits/2026-09-04-cfb-holistic-confidence-shadow-result.md`.

### Market-evidence identity continuity and T-60 fallback isolation (r53 candidate)

- Candidate grade / decision / member releases: `cfb_v1_composite_grade_policy_2026_09_04_r9_evidence_identity_continuity` / `cfb_v1_daily_edge_decision_2026_09_04_r28_evidence_identity_continuity` / `cfb_v1_member_release_2026_09_04_r31_evidence_identity_continuity`; market-evidence production is `cfb_market_sharp_aware_production_2026_09_04_r15_evidence_identity_continuity`. Grade-time Circa Spread/Total evidence may describe an exact or half-point-adjacent offered line, matching the already-bounded forecast-input tolerance. Coherent movement is read from the same context book at opening and current observation, independently of a better price-shopped execution quote.
- This release adds no matchup-, team-, spread-size-, price-, or outcome-specific promotion rule. It repairs only whether already-authorized evidence is available to the incumbent evidence-aware ladder; wider line mismatches remain unknown, and movement still requires a coherent opening/current pair from one sportsbook.
- Confidence and execution remain separate in tracking: a future Best Angle/Lean confidence label at a negative exact-price EV retains its named-book quote but is stored as `no_bet` with no stake or ROI exposure. Missing prices remain held. The current board produces no such execution-status change.
- Publication identifiers: sole writer `cfb_forward_evidence_writer_2026_09_04_r46_evidence_identity_continuity`, collector `cfb_forward_evidence_collector_2026_09_04_r27_sharp_fallback_isolation`, fixture / outcome `cfb_v1_member_fixture_2026_09_04_r45_evidence_identity_continuity` / `cfb_market_sharp_public_outcome_contract_2026_09_04_r45_evidence_identity_continuity`, member snapshot `cfb_forward_member_snapshot_2026_09_04_r3_evidence_identity_continuity`, tracking `cfb_official_tracking_record_2026_09_04_r16_evidence_identity_complete_denominators`. Optional SharpAPI odds-fallback network failures no longer abort games that already have sufficient primary-provider named books; fallback-dependent games remain held, the incident is surfaced, and structural/identity/cap errors still fail closed. The immutable maximum T-60 lag remains unchanged. Evidence and rollback: `docs/model-audits/2026-09-04-cfb-market-evidence-identity-continuity.md`.

### Complete prediction-accuracy denominators (tracking r14 / writer r44)

- The authoritative CFB forecast, PMF, probability, calibration, decision, grade, member, provider and exact-price releases remain unchanged. Tracking now persists all three locked T-60 forecast markets for every eligible game. A market without an executable exact-price tuple is stored as an explicit held `No Play` using the immutable model-owned market outlook: it keeps the forecast side, probability and Spread/Total reference line, while price, edge and EV remain null. These held forecasts count in prediction accuracy but remain excluded from ROI, stakes, Best Angle/Lean recommendation performance and executable actionability.
- Writer / tracking releases are `cfb_forward_evidence_writer_2026_09_04_r44_complete_tracking_backfill_union` / `cfb_official_tracking_record_2026_09_04_r14_complete_prediction_denominators`. Both ordinary collection and no-collection runs union retained immutable T-60 payloads into tracking before the existing market-scoped idempotency check, so natural cycles insert only missing `(game, market)` rows; they never overwrite an existing record or invent a price. The September 3 cohort changes from 6 Moneyline / 10 Spread / 9 Total rows to 10/10/10 when every held outlook is available. Evidence and rollback: `docs/model-audits/2026-09-04-cfb-complete-tracking-denominators.md`.

### Narrow PMF mean/median publication coherence (r51)

- The active r49 forecast, PMF, probability, calibration, grade, decision and exact-price tuple releases remain unchanged. The r50 publication contract is corrected so its documented 0.5-point near-toss-up boundary is enforced consistently by both the sole writer and the member fixture. A decision must still match the exact authoritative PMF event side at its evaluated line. When that PMF side and the expected-score mean differ, CFB permits publication only while the mean is no more than 0.5 points across the line; wider disagreement still fails closed. NFL and every caller that does not explicitly opt into the CFB boundary retain the prior 0.25-point default.
- Publication set: evidence schema / collector / member remain `cfb_forward_evidence_snapshot_2026_09_01_r19_coherent_movement_evidence` / `cfb_forward_evidence_collector_2026_09_01_r26_coherent_movement_evidence` / `cfb_v1_member_release_2026_09_02_r29_total_publication_coherence`; writer is `cfb_forward_evidence_writer_2026_09_04_r44_complete_tracking_backfill_union`; fixture / outcome are `cfb_v1_member_fixture_2026_09_03_r43_narrow_mean_median_publication` / `cfb_market_sharp_public_outcome_contract_2026_09_03_r43_narrow_mean_median_publication`; shared validator is `football_cross_market_coherence_2026_09_03_r6_cfb_narrow_mean_median_tolerance`; tracking is `cfb_official_tracking_record_2026_09_04_r14_complete_prediction_denominators`. Snapshot release `cfb_forward_member_snapshot_2026_09_03_r1_fast_lkg` stores the already-authoritative fixture in the existing response-snapshot table after the sole writer's coherence gate, with a 90-minute fresh marker and bounded eight-hour last-known-good window. Snapshot failure is isolated and reported; the reader falls back to the unchanged immutable evidence rebuild. One leased writer, atomic append, T-60 precedence, provider calls, weekly scope, projections, probabilities, sides, exact prices, grades, stakes and settlement behavior are unchanged.
- Incident evidence: natural writer rows 102511, 102523, 102526 and 102534 failed before append for LAM@UL Total because the authoritative PMF selected Under 48.5 while its same-PMF expected total was 48.82770674927421, a 0.32770674927421-point mean/median disagreement. The current member fixture remained available but stale at the earlier Under 49.5 row; no contradictory or partially updated payload was written. The focused regression proves the default 0.25-point guard still rejects this shape while the explicit CFB 0.5-point contract accepts it, and proves the member fixture accepts the same completed tuple. This is outcome-blind publication repair, not a forecast-performance claim. Evidence and rollback: `docs/model-audits/2026-09-03-cfb-narrow-mean-median-publication.md`.

### Total publication coherence (r50)

- The active forecast, PMF, probability, calibration, grade, decision and exact-price tuple releases remain exactly the r49 set below. Publication no longer converts a complete negative-EV `No Play` Total into `mean_pmf_near_tossup_conflict` merely because the PMF-selected side differs from the expected-score mean by at most 0.5 points near 50%. The authoritative PMF side, probability, exact evaluated two-sided quote, EV and `No Play` grade now remain visible together. Missing sharp splits remain neutral and cannot suppress that completed decision; this release adds no confidence, promotion, stake, provider input, model calculation or reader-derived side.
- Publication set: evidence schema / collector remain `cfb_forward_evidence_snapshot_2026_09_01_r19_coherent_movement_evidence` / `cfb_forward_evidence_collector_2026_09_01_r26_coherent_movement_evidence`; member is `cfb_v1_member_release_2026_09_02_r29_total_publication_coherence`; writer is `cfb_forward_evidence_writer_2026_09_02_r40_total_publication_coherence`; fixture / outcome are `cfb_v1_member_fixture_2026_09_02_r42_total_publication_coherence` / `cfb_market_sharp_public_outcome_contract_2026_09_02_r42_total_publication_coherence`; tracking remains `cfb_official_tracking_record_2026_09_01_r13_coherent_movement_evidence`. The member selector explicitly retains same-schema r28 as the atomic fallback and preserves valid immutable r28 T-60 rows during the first r29 wave. The sole writer, `prediction_pipeline:cfb` lease, weekly slate, quarterback/injury behavior, locks, settlement, tracking behavior, UI and copy are unchanged.
- Frozen no-write replay at `2026-09-02T11:54:55.920Z`: all 87 FBS-involved games remain present. Evaluated tuples move 215→217, from **18 Best Angles / 39 Leans / 107 Watchlists / 51 No Plays** to **18 / 39 / 107 / 53**. The only additions are UALB@BUF Under 48.5 and CMU@UNM Under 46.5, both complete, negative-EV Total No Plays previously suppressed by the removed writer helper. Actionables remain 57; projection, existing-tuple probability, side, grade and stake changes are all zero. Both added games had six complete two-sided Total books and no published strictly matched sharp split, which remained neutral.
- Frozen-board evidence and exact rollback criteria: `docs/model-audits/2026-09-02-cfb-total-publication-coherence-r50.md`. Roll back writer/member/fixture/outcome publication identifiers to r49 while preserving every r29 row if a natural cycle changes any projection, probability, side, grade, actionable count or stake; loses an exact quote; violates atomic fallback or locked-row precedence; or produces mixed current-slate publication releases.

### Coherent opening/current market-evidence forecast (r49)

- Active production release: `cfb_market_sharp_aware_production_2026_09_01_r13_coherent_movement`. The forecast retains r48's 25% immutable football mass, 75% canonical current-market mass, verified kickoff-weather adjustment, strict fresh Circa priority, and lower-strength bounded Playbook public consensus. It now reads only valid same-book opening-to-current trails and adds a capped movement complement before rebuilding the authoritative joint PMF. Spread/Total line movement and de-vigged price movement may contribute at most 0.75 score points and receive 25% complement weight because the current market is already the dominant anchor. Mismatched books, invalid or post-evaluation timestamps, missing movement, and missing/stale split evidence contribute exactly zero and never hold or flatten a projection. Public evidence remains secondary and cannot reverse Circa; the coherent combined evidence may support, resist, or reverse a weak original side before exact-price economics and grading.
- Active model set: score runtime `cfb_v1_joint_score_runtime_2026_09_01_r12_coherent_movement_evidence`; model / distribution / probability / representative score `cfb_v1_market_sharp_score_model_2026_09_01_r11_coherent_movement_evidence` / `cfb_v1_market_sharp_joint_distribution_2026_09_01_r9_coherent_movement_evidence` / `cfb_v1_market_sharp_joint_probability_2026_09_01_r10_coherent_movement_evidence` / `cfb_v1_market_sharp_reachable_score_2026_09_01_r9_coherent_movement_evidence`; calibration / grade policy `cfb_v1_market_sharp_exact_price_calibration_2026_09_01_r8_coherent_pmf_identity` / `cfb_v1_composite_grade_policy_2026_09_01_r7_coherent_pmf_economics`; decision / tuple `cfb_v1_daily_edge_decision_2026_09_01_r26_coherent_movement_evidence` / `cfb_v1_exact_price_decision_tuple_2026_09_01_r19_coherent_movement_evidence`.
- Active publication set: evidence / collector / member `cfb_forward_evidence_snapshot_2026_09_01_r19_coherent_movement_evidence` / `cfb_forward_evidence_collector_2026_09_01_r26_coherent_movement_evidence` / `cfb_v1_member_release_2026_09_01_r28_coherent_movement_evidence`; writer `cfb_forward_evidence_writer_2026_09_01_r39_coherent_movement_evidence`; fixture / outcome `cfb_v1_member_fixture_2026_09_01_r41_coherent_movement_evidence` / `cfb_market_sharp_public_outcome_contract_2026_09_01_r41_coherent_movement_evidence`; tracking `cfb_official_tracking_record_2026_09_01_r13_coherent_movement_evidence`. The existing weekly FBS-involved slate, quarterback substitution and injury-unavailable behavior, kickoff-weather safety handling, exact-price grade vocabulary and thresholds, one leased writer under `prediction_pipeline:cfb`, immutable T-60 precedence, settlement, tracking, UI, and copy are unchanged.
- Read-only current-slate replay at `2026-09-01T12:00:00.000Z`: all 87 FBS-involved games had a usable canonical market anchor and 209 markets were comparable (56 Moneyline / 76 Spread / 77 Total). The board moved from **23 Best Angles / 38 Leans / 101 Watchlists / 47 No Plays** to **22 / 43 / 95 / 49**. Actionables increased 61→65 with four promotions, three demotions, and one non-actionable side change. Candidate actionables are Moneyline 6, Spread 20, and Total 39. Forty-two games changed projected score; maximum absolute team-score movement was 0.2951 points and maximum probability movement was 1.5189 percentage points, retaining natural decimal precision. Public evidence was support 7 / resistance 2 / neutral 174 / unknown 26; 86 games had public-split forecasts, but only seven received a nonzero split shift. Three evaluated quotes changed and 201 complete side/grade/quote tuples were unchanged. The sole side change was a weak WYO/CSU spread that remained No Play with negative exact-price economics.
- Runtime authority: `lib/services/football/cfbMarketSharpAwareShadow.ts`, `lib/services/football/footballOutcomeMarketMovement.ts`, `lib/services/football/cfbV1Decision.ts`, `lib/services/football/cfbForwardEvidenceWriter.ts`, `lib/services/football/cfbMemberFixture.ts`, and `lib/services/football/cfbOfficialTrackingRecord.ts`. Evidence: `docs/model-audits/2026-09-01-cfb-coherent-market-evidence-predeclaration.md` and `docs/model-audits/2026-09-01-cfb-coherent-market-evidence-result.md`. Roll back the complete forecast/publication set to r48 below; never reinterpret or replace an existing locked payload.

### Verified kickoff-weather forecast input (r48)

- Active production release: `cfb_market_sharp_aware_production_2026_08_31_r12_kickoff_weather`. The forecast retains the r47 architecture and inputs: 25% immutable football mass, 75% canonical current-market mass, strict fresh Circa priority, lower-strength bounded Playbook public consensus, and exact Playbook event identity. Verified adverse kickoff weather now adjusts only the independent Total PMF before that mixture. Playbook supplies an exact home-venue identity and coordinates; OpenWeather supplies the forecast nearest kickoff. Wind applies -1/-2/-3 independent total points at 15/20/25 mph, qualifying adverse precipitation and temperature <=25 F each add -0.5, and the total adjustment is capped at -3 with no positive adjustment. The PMF tilt preserves each home-margin group's complete probability mass.
- Active model set: score runtime `cfb_v1_joint_score_runtime_2026_08_31_r11_kickoff_weather`; model / distribution / probability / representative score `cfb_v1_market_sharp_score_model_2026_08_31_r10_kickoff_weather` / `cfb_v1_market_sharp_joint_distribution_2026_08_31_r8_kickoff_weather` / `cfb_v1_market_sharp_joint_probability_2026_08_31_r9_kickoff_weather` / `cfb_v1_market_sharp_reachable_score_2026_08_31_r8_kickoff_weather`; calibration / grade policy remain `cfb_v1_market_sharp_exact_price_calibration_2026_08_31_r7_playbook_event_identity` / `cfb_v1_composite_grade_policy_2026_08_31_r6_playbook_event_identity`; decision / tuple are `cfb_v1_daily_edge_decision_2026_08_31_r25_kickoff_weather` / `cfb_v1_exact_price_decision_tuple_2026_08_31_r18_kickoff_weather`.
- Active publication set: evidence / collector / member `cfb_forward_evidence_snapshot_2026_08_31_r18_kickoff_weather` / `cfb_forward_evidence_collector_2026_08_31_r25_kickoff_weather` / `cfb_v1_member_release_2026_08_31_r27_kickoff_weather`; writer `cfb_forward_evidence_writer_2026_08_31_r38_kickoff_weather`; fixture / outcome `cfb_v1_member_fixture_2026_08_31_r40_team_identity` / `cfb_market_sharp_public_outcome_contract_2026_08_31_r40_team_identity`; tracking `cfb_official_tracking_record_2026_08_31_r12_kickoff_weather`; weather `cfb_kickoff_weather_2026_08_31_r1_exact_venue_game_time`. Fixture r40 adds the provider's full school/team names plus a static, exact-identity ESPN logo/color catalog for all 212 teams on the current weekly board. It never guesses an MLB/NFL identity, adds no runtime provider call, and changes no prediction, grade, price, split, lock, or tracking behavior.
- Read-only current-slate replay: 87 FBS-involved games, 49 forecast-available, one controlled indoor and 37 outside the provider horizon. Six games received a bounded negative total adjustment; maximum authoritative expected-total movement was 0.3676 points. Across 166 comparable exact-price markets, **13 Best Angles / 31 Leans / 76 Watchlists / 46 No Plays** became **12 / 32 / 76 / 46**. Actionables remained 44, with zero promotions, one same-book Best Angle-to-Lean demotion, and zero side changes. Synthetic tests prove an economically qualified weather-supported Under may promote or reverse a prediction; there is no quota or one-way demotion rule.
- Weather evaluation holds the same-snapshot no-weather target sportsbook fixed so a probability change cannot improve a grade merely by rotating to a different price. The final decision still recomputes one coherent side, probability, exact named-book line/price, edge, EV, and grade. Fixed roofs are neutral; neutral sites, ambiguous/missing venues, stale/out-of-horizon forecasts and provider failures apply zero adjustment and never hold a prediction. T-60 always refreshes; existing locked rows remain immutable. Playbook currently supplies no timestamped NCAAF injury report, so injury context remains explicitly unavailable rather than inferred or held. Writer ownership, the sole `prediction_pipeline:cfb` lease, weekly scope, public/Circa semantics, thresholds and stakes remain unchanged. Evidence: `docs/model-audits/2026-08-31-cfb-kickoff-weather-predeclaration.md` and `docs/model-audits/2026-08-31-cfb-kickoff-weather.md`. Rollback is the complete r47 release below.

### Playbook event-identity repair (r47)

- Active production release: `cfb_market_sharp_aware_production_2026_08_31_r11_playbook_event_identity`. The forecast remains the r46 authoritative-PMF architecture: 25% immutable football mass, 75% canonical current-market mass, strict fresh Circa priority, and lower-strength bounded Playbook public consensus. The repaired input boundary maps only verified Playbook school-name variants to exact BALLDONTLIE NCAAF team IDs, then requires both teams, kickoff proximity, one unambiguous Playbook event ID, and the same event ID in the separately returned line and split payloads. Mascot-only, edit-distance, reversed-side, duplicate-event, and cross-endpoint guesses fail closed.
- Active model set: score runtime `cfb_v1_joint_score_runtime_2026_08_31_r10_playbook_event_identity`; model / distribution / probability / representative score `cfb_v1_market_sharp_score_model_2026_08_31_r9_playbook_event_identity` / `cfb_v1_market_sharp_joint_distribution_2026_08_31_r7_playbook_event_identity` / `cfb_v1_market_sharp_joint_probability_2026_08_31_r8_playbook_event_identity` / `cfb_v1_market_sharp_reachable_score_2026_08_31_r7_playbook_event_identity`; calibration / grade policy `cfb_v1_market_sharp_exact_price_calibration_2026_08_31_r7_playbook_event_identity` / `cfb_v1_composite_grade_policy_2026_08_31_r6_playbook_event_identity`; decision / tuple `cfb_v1_daily_edge_decision_2026_08_31_r24_playbook_event_identity` / `cfb_v1_exact_price_decision_tuple_2026_08_31_r17_playbook_event_identity`.
- Active publication set: evidence / collector / member `cfb_forward_evidence_snapshot_2026_08_31_r17_playbook_event_identity` / `cfb_forward_evidence_collector_2026_08_31_r24_playbook_event_identity` / `cfb_v1_member_release_2026_08_31_r26_playbook_event_identity`; writer `cfb_forward_evidence_writer_2026_08_31_r37_playbook_event_identity`; fixture / outcome `cfb_v1_member_fixture_2026_08_31_r38_playbook_event_identity`; tracking `cfb_official_tracking_record_2026_08_31_r11_playbook_event_identity`.
- Read-only same-snapshot replay at `2026-08-31T15:52:41.703Z`: FBS-involved Playbook coverage rises from 76/87 to 86/87 games. The ten recovered identities are SHSU@TROY, UALB@BUF, NICH@KSU, HCU@RICE, ME@APP, YSU@UK, CIT@CLT, ALCN@USM, SELA@USA, and LIU@KU. HAMP@MD is genuinely absent from the 103-row Playbook feed. Across 165 comparable exact-price markets the board remains **13 Best Angles / 30 Leans / 76 Watchlists / 46 No Plays**: zero promotions, zero demotions, zero side changes, and 43 actionables before and after. The recovered evidence is neutral on this capture, proving the repair fills a real input gap without manufacturing picks.
- Writer ownership, two existing Playbook calls, provider budget, PMF weights, split-strength bounds, thresholds, stakes, weekly scope, locks, settlement, and the sole `prediction_pipeline:cfb` lease are unchanged. Missing Playbook evidence remains an unknown zero adjustment and never holds a projection. Existing r16/r25/r23 rows remain the complete transition base; immutable T-60/started rows retain their original release and tuple. Rollback is the complete r46 set below. Evidence: `docs/model-audits/2026-08-31-cfb-playbook-event-identity-predeclaration.md` and `docs/model-audits/2026-08-31-cfb-playbook-event-identity.md`.

### Authoritative-PMF exact-price calibration (r46)

- Active production release: `cfb_market_sharp_aware_production_2026_08_31_r10_authoritative_pmf_calibration`. The r45 one-PMF forecast remains unchanged: 25% immutable football mass, 75% canonical current-market mass, strict fresh Circa priority, and lower-strength bounded public-consensus support/resistance. The exact-price layer no longer applies the obsolete 2022 independent-model nonlinear calibration to that already-adjusted PMF. `cfb_v1_market_sharp_exact_price_calibration_2026_08_31_r6_authoritative_pmf_identity` reads each side probability directly from the authoritative joint PMF and compares it with target-excluded same-line consensus for edge/EV. It does not blend the consensus into the model a second time.
- Active decision set: grade policy `cfb_v1_composite_grade_policy_2026_08_31_r5_authoritative_pmf_calibration`; decision / tuple `cfb_v1_daily_edge_decision_2026_08_31_r23_authoritative_pmf_calibration` / `cfb_v1_exact_price_decision_tuple_2026_08_31_r16_authoritative_pmf_calibration`; evidence / collector / member `cfb_forward_evidence_snapshot_2026_08_31_r16_authoritative_pmf_calibration` / `cfb_forward_evidence_collector_2026_08_31_r23_authoritative_pmf_calibration` / `cfb_v1_member_release_2026_08_31_r25_authoritative_pmf_calibration`; writer `cfb_forward_evidence_writer_2026_08_31_r36_authoritative_pmf_calibration`; fixture / outcome `cfb_v1_member_fixture_2026_08_31_r37_authoritative_pmf_calibration`; tracking `cfb_official_tracking_record_2026_08_31_r10_authoritative_pmf_calibration`.
- Read-only current-slate replay at `2026-08-31T14:35:39.385Z`: 87 FBS games, 81 anchored games and 158 comparable markets move from **1 Best Angle / 24 Leans / 87 Watchlists / 46 No Plays** to **14 / 34 / 65 / 45**. Actionable counts move 25→48 (Moneyline 0→5, Spread 13→17, Total 12→26), with 66 promotions, 39 demotions, zero side changes and 45 No Plays retained. The output is not quota-calibrated; every action still requires the existing exact quote, positive economics and resistance gates. CFB has no reliable league-wide timestamped injury feed, so missing health is labeled rather than inferred. Missing/unconfirmed QB context cannot suppress the game projection.
- Evidence and rollback: `docs/model-audits/2026-08-31-football-vacation-readiness-predeclaration.md` and `docs/model-audits/2026-08-31-football-vacation-readiness.md`. Rollback is the complete r45 public-consensus release set immediately below.

### Public-consensus market input authority (r45)

- Owner-authorized production candidate: `cfb_market_sharp_aware_production_2026_08_31_r9_public_consensus_market_input`. The authoritative PMF retains the r44 25% immutable independent-football / 75% canonical current-market mixture. Existing Playbook public ticket/handle data is now a separately labeled lower-strength input rather than display-only context: same-game, pre-evaluation, cadence-fresh money-minus-ticket divergence outside an 8pp neutral band may move the canonical anchor by at most 0.75 margin or Total points, with Spread/Total requiring the Playbook context line within 0.5 points of the canonical line. Strictly matched fresh Circa remains stronger at the existing 1.5-point maximum. When both qualify, Circa owns the full primary shift, public consensus contributes at half strength, the combined shift remains capped at 1.5 points, and opposing public data cannot reverse Circa's direction. Public consensus is never relabeled verified sharp evidence. Every expected score, reachable score, winner probability, exact-line probability, side, EV, and grade is recomputed from the one adjusted PMF; no reader override exists.
- Active model set: score runtime `cfb_v1_joint_score_runtime_2026_08_31_r9_public_consensus_market_input`; model / distribution / probability / representative score `cfb_v1_market_sharp_score_model_2026_08_31_r8_public_consensus_market_input` / `cfb_v1_market_sharp_joint_distribution_2026_08_31_r6_public_consensus_market_input` / `cfb_v1_market_sharp_joint_probability_2026_08_31_r7_public_consensus_market_input` / `cfb_v1_market_sharp_reachable_score_2026_08_31_r6_public_consensus_market_input`; calibration / grade policy `cfb_v1_market_sharp_exact_price_calibration_2026_08_31_r5_public_consensus_market_input` / `cfb_v1_composite_grade_policy_2026_08_31_r4_public_consensus_market_input`; decision / tuple schema `cfb_v1_daily_edge_decision_2026_08_31_r22_public_consensus_market_input` / `cfb_v1_exact_price_decision_tuple_2026_08_31_r15_public_consensus_market_input`; public outcome `cfb_market_sharp_public_outcome_contract_2026_08_31_r36_public_consensus_market_input`.
- Active publication set: evidence schema / collector / member `cfb_forward_evidence_snapshot_2026_08_31_r15_public_consensus_market_input` / `cfb_forward_evidence_collector_2026_08_31_r22_public_consensus_market_input` / `cfb_v1_member_release_2026_08_31_r24_public_consensus_market_input`; writer / fixture `cfb_forward_evidence_writer_2026_08_31_r35_public_consensus_market_input` / `cfb_v1_member_fixture_2026_08_31_r36_public_consensus_market_input`; tracking `cfb_official_tracking_record_2026_08_31_r9_public_consensus_market_input`; presentation `daily_edge_member_presentation_2026_08_31_r22_cfb_public_consensus_market_input`. The existing writer remains sole authority under `prediction_pipeline:cfb`; provider calls, tables, cron ownership, stakes, T-60, locks, and settlement are unchanged. Prior r14/r23/r21 rows remain a readable immutable transition base.
- Grade ladder: every r44 path remains, with three bounded exact-economics additions after resistance checks. A complete Moneyline Watchlist may become Lean at model probability >=55%, target-excluded edge >=2pp, EV >=1%, and price -300..+300. A Spread from 10.5 through 24 points may become Lean only at probability >=54%, edge >=3pp, EV >=3%, and price -500..+500. The existing Total Watchlist lane retains probability >=52% and EV >=1.5% while its edge floor is 2pp. Strong public resistance (12pp), strict Circa resistance, or same-book resistance blocks each promotion and can demote action immediately; public support may promote only a complete positive-EV near-threshold tuple. No rule creates or increases a stake.
- Frozen 2026-08-31 08:54:48Z current-slate replay: 87 FBS-involved games, 81 anchored games, 162 comparable exact-price markets, and six game-scoped missing-anchor holds. The same tuples move from **1 Best Angle / 18 Leans / 97 Watchlists / 46 No Plays** to **1 / 23 / 92 / 46**: five Watchlist-to-Lean promotions, zero demotions, zero side changes, zero quote changes, and 157 unchanged tuples. Promotions are OKST@TLSA Tulsa +14, NIU@IOWA Over 46.5, EKU@JXST Jacksonville State -20.5, WKU@NEV Under 52.5, and WIS@ND Notre Dame -20.5. All have positive exact-price EV and no resistance. Public evidence is support/resistance/neutral/unknown on 3/1/142/16 comparable markets; the sparse strong-gap count is why public splits improve projections without manufacturing a board quota. This is an outcome-free current-slate impact audit, not a performance claim.
- Rollback is the complete r44/r8 release set below. Roll back on mixed release tuples, missing evidence presented as a normal evaluation, provider/load growth, a writer/reader crash, lock or tracking incoherence, public data relabeled as verified sharp, or an unexplained actionable collapse. Evidence: `docs/model-audits/2026-08-31-cfb-public-splits-actionability-predeclaration.md` and `docs/model-audits/2026-08-31-cfb-public-splits-actionability.md`.

### Preceding market-dominant, fresh-sharp authority (r44 probability-bound recovery)

- Preceding owner-authorized production candidate: `cfb_market_sharp_aware_production_2026_08_30_r8_missing_anchor_game_hold`, under the Aug. 30 owner amendment in `docs/model-change-safety.md`. The authoritative joint PMF is exactly 25% immutable independent-football mass and 75% canonical current-market mass when a canonical market anchor exists. A strictly identified Circa split may adjust the market anchor only when it is no more than 120 minutes old, not observed after the writer evaluation, and within 0.5 points of the canonical Spread or Total line. A qualifying money-minus-ticket gap may move the pre-mixture anchor by at most 1.5 home-margin points or 1.5 Total points. Current consensus movement is not separately added because the current line already contains it. Every expected score, reachable score, winner probability, exact-line probability, prediction side, EV, and grade is recomputed from the one PMF; no reader override exists. Winner probability is clamped to the mathematical unit interval only when floating-point summation is within `1e-12` of an endpoint; a materially invalid probability still fails closed. If one scheduled game has no canonical anchor from any strictly identified provider, its immutable independent-football PMF remains the visible game projection while all three price-dependent Bet grades are held with an explicit availability reason; that game can no longer abort the otherwise coherent atomic weekly wave. The separately stored independent PMF remains diagnostic baseline provenance on anchored games.
- Active model set: score runtime `cfb_v1_joint_score_runtime_2026_08_30_r8_unit_probability_bound`; model / distribution / probability / representative score `cfb_v1_market_sharp_score_model_2026_08_30_r7_missing_anchor_game_hold` / `cfb_v1_market_sharp_joint_distribution_2026_08_30_r5_market_dominant_fresh_sharp` / `cfb_v1_market_sharp_joint_probability_2026_08_30_r6_unit_probability_bound` / `cfb_v1_market_sharp_reachable_score_2026_08_30_r5_market_dominant_fresh_sharp`; calibration `cfb_v1_market_sharp_exact_price_calibration_2026_08_30_r4_market_dominant_fresh_sharp`; grade policy remains `cfb_v1_composite_grade_policy_2026_08_29_r3_transition_coherent`; decision / tuple schema `cfb_v1_daily_edge_decision_2026_08_30_r21_missing_anchor_game_hold` / `cfb_v1_exact_price_decision_tuple_2026_08_30_r14_missing_anchor_game_hold`; public outcome `cfb_market_sharp_public_outcome_contract_2026_08_30_r35_missing_anchor_game_hold`.
- Active publication set: evidence schema / collector / member remain `cfb_forward_evidence_snapshot_2026_08_30_r14_market_dominant_fresh_sharp` / `cfb_forward_evidence_collector_2026_08_30_r21_market_dominant_fresh_sharp` / `cfb_v1_member_release_2026_08_30_r23_market_dominant_fresh_sharp`; writer / fixture are `cfb_forward_evidence_writer_2026_08_30_r34_missing_anchor_game_hold` / `cfb_v1_member_fixture_2026_08_30_r35_paged_evidence_read`; tracking `cfb_official_tracking_record_2026_08_30_r8_missing_anchor_game_hold`; presentation `daily_edge_member_presentation_2026_08_30_r21_cfb_market_dominant_fresh_sharp`. Cross-market validation release `football_cross_market_coherence_2026_08_30_r5_verified_pmf_endpoints` permits exact 0/1 winner probabilities only for the explicit CFB writer call and only when the supplied normalized joint PMF independently proves mass, score identity, and the same winner probability; NFL and all default callers retain open-interval enforcement. A Total `No Play` with negative EV is withheld as an explicit near-toss-up coherence hold only when its PMF advantage is at most one percentage point, the PMF side conflicts with the mean direction, and the mean is no more than 0.5 points from the exact line; its Total outlook is also withheld so the reader cannot show a contradictory prediction. Actionable or positive-EV Totals and wider/probabilistically stronger disagreements remain fail-closed. A missing canonical market anchor is now a game-scoped availability hold rather than a slate-fatal exception: it publishes the independent football projection, creates no exact-price tuple, stake, lock, or tracking row, and cannot authorize a guessed Sharp event. The evidence reader uses stable 1,000-row pages with a 50,000-row explicit hard cap; it cannot silently truncate the current 106-game wave at Supabase's default first page. The existing forward-evidence writer remains the sole writer under `prediction_pipeline:cfb` and makes one atomic append only after all covered-game coherence gates pass.
- The Aug. 29 locked SELECT-only replay covers 8 FBS-involved games and 17 priced markets. Relative to r42 it changes two selected sides, produces 0 Best Angles / 2 Leans / 7 Watchlists / 8 evaluated No Plays, and changes the actionable count from three to two. That is zero grade promotions, four demotions, and net -1 actionable, with no stake path. It is a transparent board-impact result, not a performance claim; the candidate was not chosen to reverse Aug. 29 outcomes. The frozen 2023-2025 synchronized audit showed the independent-heavy mean blend increased Total and Margin MAE relative to the market benchmark, while exact forward release-separated T-60 results remain the post-deploy evaluation.
- Actionable ladder: after all existing probability grades and strict sharp/movement resistance checks, a complete Lean becomes Best Angle only at model probability >=55%, target-excluded edge >=5pp, EV >=6%, and exact price from -500 through +500. A complete Spread Watchlist becomes Lean only at model probability >=53%, edge >=2.5pp, EV >=2%, absolute line <=10, the same price band, and no resistance. A complete Total Watchlist becomes Lean only at model probability >=52%, edge >=2.5pp, EV >=1.5%, the same price band, and no resistance. The older bounded spread path uses that same owner-approved price band rather than the rejected -125 through +125 band. The frozen 15:56:08Z r12 FBS wave has 20 evaluated tuples and moves from **0 Best Angles / 2 Leans / 12 Watchlists / 6 No Plays** to **2 / 4 / 8 / 6**: six tier promotions, two resistance demotions, and four additional actionables. The two Best Angles are the already-actionable USC Under and NDSU Over; NDSU -6.5, UNLV -4, NMSU Under 53.5, and Hawaii Under 48.5 become Leans. UVA -4 remains Watchlist because the correctly mapped NCSU-heavy sharp split resists UVA. These counts are a frozen replay result, not a target, quota, or forced live distribution. No rule creates or increases a stake.
- Transition and rollback: r14/r23/r21 becomes readable only as one complete release wave, except that exact valid immutable T-60/started rows from preceding authorities or earlier releases may retain their original releases and values. A held legacy T-60 does not satisfy the new lock boundary. Official tracking accepts only exact r14/r23/r21/r8 T-60 payloads for the new era; preceding prediction records remain immutable under their original releases. Mixed releases, stale/future sharp influence, incoherence, a writer/reader crash, failed future T-60 creation, a reader pagination hard-cap failure, or a material public tuple mismatch triggers rollback to r14/r23/r20. An unavailable canonical anchor now holds only the affected game's unlocked exact-price markets and is not itself a whole-wave rollback condition. Evidence: `docs/model-audits/2026-08-30-cfb-evidence-reader-pagination-hotfix.md`, `docs/model-audits/2026-08-30-cfb-missing-canonical-anchor-publication-hotfix.md`, `docs/model-audits/2026-08-30-cfb-unit-probability-bound-hotfix.md`, `docs/model-audits/2026-08-30-cfb-market-dominant-sharp-forecast-predeclaration.md`, the frozen forecast-accuracy audit, and the prior r41/r42 audits.

The bullets below record the preceding r29/r15 rollback era and its historical validation. Where an identifier or behavior conflicts with the r41 authority above, it is inactive rollback provenance, not current runtime authority.

- Preceding public outcome contract: `cfb_independent_public_outcome_contract_2026_08_28_r29`. The football-only artifact / model / distribution / probability / representative-score releases are `cfb_v1_joint_score_artifact_2026_08_28_r4_directional_pmf` / `cfb_v1_independent_score_model_2026_08_28_r2_directional_pmf` / `cfb_v1_empirical_joint_score_distribution_2026_08_28_r2_directional_pmf` / `cfb_v1_joint_market_probability_2026_08_28_r2_directional_pmf` / `cfb_v1_central_reachable_score_2026_08_28_r2_directional_pmf`. These releases remain the immutable independent baseline and rollback source.
- Preceding grade / decision releases: `cfb_v1_composite_grade_policy_2026_08_25_r1` / `cfb_v1_daily_edge_decision_2026_08_28_r15_ambiguous_event_scope` using tuple schema `cfb_v1_exact_price_decision_tuple_2026_08_28_r9_ambiguous_event_scope`. They remain the rollback set; exact-price identity, market-scoped quote completeness, no fabricated tuples, and no reader override continue in r41.
- Chronological forecast evidence: 2021-22 train, 2023 select, 2024/25 repeated confirmation. 2024/25 team-score MAE was 9.501/9.218, margin MAE 13.956/13.368, total MAE 12.830/12.640, ML Brier 0.17902/0.16905, ECE 0.03867/0.03925, and winner accuracy 72.46%/74.84%. The independent head materially beat the frozen simple-football baseline in both confirmation seasons.
- Chronological grading evidence: ML Lean recorded +11.161u/+31.00% in 2024 and +12.061u/+35.47% in 2025; Spread Lean +9.818u/+27.27% and +19.455u/+57.22%; Total Lean +39.455u/+10.63% and +5.182u/+1.20%. Largest-win-removed and weekly-cluster gates passed for the qualified lanes. Historical Spread/Total execution is fixed -110 and historical ML prices are synthetic, so no historical CLV claim is made; immutable 2026 exact-price tuples are the true forward holdout.
- The 19:09 ET pre-r35 SELECT-only audit reads 367 immutable rows and atomically selects 38 unique games / 114 market slots: 35 current r32 rows plus the last immutable pregame rows for the three games that had already started. It contains 23 exact tuples: **2 Best Angles / 2 Leans / 10 Watchlists / 9 evaluated No Plays**, with 91 market-scoped unavailable states. FBS-vs-FBS coverage is 15 evaluated / 3 unavailable; all three FBS unavailable states are SJSU-USC after duplicate strict-identity catalog rows caused the prior r10 ambiguity guard to suppress its exact-event read. r35 restores only that discovery path and does not alter prediction, calibration, threshold, or grade formulas. The post-deploy natural wave must restore current USC Spread/Total tuples while retaining an honest Moneyline No Play if no coherent pair is offered. Hawaii-Stanford, Virginia-NC State, and all other released independent PMF directions remain unchanged. Strict Sharp splits currently match 2/38 games and unmatched rows never render.
- The 20:45 ET r36 SELECT-only candidate replay selects the untouched successful 20:39 ET wave as 33 r20 rows, three already-started immutable r15 rows, and two immutable r19 rows including WEB-UNCO's future T-60 lock: **38 unique games / 114 market slots, 35 evaluated tuples / 79 unavailable, 5 Best Angles / 2 Leans / 11 Watchlists / 17 evaluated No Plays**. USC is restored at FanDuel as SJSU +38.5 -104 No Play and Under 61.5 -110 Best Angle; Moneyline alone remains unavailable. The independent SJSU 16-USC 39 representative score predicts those same Spread and Total directions. Six strict split games match and unmatched rows remain hidden. This is a fixture selection correction with zero recomputation of existing tuples or grades.
- Weekly continuity: `cfb_weekly_window_2026_08_30_r3_completed_slate_roll_forward` normally selects the Eastern Thursday-through-Monday window anchored by each Tuesday, but advances to the next week as soon as the current authoritative opening wave is complete and every captured kickoff has passed. Empty or incomplete evidence and any future captured game—including a Monday game—keep the current window, so a missing row cannot cause premature rollover. The provider query remains the same bounded UTC-safe range. The writer includes every provider-scheduled NCAAF matchup whose two team identities resolve unambiguously to the qualified 256-team artifact, including model-covered FCS-only games. Unknown/ambiguous team identities are excluded instead of neutral-imputed into the betting board. A game first discovered after kickoff is not backfilled, while a game with existing immutable evidence remains inside normal lifecycle handling. There is no artifact game-ID allowlist. Collection cadence, opening completeness, release refresh, and member completeness are scoped to those selected-window IDs; prior-week evidence remains immutable but cannot inflate the selected slate.
- Week-ahead capacity: the strict split client is `cfb_sharpapi_splits_2026_08_30_r2_full_week_capacity`. It raises only the in-memory exact-game matching circuit breaker from 96 to 128 while retaining one bounded 200-row league request, strict team/date identity, and the same no-match behavior. A read-only Aug. 30 provider inventory found 132 scheduled games, 106 qualified model-covered games, 87 FBS-involved model-covered games, and 78 model-covered games needing the separately capped Sharp price fallback. Thus the 106-game next window fits both the 128-game split matcher and the unchanged 96-game price-fallback circuit breaker. Per-game market/sharp forecast math, the r43 75/25 mixture, sharp freshness/line gates, grades, stake, lock, and tracking contracts are unchanged.
- Prior-result continuity: writer r30 replaces the provider-ignored `game_ids[]` filter on the NCAAF games collection with the provider-supported persisted `dates[]` filter, in bounded groups of at most three dates and 100 exact requested IDs. Returned rows are still retained only when their provider ID is in the requested set. This fixes the natural Aug. 30 r29 pagination-budget failure before any evidence was written. It supplies the already-versioned leakage-safe rolling feature path with the exact prior completed games it was designed to consume; no feature formula, model coefficient, market/sharp mixture, grade, stake, lock, or tracking rule changes.
- Writer and provider boundary: BALLDONTLIE slate `balldontlie_ncaaf_slate_2026_08_28_r3_display_quote_coverage`; Sharp price fallback `cfb_sharpapi_named_book_fallback_2026_08_28_r11_prior_event_disambiguation`; strict split client `cfb_sharpapi_splits_2026_08_28_r1_strict_identity`; evidence schema / collector / member / writer `cfb_forward_evidence_snapshot_2026_08_28_r11_prior_event_disambiguation` / `cfb_forward_evidence_collector_2026_08_28_r18_prior_event_disambiguation` / `cfb_v1_member_release_2026_08_28_r20_prior_event_disambiguation` / `cfb_forward_evidence_writer_2026_08_28_r25_owner_cadence`. Member fixture release is `cfb_v1_member_fixture_2026_08_29_r26_fbs_board_scope`. The append-only table schema is unchanged. If the current provider catalog contains multiple strict team/time event matches, r11 may select one only when all immutable prior Sharp odds observations for that provider game prove the same event ID and that ID remains one of the current strict matches. Otherwise it makes zero odds calls for that ambiguous game. It never guesses an ID, selects by suffix, or probes every duplicate candidate; one canonical ID reused across different games remains fatal. Pagination, the 192-request cap, one all-game append, and the sole `prediction_pipeline:cfb` lease remain unchanged. R37 changes each unlocked game's cadence to six hours beyond 48 hours and one hour inside 48 hours; one near game cannot force a distant sibling into an hourly evidence capture, and a newer near-game observation cannot mask a due distant game. Event-triggered T-60 behavior remains unchanged. Release refresh still takes planning priority over ordinary cadence without overriding a due game's T-60 stage. The writer consumes every verified named-book observation for display while only the established target cohort can grade, preserves one-sided offers as context, rejects representative-market outliers, applies the same strict cross-market coherence assertion, makes one league-level strict split request, and never lets missing Moneyline suppress coherent Spread/Total evidence. Circa remains the first split source; the existing complete DraftKings fill-in occupies the same Sharp Book Splits card only until Circa is current. Playbook remains separate Public Consensus. R37 changes collection timing and its member-facing description only; it changes no prediction, decision, grade, stake, lock, or tracking formula. Fixture r26 adds one derived `fbs_involved` / `fcs_only` reader classification from the already-verified team metadata; it does not change writer scope or evidence.
- Official tracking: `cfb_official_tracking_record_2026_08_26_r2_market_scoped_t60` begins forward-only on the 2026-08-29 ET slate. Each coherent exact-price market frozen at T-60 no more than 20 minutes late can enter `prediction_records`; an internally held/unavailable sibling cannot block it. Zero coherent decisions and global health failures remain ineligible, duplicate/unsupported markets fail closed, retry keys are market-scoped and idempotent, and unlocked grades are never counted. No historical backfill is authorized. Postgame score ingest release `cfb_score_ingest_2026_08_30_r2_supported_date_filter` derives at most three UTC provider dates from the persisted scheduled starts, uses BALLDONTLIE's supported `dates[]` games filter, and then retains only exact requested provider IDs before the existing deterministic grader runs. It changes no immutable prediction tuple or grade policy. Evidence: `docs/model-audits/2026-08-26-football-market-scoped-t60-predeclaration.md` and `docs/model-audits/2026-08-30-cfb-tracking-settlement-hotfix.md`.
- Reader/rollback: member fixture `cfb_v1_member_fixture_2026_08_29_r26_fbs_board_scope`, public outcome contract `cfb_independent_public_outcome_contract_2026_08_28_r29`, and `daily_edge_weekly_reader_lifecycle_2026_08_25_r3_cfb` keep the mature MLB Daily Edge shell. A complete current wave still wins. During a one-way release transition, a partial current release may replace matching rows in the exact preceding atomic board only when every missing game has already started or is represented by an immutable T-60 row. Each carried row retains its original immutable releases and values; a future unlocked gap still rejects the partial wave. This publishes the successful 20:39 ET r20 wave as 33 r20 rows plus the exact prior locked/started rows without overwriting a lock or hiding current USC evidence. Quick Read, exact prices/movement, public and Sharp split cards, common grade ladder, independent PMF prediction surfaces, explicit per-market No Play reasons, and responsive desktop/mobile behavior remain unchanged. Roll back fixture to r25 and presentation to r16.
- Shared presentation release `daily_edge_member_presentation_2026_08_29_r17_cfb_fbs_default_board` and board-scope release `cfb_member_board_scope_2026_08_29_r1_fbs_default` retain the independent-PMF prediction and exact-price Quick Read contracts from r16 while making FBS-involved games the default CFB member board. An explicit **All Division I** control exposes every model-covered FCS-only forecast, and a direct URL to an FCS-only game opens the complete Division I scope. The audited 38-game slate therefore opens on all 8 FBS-involved games rather than 30 FCS-only games, 24 of which have no evaluated market. The FBS default contains 17 evaluated tuples / 1 unavailable state across FBS-vs-FBS games plus 6 evaluated tuples across FBS-vs-FCS games: **2 Best Angles / 2 Leans / 9 Watchlists / 10 evaluated No Plays** over 24 market slots, with the one unavailable state remaining explicit. The underlying all-Division-I board remains **5 Best Angles / 2 Leans / 11 Watchlists / 17 evaluated No Plays / 79 unavailable states**. This is zero tuple additions/removals, zero side changes, zero promotions, zero demotions, zero net actionable change, and zero change to probability formulas, grade thresholds, writer scope, stakes, locks, or tracking rules.
- Runtime authority: `lib/services/football/cfbV1Decision.ts`, `lib/services/football/cfbV1WeeklyForecast.ts`, `lib/services/football/cfbMarketInformedOutcome.ts` (shadow market context only), `lib/services/football/footballCrossMarketCoherence.ts`, `lib/services/football/cfbWeeklyWindow.ts`, `lib/services/football/cfbForwardEvidenceWriter.ts`, `lib/services/football/cfbSharpApiOdds.ts`, `lib/services/football/cfbSharpApiSplits.ts`, `lib/services/football/footballMarketScopedTracking.ts`, `lib/services/football/cfbOfficialTrackingRecord.ts`, `lib/services/football/cfbMemberFixture.ts`, `app/lab/lib/cfbBoardScope.ts`, and the versioned score/weekly/grade/market-residual JSON artifacts. Evidence includes `docs/model-audits/2026-08-29-cfb-fbs-first-member-board-r39-predeclaration.md`, `docs/model-audits/2026-08-29-cfb-fbs-first-member-board-r39.md`, `docs/model-audits/2026-08-28-cfb-immutable-boundary-transition-r36-predeclaration.md`, `docs/model-audits/2026-08-28-cfb-immutable-boundary-transition-r36.md`, `docs/model-audits/2026-08-28-cfb-event-discovery-pagination-r31-predeclaration.md`, `docs/model-audits/2026-08-28-cfb-event-discovery-pagination-r31.md`, `docs/model-audits/2026-08-28-cfb-independent-public-prediction-r29-predeclaration.md`, and the prior CFB model, price, tracking, split, weekly-window, and directional-PMF audits.

## NFL Player Props production release

- October 9 prospective all-prop market-observer capture: sole writer is `nfl_player_props_writer_2026_10_09_r47_market_observer_capture` and internal capture/schema are `nfl_player_props_market_observer_capture_2026_10_09_r1` / `nfl_props_market_observer_history_v1`. Only after the coherent member snapshot, locked tracking rows, closing prices, and settlement succeed, the writer appends already-built same-book true provider-opening, T-24, T-6, and T-60/lock tuples to the separate bounded key `nfl::player-props-market-observer::<season>::<week>`. The capture makes zero provider calls; never relabels first observed as opening; never constructs cross-book pairs or a fictitious post-T-60 close; is append-only, idempotent, source-time ordered, checksum-protected, and capped at 24,000 rows / 32 MB decoded / 2 MB gzip; and reports missingness per landmark. Capture failure is telemetry-only after every authoritative production write. Model, calibration, probability, projection, side, grade, board, member, tracking, schedule, cadence, provider calls, lock, settlement, stake, copy, label, and layout releases remain unchanged, and locked records retain exact precedence. Evidence: `docs/model-audits/2026-10-09-nfl-player-props-market-observer-2026-predeclaration.md` and `docs/model-audits/2026-10-09-nfl-player-props-market-observer-2026-result.md`.

- October 9 independent Receiving Yards point release: active portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking are `nfl_player_props_runtime_2026_10_09_r14_independent_receiving_yards` / `nfl_player_props_distribution_model_2026_10_09_r23_independent_receiving_yards` / `nfl_player_props_distribution_calibration_2026_10_09_r25_independent_receiving_yards` / `nfl_player_props_decision_2026_10_09_r28_independent_receiving_yards` / `nfl_player_props_runtime_2026_10_09_r29_independent_receiving_yards` / `nfl_player_props_board_2026_10_09_r32_independent_receiving_yards` / `nfl_player_props_member_2026_10_09_r40_independent_receiving_yards` / `nfl_player_props_member_lifecycle_2026_10_09_r23_independent_receiving_yards` / `nfl_player_props_writer_2026_10_09_r47_market_observer_capture` / `nfl_player_props_tracking_2026_10_09_r28_independent_receiving_yards`; expected-role artifact is `nfl_player_props_expected_role_runtime_2026_10_09_r6_receiving_yards`. For WR only, Receiving Yards is 50% of the preceding independent center plus 50% team target budget × roster-normalized target share × direct yards per target; RB/FB/TE retain the preceding center after the broad all-role candidate lost exact-2026 direction. Market numbers are absent from the point model and market reading remains downstream. The 2024 selection improves MAE/RMSE 19.95555/27.71746→19.79645/27.29791; 2025 confirmation improves 19.51859/27.00557→19.32055/26.58654 with a clustered MAE-delta interval of [-0.28946,-0.11193] and all four chronological segments improving. The diagnostic-led exact 72-scope 2026 gate improves 34.33198/52.42191→33.64446/51.69424 and direction 48.61%→50.00%; because current-season outcomes informed the role diagnosis, it is not represented as a pristine holdout. The disclosed market-influenced center remains better at 32.46086/46.92620. A scaled role probability challenger improves historical and exact-2026 Brier/log loss but reduces exact direction 51.39%→45.83%, so it ships with zero authority and the incumbent probability distribution remains active. On the 615-row same-input Week 5 replay, only Receiving Yards changes: 38 projections/probabilities, four forecast sides, one actionable promotion, zero actionable demotions, and actionables 0→1; all seven other families retain identical projections, probabilities, sides, and grades. The sole writer, shared lease, cadence, provider calls, grade thresholds, stakes, locks, settlement, copy, labels, and layout remain unchanged. Prior locked snapshots keep exact stored precedence. Evidence and rollback: `docs/model-audits/2026-10-08-nfl-player-props-receiving-yards-predeclaration.md`, `docs/model-audits/2026-10-08-nfl-player-props-receiving-yards-role-gate-predeclaration.md`, and `docs/model-audits/2026-10-09-nfl-player-props-receiving-yards-result.md`; roll back the complete Receiving Yards family to the October 8 independent Receptions family without rewriting locks.

- October 8 independent Receptions point release (superseded by the October 9 independent Receiving Yards release): portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking were `nfl_player_props_runtime_2026_10_08_r13_independent_receptions` / `nfl_player_props_distribution_model_2026_10_08_r22_independent_receptions` / `nfl_player_props_distribution_calibration_2026_10_08_r24_independent_receptions` / `nfl_player_props_decision_2026_10_08_r27_independent_receptions` / `nfl_player_props_runtime_2026_10_08_r28_independent_receptions` / `nfl_player_props_board_2026_10_08_r31_independent_receptions` / `nfl_player_props_member_2026_10_08_r39_independent_receptions` / `nfl_player_props_member_lifecycle_2026_10_08_r22_independent_receptions` / `nfl_player_props_writer_2026_10_08_r45_independent_receptions` / `nfl_player_props_tracking_2026_10_08_r27_independent_receptions`; expected-role artifact was `nfl_player_props_expected_role_runtime_2026_10_08_r5_receptions`. Receptions is 50% of the preceding independent center plus 50% team target budget × roster-normalized target share × position-group catch rate. Shifted volume, role, depth, availability, opponent, pressure, weather, PFR/FTN, and NGS context contains no line, price, book, consensus, movement, or market probability; target-book-excluded market reading remains downstream. The 2024 selection improves MAE/RMSE 1.53348/2.04388→1.50218/1.99196; 2025 confirmation improves 1.45991/1.92822→1.43812/1.89277 with a game-clustered MAE-delta interval of [-0.03066,-0.01317] and all four chronological segments improving. The exact 58-scope 2026 gate improves 2.09893/2.95017→1.99787/2.80472, reduces bias -1.15560→-0.94176, and preserves 48.28% direction; the disclosed market-influenced center remains better at 1.83633/2.60801. A negative-binomial probability challenger improves historical and exact-2026 scoring but fails the current-board anti-flattening gate by moving all eight preceding Receptions actionables to zero, so the reference probability remains authoritative with zero challenger weight. On the final 1,369-row Week 5 same-input board, only Receptions changes: 219/267 projections, seven forecast sides, one actionable promotion, three demotions, and Receptions actionables 8→6; all seven other families retain identical projections and grades. The sole writer, shared `prediction_pipeline:nfl` lease, cadence, provider calls, grade thresholds, stakes, locks, settlement, copy, labels, and layout remain unchanged. Prior locked snapshots keep exact stored precedence. Evidence and rollback: `docs/model-audits/2026-10-08-nfl-player-props-receptions-predeclaration.md` and `docs/model-audits/2026-10-08-nfl-player-props-receptions-result.md`; roll back the complete Receptions family to the independent Rushing Yards family without rewriting locks.

- October 8 independent Rushing Yards point release: active portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking are `nfl_player_props_runtime_2026_10_08_r12_independent_rushing_yards` / `nfl_player_props_distribution_model_2026_10_08_r21_independent_rushing_yards` / `nfl_player_props_distribution_calibration_2026_10_08_r23_independent_rushing_yards` / `nfl_player_props_decision_2026_10_08_r26_independent_rushing_yards` / `nfl_player_props_runtime_2026_10_08_r27_independent_rushing_yards` / `nfl_player_props_board_2026_10_08_r30_independent_rushing_yards` / `nfl_player_props_member_2026_10_08_r38_independent_rushing_yards` / `nfl_player_props_member_lifecycle_2026_10_08_r21_independent_rushing_yards` / `nfl_player_props_writer_2026_10_08_r44_independent_rushing_yards` / `nfl_player_props_tracking_2026_10_08_r26_independent_rushing_yards`; expected-role artifact is `nfl_player_props_expected_role_runtime_2026_10_08_r4_rushing_yards`. Rushing Yards is 25% of the preceding independent center plus 75% roster-constrained position-group rush opportunity × shifted yards per carry. It uses pregame player/team/opponent-front state, current rolling role, depth, weather, verified availability, PFR/FTN charting, and Next Gen Stats context without line, price, book, consensus, movement, or market probability. The 2024 selection improves MAE/RMSE 19.03715/27.39057→18.58703/26.48103; 2025 confirmation improves 18.55798/27.46852→18.06505/26.91924 with a game-clustered MAE-delta interval of [-0.74858,-0.23051] and all four chronological segments improving. The exact 28-scope 2026 gate improves the independent center 17.56553/24.94806→16.85919/23.44402, reduces bias -9.22039→-7.18411, and preserves 46.43% point direction; the disclosed market-influenced published benchmark remains better at 16.30374/22.44248. Twenty of 110 probability candidates qualify historically but none clears the exact-2026 Brier/log-loss/direction gate, so the independently fitted reference distribution remains with challenger weight zero. The 1,366-row frozen Week 5 same-input board changes only 22 of 160 Rushing Yards projections, zero forecast sides or grades, and retains five Rushing Yards / 40 complete-board actionables; every other family is byte-identical. The sole writer, shared `prediction_pipeline:nfl` lease, cadence, provider calls, grade thresholds, stakes, locks, settlement, copy, labels, and layout remain unchanged. Prior locked snapshots keep exact stored precedence. Evidence and rollback: `docs/model-audits/2026-10-08-nfl-player-props-rushing-yards-predeclaration.md` and `docs/model-audits/2026-10-08-nfl-player-props-rushing-yards-result.md`; roll back the complete Rushing Yards family to the independent Passing Yards family without rewriting locks.
- October 8 independent Passing Yards point release (preceding): portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking were `nfl_player_props_runtime_2026_10_08_r11_independent_passing_yards` / `nfl_player_props_distribution_model_2026_10_08_r20_independent_passing_yards` / `nfl_player_props_distribution_calibration_2026_10_08_r22_independent_passing_yards` / `nfl_player_props_decision_2026_10_08_r25_independent_passing_yards` / `nfl_player_props_runtime_2026_10_08_r26_independent_passing_yards` / `nfl_player_props_board_2026_10_08_r29_independent_passing_yards` / `nfl_player_props_member_2026_10_08_r37_independent_passing_yards` / `nfl_player_props_member_lifecycle_2026_10_08_r20_independent_passing_yards` / `nfl_player_props_writer_2026_10_08_r43_independent_passing_yards` / `nfl_player_props_tracking_2026_10_08_r25_independent_passing_yards`; expected-role artifact was `nfl_player_props_expected_role_runtime_2026_10_08_r3_passing_yards`. Passing Yards is released independent Passing Completions multiplied by a shifted, completion-exposure-weighted yards-per-completion model using pregame player/team/opponent state, depth, weather, and verified availability; it contains no line, price, book, consensus, movement, or market probability. Target-book-excluded market evidence remains downstream and cannot rewrite the independent point or probability. The 2024 selection improves MAE/RMSE 66.89048/86.61407→59.50102/76.03725; 2025 confirmation improves 67.22001/87.05953→58.43378/74.90711 with a game-clustered MAE-delta interval of [-12.32764,-5.44076] and all four chronological segments improving. The exact 14-scope 2026 gate improves point MAE/RMSE 83.16018/100.62751→67.26141/97.48492 and preserves 64.29% point direction. No new probability challenger ships: all 38 historically eligible challengers regress exact 2026 Brier or log loss, so the market-free reference head remains at 0.23314 Brier, 0.66261 log loss, and 64.29% direction with zero challenger weight. On the 760-row frozen Week 5 same-input board, all seven other families are byte-identical; Geno Smith Over 206.5 moves No Play→Watchlist and Jordan Love Over 233.5 moves No Play→Lean, producing one actionable promotion, zero demotions, and ten total actionables. The sole writer, shared `prediction_pipeline:nfl` lease, cadence, provider calls, grades, stakes, locks, settlement, copy, labels, and layout remain unchanged. Prior locked snapshots keep exact stored precedence. Evidence and rollback: `docs/model-audits/2026-10-08-nfl-player-props-passing-yards-predeclaration.md` and `docs/model-audits/2026-10-08-nfl-player-props-passing-yards-result.md`; roll back the complete Passing Yards family to the independent Passing Completions family without rewriting locks.

- October 8 independent Passing Completions release: active portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking are `nfl_player_props_runtime_2026_10_08_r10_independent_passing_completions` / `nfl_player_props_distribution_model_2026_10_08_r19_independent_passing_completions` / `nfl_player_props_distribution_calibration_2026_10_08_r21_independent_passing_completions` / `nfl_player_props_decision_2026_10_08_r24_independent_passing_completions` / `nfl_player_props_runtime_2026_10_08_r25_independent_passing_completions` / `nfl_player_props_board_2026_10_08_r28_independent_passing_completions` / `nfl_player_props_member_2026_10_08_r36_independent_passing_completions` / `nfl_player_props_member_lifecycle_2026_10_08_r19_independent_passing_completions` / `nfl_player_props_writer_2026_10_08_r42_independent_passing_completions` / `nfl_player_props_tracking_2026_10_08_r24_independent_passing_completions`; expected-role artifact is `nfl_player_props_expected_role_runtime_2026_10_08_r2_passing_completions`. Passing Completions is a market-free 25% preceding independent head / 75% team pass budget × lead-passer share × attempt-weighted completion-rate head with `completions <= attempts`; shifted player/team/opponent, pressure, PFR, FTN, NGS, depth, weather, and availability evidence contains no line, price, book, consensus, movement, or market probability. Target-book-excluded market evidence remains downstream for disagreement, edge, exact-price economics, and movement support and cannot rewrite the independent point or probability. The 2024 selection improves MAE/RMSE 5.58747/7.23555→4.85736/6.18458; the 2025 confirmation improves 5.56604/7.24089→4.62161/5.97321 with a game-clustered MAE-delta interval of [-1.23880,-0.66585] and all four chronological segments improving. Across 513 held-out 2025 thresholds, Brier/log loss/direction improve 0.25887/0.72406/54.19%→0.24973/0.69365/55.36%, with Brier improving in all four blocks. The six-scope exact 2026 diagnostic improves point MAE/RMSE 12.32575/14.91756→7.28500/8.11308 and Brier/log loss 0.57443/1.72505→0.43745/1.12775. On the 760-row frozen Week 5 same-input board, only the 34 Passing Completions rows change; all seven other families are byte-identical in model fields, two No Plays become Watchlists, and there are zero actionable promotions or demotions, leaving 12 actionables. The sole writer, shared `prediction_pipeline:nfl` lease, cadence, provider calls, grades, stakes, locks, settlement, copy, labels, and layout remain unchanged. Prior locked snapshots keep exact stored precedence. Evidence and rollback: `docs/model-audits/2026-10-08-nfl-player-props-passing-completions-predeclaration.md` and `docs/model-audits/2026-10-08-nfl-player-props-passing-completions-result.md`; roll back the complete Passing Completions family to the independent Passing Attempts family without rewriting locks.

- October 8 exact-game designation continuity: shared inference context is `nfl_player_props_inference_context_2026_10_08_r8_game_designation_continuity`, consuming the r56 NFL forward writer above. The paid exact-week/exact-game designation feed is primary; bounded team-batched legacy injuries and exact-game last-known-good evidence remain silent fallbacks. This repairs the legacy 918-row/ten-page slate failure without changing a point model, posterior, probability, line selector, grade threshold, stake, cadence, writer, lease, lock, settlement, copy, label, or layout. Existing locked props remain immutable; future unlocked rows use the verified designation through the already released out/inactive and role-allocation paths. Evidence and rollback: `docs/model-audits/2026-10-08-nfl-game-designation-injury-continuity.md`.

- October 8 independent Passing Attempts release: active portable artifact / model / calibration /
  decision / runtime / board / member / lifecycle / writer / tracking are
  `nfl_player_props_runtime_2026_10_08_r9_independent_passing_attempts` /
  `nfl_player_props_distribution_model_2026_10_08_r18_independent_passing_attempts` /
  `nfl_player_props_distribution_calibration_2026_10_08_r20_independent_passing_attempts` /
  `nfl_player_props_decision_2026_10_08_r23_independent_passing_attempts` /
  `nfl_player_props_runtime_2026_10_08_r24_independent_passing_attempts` /
  `nfl_player_props_board_2026_10_08_r27_independent_passing_attempts` /
  `nfl_player_props_member_2026_10_08_r35_independent_passing_attempts` /
  `nfl_player_props_member_lifecycle_2026_10_08_r18_independent_passing_attempts` /
  `nfl_player_props_writer_2026_10_08_r41_independent_passing_attempts` /
  `nfl_player_props_tracking_2026_10_08_r23_independent_passing_attempts`. Passing Attempts now uses
  a frozen independent expected-role point head: team pass volume multiplied by the expected lead
  passer's share. Its point and probability features contain no prop line, price, book, consensus,
  movement, or market probability; target-excluded market evidence remains downstream for
  comparison, exact-price economics, and movement-aware grading. Historical 2024/2025 point MAE
  improves 8.04773→6.72470 / 8.21402→6.85638. On the exact Weeks 1–4 2026 replay, point MAE/RMSE
  improves 9.28538/13.32943→8.94463/11.26457 and Brier/log loss improves
  0.24019/0.72857→0.22746/0.64855 with direction unchanged at 68.75%. On the frozen Week 5
  apples-to-apples current-board replay, all 760 decisions match; only the 34 Passing Attempts rows
  change projection/probability, all other markets are byte-identical for those fields, and the
  nine-actionable board has zero promotions and zero demotions. The separately research-qualified
  Receptions challenger is not shipped because its full implementation flattened that market's
  six current actionables to zero with no promotion; Receiving Yards is also rejected after its
  2026 probability and direction gates failed. The existing sole writer, state-aware cadence,
  `prediction_pipeline:nfl` lease, provider calls, stakes, locks, settlement, copy, labels, and
  layout remain unchanged. Existing locked snapshots keep their exact stored payload and legacy
  release precedence. Evidence and rollback:
  `docs/model-audits/2026-10-08-nfl-player-props-independent-distribution-release-result.md`; roll
  back the complete October 8 family and expected-role artifact to the October 7 settlement-aligned
  Rushing Attempts family without rewriting locks.

- October 7 settlement-aligned Rushing Attempts release: active portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking are `nfl_player_props_runtime_2026_10_07_r8_settlement_aligned_rushing_attempts` / `nfl_player_props_distribution_model_2026_10_07_r17_settlement_aligned_rushing_attempts` / `nfl_player_props_distribution_calibration_2026_10_07_r19_settlement_aligned_rushing_attempts` / `nfl_player_props_decision_2026_10_07_r22_settlement_aligned_rushing_attempts` / `nfl_player_props_runtime_2026_10_07_r23_settlement_aligned_rushing_attempts` / `nfl_player_props_board_2026_10_07_r26_settlement_aligned_rushing_attempts` / `nfl_player_props_member_2026_10_07_r34_settlement_aligned_rushing_attempts` / `nfl_player_props_member_lifecycle_2026_10_07_r17_settlement_aligned_rushing_attempts` / `nfl_player_props_writer_2026_10_07_r40_settlement_aligned_rushing_attempts` / `nfl_player_props_tracking_2026_10_07_r22_settlement_aligned_rushing_attempts`; cadence remains `nfl_player_props_cadence_2026_10_07_r1_state_aware_refresh`. Only the Rushing Attempts portable point head and its matching empirical residual distribution change. The released head is a frozen 25% incumbent / 75% model fit on historical player-games with official participation, aligning training with the population eligible for wager settlement; participation is a historical target filter and is not a current-game inference feature. The 2025 holdout improves MAE 3.13553→3.05408, RMSE 4.37183→4.14461, bias -0.90974→-0.22787, CRPS 2.23959→2.16308, and NLL 2.68314→2.64071, with all four chronological MAE segments improving and a game-clustered 95% MAE-delta interval of [-0.12807, -0.03601]. On the release-pure 720-row settled Week 4 board, only 124 Rushing Attempts rows change; Rushing Attempts direction improves 38/62→41/62, overall direction improves 162/291→165/291, and actionables move 9→8 through zero promotions and one demotion of a settled losing Lean, improving units +0.196→+1.196. The controlled 760-row current-board reconstruction changes 38 Rushing Attempts rows across 19 scopes, moves forecast directions from 1 Over / 18 Under to 7 Over / 12 Under, and produces zero promotions and one demotion. All other market models, thresholds, grade rules, market arbitration, exact-price economics, representative-line policy, target-book exclusions, stakes, provider calls and ceilings, cadence, one writer, shared `prediction_pipeline:nfl` lease, T-60 locks, settlement, copy, labels, and layout remain unchanged. Ordinary prior-release unlocked rows are freshly recomputed; existing locked rows retain their exact stored payload and legacy release tuple. Evidence and rollback: `docs/model-audits/2026-10-07-nfl-player-props-projection-accuracy-predeclaration.md`, `docs/model-audits/2026-10-07-nfl-player-props-projection-accuracy-result.md`, and `lib/services/football/modelArtifacts/nflPlayerPropsConditionalRushingAttemptsManifest.json`; roll back the complete r8/r17/r19/r22/r23/r26/r34/r17/r40/r22 family and Rushing Attempts shard to the immediately following r7/r16/r18/r21/r22/r25/r33/r16/r39/r21 family without rewriting locks.

- October 7 market-selective mean-quintile calibration and state-aware cadence: active portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking are `nfl_player_props_runtime_2026_10_07_r7_market_selective_mean_quintile` / `nfl_player_props_distribution_model_2026_10_07_r16_market_selective_mean_quintile` / `nfl_player_props_distribution_calibration_2026_10_07_r18_market_selective_mean_quintile` / `nfl_player_props_decision_2026_10_07_r21_market_selective_mean_quintile` / `nfl_player_props_runtime_2026_10_07_r22_market_selective_mean_quintile` / `nfl_player_props_board_2026_10_07_r25_market_selective_mean_quintile` / `nfl_player_props_member_2026_10_07_r33_market_selective_mean_quintile` / `nfl_player_props_member_lifecycle_2026_10_07_r16_market_selective_mean_quintile` / `nfl_player_props_writer_2026_10_07_r39_state_aware_cadence` / `nfl_player_props_tracking_2026_10_07_r21_market_selective_mean_quintile`; cadence is `nfl_player_props_cadence_2026_10_07_r1_state_aware_refresh`. The point models are byte-identical. Passing Attempts, Passing Yards, Rushing Attempts, Rushing Yards, and Receiving Yards use the held-out-qualified predicted-mean quintile residual distributions; Passing Completions and Receptions retain their exact preceding four-bucket artifacts after the full-family candidate created harmful exact-board transitions. The existing quarter-hour NFL heartbeat now invokes the sole props writer hourly when the nearest unlocked T-60 boundary is more than six hours away, every 30 minutes inside six hours, every 15 minutes inside two hours, immediately at a due T-60 boundary, and immediately when the current-week snapshot is missing or invalid. This operational gate makes zero provider calls itself and does not alter model math, exact-price selection, actionability, member rows, locks, settlement, copy, labels, layout, or stakes. On the matched 720-row settled Week 4 board, actionables remain 9, one promotion is paired with one demotion, both settled wins, units improve +0.11989→+0.19564, Brier improves 0.26012→0.25609, and log loss improves 0.72674→0.71527. The matched 967-row current Week 5 audit moves actionables 12→11 with three promotions, four demotions, zero nonpositive-EV actionables, and an exact candidate actionable bound of 11-11. The release keeps the r55 exact-game injury-continuity writer input, all target-book exclusions, exact-price economics, representative-line policy, one writer, shared `prediction_pipeline:nfl` lease, T-60 lock immutability, settlement, copy, labels, layout, and stakes unchanged. Ordinary retained unlocked rows must be freshly recomputed rather than relabeled; prior locks keep their exact stored payload. Evidence and rollback: `docs/model-audits/2026-10-07-nfl-player-props-opportunity-budget-distribution-predeclaration.md`, `docs/model-audits/2026-10-07-nfl-player-props-market-selective-mean-quintile.md`, and `docs/model-audits/2026-10-07-nfl-player-props-state-aware-cadence-predeclaration.md`; roll back only writer r39/cadence r1 to writer r38 for an operational cadence regression, or roll back the complete calibration family to the r6/r15/r17/r20/r21/r24/r32/r15/r37/r20 family without rewriting locks for a model/coherence regression.

- October 6 presentation-integrity repair: member presentation release `nfl_player_props_presentation_2026_10_06_r1_touchdown_opening_integrity` suppresses only an invalid opening-to-current trail when a canonical `0.5` Anytime TD quote inherited an opening from a different touchdown milestone ladder. A genuine same-line Anytime TD opening and ordinary cross-line volume/yardage movement remain eligible. The active model, calibration, decision, runtime, board, member, lifecycle, writer, tracking, provider cadence, prices, probabilities, projections, sides, grades, stakes, locks, settlement, labels, copy, layout, and `prediction_pipeline:nfl` lease are unchanged. Evidence and rollback: `docs/model-audits/2026-10-06-nfl-player-props-touchdown-opening-integrity-predeclaration.md`.
- October 7 receptions discrete market-arbitration and release-coherent continuity: active portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking are `nfl_player_props_runtime_2026_09_29_r6_full_family_matchup` / `nfl_player_props_distribution_model_2026_09_29_r15_injury_feed_continuity` / `nfl_player_props_distribution_calibration_2026_10_07_r17_discrete_market_arbitration` / `nfl_player_props_decision_2026_10_07_r20_discrete_market_arbitration` / `nfl_player_props_runtime_2026_10_07_r21_discrete_market_arbitration` / `nfl_player_props_board_2026_10_07_r24_discrete_market_arbitration` / `nfl_player_props_member_2026_10_07_r32_release_coherent_continuity` / `nfl_player_props_member_lifecycle_2026_10_07_r15_release_coherent_continuity` / `nfl_player_props_writer_2026_10_07_r37_release_coherent_continuity` / `nfl_player_props_tracking_2026_10_07_r20_release_coherent_continuity`. Receptions retain the incumbent posterior unless the independent and target-book-excluded same-line market directions disagree and the market is at least five points from 50%; only then may the market fully flip the forecast, after which the same empirical posterior supplies probability, side and decimal projection. The evaluated book remains excluded and exact price remains downstream. Receiving yards and every other market are unchanged after the broader candidate failed the exact replay. The release-pure Week 4 A/B improves direction 163/291→165/291, Brier 0.260825→0.260116, log loss 0.728196→0.726743 and calibration gap 0.104162→0.102682, while actionables remain 9 with zero promotions/demotions and identical 6-3/+0.119887 locked-price results. The current Week 5 replay changes two probability/projection rows, zero sides or grades, and remains five actionables. A bounded release-transition bridge preserves a still-fresh omitted unlocked row only when its market behavior is unchanged, while stamping it into the current decision family; receptions and unknown older releases cannot bridge, and locked rows remain immutable. This removes the two mixed unlocked internal decisions found by post-deploy acceptance, including the one member-selected Anytime TD row, without changing any numeric output or the 827-row member count. It adds no provider call, writer, schedule, stake, copy, label or layout. Evidence and rollback: `docs/model-audits/2026-10-07-nfl-player-props-discrete-market-arbitration-predeclaration.md`, `docs/model-audits/2026-10-07-nfl-player-props-discrete-market-arbitration-result.md`, and `docs/model-audits/2026-10-07-nfl-player-props-release-coherent-continuity.md`; roll back the complete October 7 family to the September 29 continuity family without rewriting locks on mixed releases, coverage loss, coherence failure, board collapse, writer overlap or reader failure.
- September 29 Week 4 injury-feed continuity release (preceding): active portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking are `nfl_player_props_runtime_2026_09_29_r6_full_family_matchup` / `nfl_player_props_distribution_model_2026_09_29_r15_injury_feed_continuity` / `nfl_player_props_distribution_calibration_2026_09_29_r16_injury_feed_continuity` / `nfl_player_props_decision_2026_09_29_r19_injury_feed_continuity` / `nfl_player_props_runtime_2026_09_29_r20_injury_feed_continuity` / `nfl_player_props_board_2026_09_29_r23_injury_feed_continuity` / `nfl_player_props_member_2026_09_29_r30_injury_feed_continuity` / `nfl_player_props_member_lifecycle_2026_09_29_r13_injury_feed_continuity` / `nfl_player_props_writer_2026_09_29_r35_injury_feed_continuity` / `nfl_player_props_tracking_2026_09_29_r18_injury_feed_continuity`; inference context and joint runtime are `nfl_player_props_inference_context_2026_09_29_r7_injury_feed_continuity` / `nfl_player_props_joint_runtime_2026_09_29_r2_full_family_matchup`. The portable full-family artifact and every equation, posterior, price, grade threshold, stake, provider request, lock, settlement, copy, label, and layout remain unchanged. Verified exact-game injury evidence retains priority and last-known continuity; when a future game's injury endpoint has never returned a payload, the absence is now an internal health finding while current exact prop offers, current roster/depth, official season state, matchup, weather, and main-market context remain eligible. Missing forward evidence, roster/depth, main market, or game identity still excludes the game, and any subsequently verified out/inactive designation restores the existing player hold. The zero-write Week 4 replay retained all 16 games with 5,483 exact offers, 406 feature rows, 339 score-eligible rows and 611 canonical member rows; it produced 1 Best Angle / 5 Leans / 50 Watchlists / 811 No Plays / 124 internal Held outcomes, six actionables, 46 provider calls under the unchanged 51-call collection ceiling, zero added provider calls, and zero promotion/demotion changes against the same current full-family calculation. The preceding strict behavior produced no Week 4 board. Evidence and rollback: `docs/model-audits/2026-09-29-nfl-player-props-injury-feed-continuity.md`; roll back the complete continuity family without rewriting locks if the slate empties, coverage becomes partial, provider calls rise, releases mix, or the member reader fails.
- September 29 full-family matchup release (preceding): portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking were `nfl_player_props_runtime_2026_09_29_r6_full_family_matchup` / `nfl_player_props_distribution_model_2026_09_29_r14_full_family_matchup` / `nfl_player_props_distribution_calibration_2026_09_29_r15_full_family_matchup` / `nfl_player_props_decision_2026_09_29_r18_full_family_matchup` / `nfl_player_props_runtime_2026_09_29_r19_full_family_matchup` / `nfl_player_props_board_2026_09_29_r22_full_family_matchup` / `nfl_player_props_member_2026_09_29_r29_full_family_matchup` / `nfl_player_props_member_lifecycle_2026_09_29_r12_full_family_matchup` / `nfl_player_props_writer_2026_09_29_r34_full_family_matchup` / `nfl_player_props_tracking_2026_09_29_r17_full_family_matchup`; inference context and joint runtime were `nfl_player_props_inference_context_2026_09_29_r6_matchup_environment` / `nfl_player_props_joint_runtime_2026_09_29_r2_full_family_matchup`. The complete market-family tournament combines player role and official history with opponent/team pass and rush mix, completion and yardage efficiency, pressure/sack rate, first-down and turnover tendencies, explosive plays, air yards/YAC, home field, week, and verified weather/roof context. Rolling team behavior represents coaching and style without an unvalidated coach-name coefficient. The official 2016-2025 chronology trains through 2022, selects on 2023, confirms on 2024, and holds 2025 untouched. Passing Yards, Rushing Attempts, Rushing Yards, Receptions, and Receiving Yards improve both MAE and RMSE on the frozen holdout and are promoted; Passing Attempts, Passing Completions, and Anytime Touchdown retain their stronger incumbent heads. The target-book-excluded posterior, source-separated sharp-book confirmation, same-book movement context, exact-price economics, unchanged grade surface, one writer, `prediction_pipeline:nfl` lease, provider ceiling, lock/settlement rules, and member presentation remain unchanged. The zero-call Week 3 board replay paired 14 promotions with six demotions, moved actionables 22→30 rather than flattening the board, and moved settled direction wins 153→158 on 338 retained identities; it is an opened diagnostic, not a guaranteed future win rate. Existing locked rows remain immutable. Evidence and rollback: `docs/model-audits/2026-09-28-nfl-player-props-full-family-predeclaration.md` and `docs/model-audits/2026-09-29-nfl-player-props-full-family-result.md`.
- September 28 official-outcome joint model: active portable artifact / model / calibration / decision / runtime / board / member / lifecycle / writer / tracking are `nfl_player_props_runtime_2026_09_28_r5_official_joint_outcomes` / `nfl_player_props_distribution_model_2026_09_28_r13_official_joint_outcomes` / `nfl_player_props_distribution_calibration_2026_09_28_r14_official_joint_outcomes` / `nfl_player_props_decision_2026_09_28_r17_official_joint_outcomes` / `nfl_player_props_runtime_2026_09_28_r18_official_joint_outcomes` / `nfl_player_props_board_2026_09_28_r21_official_joint_outcomes` / `nfl_player_props_member_2026_09_28_r28_official_joint_outcomes` / `nfl_player_props_member_lifecycle_2026_09_28_r11_official_joint_outcomes` / `nfl_player_props_writer_2026_09_28_r33_official_joint_outcomes` / `nfl_player_props_tracking_2026_09_28_r16_official_joint_outcomes`; the quarterback head is `nfl_player_props_qb_passing_projection_2026_09_28_r4_joint_latent_workload`. Historical labels now come from official nflverse weekly player/team box-score tables rather than play-level dropback flags. The corrected 2016-2025 feature dataset has 138,860 rows and 99.2584% outcome/roster identity coverage. The frozen 2025 holdout confirms the 75% joint QB opportunity/efficiency blend: Passing Yards MAE improves 45.7977→45.0262 and RMSE 70.9069→70.6226, with clustered MAE delta interval [-1.1311,-0.3988]; Passing Completions MAE/RMSE moves 4.0234/6.2092→4.0102/6.1916 and produces zero completions-over-attempts rows. Rejected receiving/rushing conditional heads remain rejected. Joint residual distributions are separately recalibrated and achieve 80%/90% coverage of 80.35%/90.75% for completions and 81.73%/90.37% for yards on the locked holdout. A verified expected starter now uses target-book-excluded Attempts/Completions/Yards evidence to update one latent workload, with low-history rate/efficiency pooled toward official priors; exact price and grades remain downstream and same-line action gates remain intact. The final Week 3 no-write replay retains 2,131 member rows / 58 tracking rows, changes 12 projections and five forecast directions with zero grade transitions against the immediately preceding workload behavior, and stays at 47 provider calls with zero state calls. Against the live snapshot it pairs one promotion with two demotions, moving member-canonical actionables 48→47; grade thresholds are unchanged and the board remains two-sided. No stake, provider cadence/ceiling, writer, schedule, lock, settlement, copy, label or layout changes. Prior locks remain immutable. Evidence and rollback: `docs/model-audits/2026-09-28-nfl-player-props-joint-model-r3-predeclaration.md` and `docs/model-audits/2026-09-28-nfl-player-props-joint-model-r3-result.md`; roll back the complete release family together while preserving locked evidence.
- September 28 quarterback-workload marriage candidate: active model / calibration / decision / runtime / board / member / lifecycle / writer / tracking are `nfl_player_props_distribution_model_2026_09_28_r12_qb_workload_marriage` / `nfl_player_props_distribution_calibration_2026_09_28_r13_qb_workload_marriage` / `nfl_player_props_decision_2026_09_28_r16_qb_workload_marriage` / `nfl_player_props_runtime_2026_09_28_r17_qb_workload_marriage` / `nfl_player_props_board_2026_09_28_r20_qb_workload_marriage` / `nfl_player_props_member_2026_09_28_r27_qb_workload_marriage` / `nfl_player_props_member_lifecycle_2026_09_28_r10_qb_workload_marriage` / `nfl_player_props_writer_2026_09_28_r32_qb_workload_marriage` / `nfl_player_props_tracking_2026_09_28_r15_qb_workload_marriage`; the quarterback workload point head is `nfl_player_props_qb_passing_projection_2026_09_28_r3_all_workload_markets`. A verified current starter now uses target-excluded current multi-book workload evidence in each market's own empirical residual distribution for Passing Attempts and Passing Completions as well as Passing Yards; the portable recent-role projection remains source-separated evidence. Projection, probability and side are one posterior, while exact price remains downstream. Different-line evidence repairs the posterior but does not bypass the established same-line action gate. The final one-capture A/B replay retained all 2,129 member rows, changed eight projections and four forecast sides, and moved member-canonical actionables 49→50 through one promotion / zero demotions; the complete candidate board contained 25 Best Angles / 42 Leans / 340 Watchlists / 2,705 No Plays / 321 internal Held and 67 actionables. It retained 58 tracking rows, used 47 provider calls and zero current-state calls, and added no provider request, writer, schedule, stake, copy, label, or layout. Prior locks remain immutable. Evidence and rollback: `docs/model-audits/2026-09-28-nfl-player-props-qb-workload-predeclaration.md` and `docs/model-audits/2026-09-28-nfl-player-props-qb-workload-result.md`; roll back the complete release family together while preserving locked evidence.
- September 28 current-role and coherent-posterior repair: active model / calibration / decision / runtime / board / member / lifecycle / writer / tracking are `nfl_player_props_distribution_model_2026_09_28_r11_current_role_coherent_posterior` / `nfl_player_props_distribution_calibration_2026_09_28_r12_current_role_coherent_posterior` / `nfl_player_props_decision_2026_09_28_r15_current_role_coherent_posterior` / `nfl_player_props_runtime_2026_09_28_r16_current_role_coherent_posterior` / `nfl_player_props_board_2026_09_28_r19_current_role_coherent_posterior` / `nfl_player_props_member_2026_09_28_r26_current_role_coherent_posterior` / `nfl_player_props_member_lifecycle_2026_09_28_r9_current_role_coherent_posterior` / `nfl_player_props_writer_2026_09_28_r31_current_role_coherent_posterior` / `nfl_player_props_tracking_2026_09_28_r14_current_role_coherent_posterior`. A unique rostered quarterback with a starter-scale current passing market at two or more books supersedes older depth evidence, and a game-scoped `out` or `inactive` designation reported more than six days before kickoff cannot describe the new game; persistent injured-reserve status remains authoritative. Every ordinary displayed projection is now the median of the same empirical posterior that supplies its probability and side; exact prices and grades remain downstream. The complete Week 3 no-write replay retained 2,127 member rows and all 61 full-board actionables, increased score-eligible features 291→303, reduced internal Held outcomes 327→309, preserved the 47-call ceiling, and made zero state calls or database writes. There is no new provider call, writer, schedule, stake, copy, label, or layout. Prior locked rows remain immutable. Evidence and rollback: `docs/model-audits/2026-09-28-nfl-player-props-professional-marriage-predeclaration.md` and `docs/model-audits/2026-09-28-nfl-player-props-current-role-coherent-posterior-result.md`; roll back the complete release family together while preserving locked evidence.
- September 28 injury-context continuity and next-window recovery: preceding model / calibration / decision / runtime / board / member / lifecycle / writer / tracking / inference context were `nfl_player_props_distribution_model_2026_09_28_r10_injury_context_continuity` / `nfl_player_props_distribution_calibration_2026_09_28_r11_injury_context_continuity` / `nfl_player_props_decision_2026_09_28_r14_injury_context_continuity` / `nfl_player_props_runtime_2026_09_28_r15_injury_context_continuity` / `nfl_player_props_board_2026_09_28_r18_injury_context_continuity` / `nfl_player_props_member_2026_09_28_r25_injury_context_continuity` / `nfl_player_props_member_lifecycle_2026_09_28_r8_next_window_fallback` / `nfl_player_props_writer_2026_09_28_r30_injury_continuity_and_rollover` / `nfl_player_props_tracking_2026_09_28_r13_injury_context_continuity` / `nfl_player_props_inference_context_2026_09_28_r5_last_known_injury_continuity`. The shared context now combines the newest complete depth/market row with the most recent verified injury payload for the exact same game when a later provider response omits injuries; a game that never had verified injury evidence remains unavailable. The final direct zero-write Week 3 replay restores Eagles–Bears with 1,692 exact offers and 357 feature rows, removes its injury hold, adds 113 canonical member rows and six actionables, changes zero already-locked rows, and makes zero additional state-provider calls. The NFL cron refreshes the existing current-season state under the existing `prediction_pipeline:nfl` lease before the forward writer so a new week cannot deadlock on the prior week's incomplete state; the props reader may use only a nonempty immediately-next-week snapshot after the calendar-week lifecycle view is empty. Week selector / forward writer are `nfl_forward_week_selection_2026_09_28_r2_completed_slate_rollover` / `nfl_forward_evidence_writer_2026_09_28_r49_next_window_state_order`. No model equation, probability, projection, exact-line selection, grade threshold, stake, lock, settlement, copy, label, layout, provider ceiling, schedule, or second writer changes. Evidence and rollback: `docs/model-audits/2026-09-28-nfl-player-props-next-window-recovery.md`; roll back the complete September 28 release family together while preserving immutable evidence.
- September 25 current-season team box-score capture: active writer / current-season state are `nfl_player_props_writer_2026_09_25_r29_team_boxscore_capture` / `nfl_player_props_current_season_state_2026_09_25_r3_team_boxscore_capture`. The sole leased NFL props writer now retains normalized home/away identities and final scores from the completed-games response plus official completed-game team box scores: conversions, play volume, yards per play, passing/rushing production, sacks allowed, red-zone results, turnovers, and possession. The preceding r1 snapshot migrates by preserving all player stats and performing one bounded games refresh; it does not redownload player stats for already represented games, and it obtains missing team box scores through one batched endpoint with an eight-page hard ceiling. The theoretical incremental request ceiling is 101 instead of 93; a natural weekly transition normally adds one request and a completed cached week adds zero. The added rows are shadow evidence only and are not consumed by the current Daily Edge or props scorer. Predictions, probabilities, projections, sides, grades, stakes, locks, tracking, settlement, member rows, copy, labels, cron, and the `prediction_pipeline:nfl` lease are unchanged. Any score-model use requires a separate predeclared chronological tournament and complete release cutover. Evidence and rollback: `docs/model-audits/2026-09-25-nfl-current-season-team-state-capture.md`; roll back writer/state to r27/r1 while preserving the captured r3 snapshot as non-authoritative evidence.
- September 25 canonical NFL player-prop projection presentation: active member / member lifecycle / writer are `nfl_player_props_member_2026_09_25_r24_canonical_main_line` / `nfl_player_props_member_lifecycle_2026_09_25_r7_canonical_projection` / `nfl_player_props_writer_2026_09_25_r29_team_boxscore_capture`. Each ordinary player/category/main-line pair now displays the median of its finite quote-specific projections and derives its prediction badge from that exact same canonical projection. A frozen active Week 3 replay reduces 12 projection/badge contradictions to zero; nine labels change, while stored rows and every grade/actionable count remain identical. No copy, labels, layout, model, calibration, decision, probability, stored projection, price, stake, lock, tracking, settlement, provider call, cron, writer, or `prediction_pipeline:nfl` behavior changes. Evidence and rollback: `docs/model-audits/2026-09-25-nfl-player-props-canonical-projection-predeclaration.md` and `docs/model-audits/2026-09-25-nfl-player-props-canonical-projection-result.md`; roll back lifecycle r7 to r6.
- September 25 canonical NFL player-prop main-line release: active member / member lifecycle / writer at release were `nfl_player_props_member_2026_09_25_r24_canonical_main_line` / `nfl_player_props_member_lifecycle_2026_09_25_r6_canonical_main_line` / `nfl_player_props_writer_2026_09_25_r27_canonical_main_line`. Each new game/player/category member scope now publishes one actually offered consensus main line, derived from the cross-book median of each sportsbook's most balanced complete Over/Under pair. Alternate ladders remain in the canonical production snapshot for audit, locks, tracking, closing-price capture, and settlement. Existing locked member payloads retain exact precedence until normal rollover; a scope selected by this release remains canonical when it later locks. The frozen `2026-09-25T11:36:09.747Z` Week 3 replay preserves all 975 player/category scopes while reducing 2,291 unlocked rows to 1,387 and producing zero unlocked multi-line scopes, zero retained-row mutations, zero promotions/demotions, and zero actionable projection/line contradictions. Twelve scopes whose action existed only at an alternate rung leave the member action count by requested product deduplication, not grade changes. Model / calibration / decision / runtime / board / tracking / settlement, provider calls, stakes, cron, and `prediction_pipeline:nfl` are unchanged. Evidence and rollback: `docs/model-audits/2026-09-25-nfl-player-props-canonical-main-line-predeclaration.md` and `docs/model-audits/2026-09-25-nfl-player-props-canonical-main-line-result.md`.
- September 24 projection/line forecast coherence repair: active model / calibration / decision / runtime / board are `nfl_player_props_distribution_model_2026_09_16_r9_current_season_inputs` / `nfl_player_props_distribution_calibration_2026_09_24_r10_projection_line_forecast` / `nfl_player_props_decision_2026_09_24_r13_projection_line_forecast` / `nfl_player_props_runtime_2026_09_24_r14_projection_line_forecast` / `nfl_player_props_board_2026_09_24_r17_projection_line_forecast`. Ordinary Over/Under member predictions now resolve from the published projection against that exact line; the calibrated posterior is used only for the zero-edge equality fallback. The prior slate-level prevalence ranking caused 197 of 1,061 ordinary markets in the `2026-09-24T23:51:09.913Z` production snapshot to display the opposite side from the published point estimate. The same-snapshot repair changes all 197 labels to projection-coherent outcomes with zero row, probability, projection, price, grade, stake, lock, tracking, provider-call, schedule, cron, or layout changes; Best Angle / Lean / Watchlist / No Play counts and the `prediction_pipeline:nfl` lease remain identical. Anytime-TD ranked distinct-scorer semantics are unchanged. Evidence: `docs/model-audits/2026-09-24-nfl-player-props-projection-line-coherence-predeclaration.md` and `docs/model-audits/2026-09-24-nfl-player-props-projection-line-coherence-result.md`.
- September 21 receiving-market integrity repair: active provider observation / member / member lifecycle / writer are `nfl_player_props_provider_observation_2026_09_21_r10_receiving_market_integrity` / `nfl_player_props_member_2026_09_21_r22_receiving_market_integrity` / `nfl_player_props_member_lifecycle_2026_09_21_r4_receiving_market_integrity` / `nfl_player_props_writer_2026_09_21_r25_receiving_market_integrity`. BALLDONTLIE currently exposes some FanDuel rushing-plus-receiving yard lines under the ordinary receiving-yard label. The provider adapter now rejects a FanDuel receiving row only when two target-excluded receiving books establish the ordinary receiving family and at least one target-excluded combined-yard book establishes that the row belongs to the combined family. The independent model, calibration, residual math, decision/runtime/board/tracking releases, prices for retained offers, grades, stakes, locks, settlement, provider calls, cron, `prediction_pipeline:nfl` lease, labels, copy, and layout are unchanged. Evidence and rollback: `docs/model-audits/2026-09-21-nfl-player-props-receiving-market-integrity-predeclaration.md` and `docs/model-audits/2026-09-21-nfl-player-props-receiving-market-integrity-result.md`.
- September 20 canonical snapshot capacity repair: active writer is `nfl_player_props_writer_2026_09_20_r24_canonical_snapshot_capacity`. The canonical retained-week gzip envelope now permits up to 32 MB decoded / 2 MB compressed so required prior-date locked evidence can remain available for tracking and settlement after rolling off the member board. Every write first projects the exact current/future member DTO and enforces the unchanged 16 MB decoded / 2 MB compressed member-transport ceilings; an oversized page payload still fails closed before publication. The snapshot key, gzip/checksum envelope, cached reader, provider/query/write counts, cron, `prediction_pipeline:nfl` lease, and all model / calibration / decision / runtime / board / member / tracking / settlement releases are unchanged. This repair changes zero predictions, probabilities, sides, prices, grades, promotions, demotions, stakes, labels, or member rows. Evidence and rollback: `docs/model-audits/2026-09-20-nfl-player-props-canonical-capacity-predeclaration.md`.
- September 18 provider/Radar coverage repair: active provider observation / member / member lifecycle / writer are `nfl_player_props_provider_observation_2026_09_18_r9_sharp_alias_coverage` / `nfl_player_props_member_2026_09_18_r21_actionable_radar_coverage` / `nfl_player_props_member_lifecycle_2026_09_18_r3_actionable_radar_coverage` / `nfl_player_props_writer_2026_09_18_r23_provider_alias_coverage`. Exact SharpAPI aliases recognize supported receptions and rushing-attempt inputs, while ambiguous and period markets remain rejected. BALLDONTLIE identity health now tests exact requested-ID completeness instead of treating a harmless cursor as failure. Today’s Radar selects actual Best Angle/Lean rows so a ranked No Play sibling cannot hide an action; full-board ranked predictions remain unchanged. A same-capture A/B replay at `2026-09-18T20:40:03.874Z` removed only the four repaired-alias observations and produced identical 3,147-row, 16-game boards: 17 Best Angles / 58 Leans / 311 Watchlists / 2,505 ordinary No Plays / 256 internal exceptions, with zero added/removed/changed decisions and zero actionable promotions/demotions. The same capture found 13 actionable scopes hidden from the old Radar candidate pool and used 46 calls under the unchanged 51-call ceiling. Model / calibration / decision / runtime / board / tracking remain `nfl_player_props_distribution_model_2026_09_16_r9_current_season_inputs` / `nfl_player_props_distribution_calibration_2026_09_16_r9_ranked_predictions` / `nfl_player_props_decision_2026_09_16_r12_ranked_predictions` / `nfl_player_props_runtime_2026_09_16_r13_current_season_inputs` / `nfl_player_props_board_2026_09_16_r16_ranked_predictions` / `nfl_player_props_tracking_2026_09_16_r12_current_season_inputs`; probabilities, projections, prediction sides, grades, stakes, locks, settlement, tracking formulas, copy, labels, provider calls, cron, and `prediction_pipeline:nfl` lease are unchanged. Evidence and rollback: `docs/model-audits/2026-09-18-nfl-player-props-provider-radar-coverage-predeclaration.md` and `docs/model-audits/2026-09-18-nfl-player-props-provider-radar-coverage-result.md`.
- September 17 no-Held member coverage correction: active model / calibration / decision / runtime / board / member / writer / tracking are `nfl_player_props_distribution_model_2026_09_16_r9_current_season_inputs` / `nfl_player_props_distribution_calibration_2026_09_16_r9_ranked_predictions` / `nfl_player_props_decision_2026_09_16_r12_ranked_predictions` / `nfl_player_props_runtime_2026_09_16_r13_current_season_inputs` / `nfl_player_props_board_2026_09_16_r16_ranked_predictions` / `nfl_player_props_member_2026_09_17_r20_no_held_member_coverage` / `nfl_player_props_writer_2026_09_16_r22_current_season_inputs` / `nfl_player_props_tracking_2026_09_16_r12_current_season_inputs`; member lifecycle is `nfl_player_props_member_lifecycle_2026_09_17_r2_no_held_member_coverage`. Internal role/identity exceptions remain auditable as Held but are projected to members as non-actionable No Play predictions so the complete evaluated slate remains visible. Probabilities, projections, prediction sides, ranked scorer selection, prices, EV, actionable grades, stakes, locks, tracking eligibility, writer, and lease are unchanged. Week 2 same-snapshot impact: 1,798 to 1,994 member rows, 196 additional No Plays, zero actionable promotions/demotions, and unchanged tracking. Evidence and rollback: `docs/model-audits/2026-09-17-nfl-player-props-no-held-member-coverage-predeclaration.md` and `docs/model-audits/2026-09-17-nfl-player-props-no-held-member-coverage-result.md`.

- September 16 injury-pagination recovery: active model / calibration / decision / runtime / board / member / writer / tracking / inference context are `nfl_player_props_distribution_model_2026_09_16_r8_injury_pagination` / `nfl_player_props_distribution_calibration_2026_09_16_r8_injury_pagination` / `nfl_player_props_decision_2026_09_16_r11_injury_pagination` / `nfl_player_props_runtime_2026_09_16_r12_injury_pagination` / `nfl_player_props_board_2026_09_16_r15_injury_pagination` / `nfl_player_props_member_2026_09_16_r18_injury_pagination` / `nfl_player_props_writer_2026_09_16_r21_injury_pagination` / `nfl_player_props_tracking_2026_09_16_r11_injury_pagination` / `nfl_player_props_inference_context_2026_09_16_r4_game_scoped_availability`. The shared five-page Week 2 injury response now completes inside an eight-page ceiling, the reader uses the shared current NFL week, and a single incomplete shared-evidence game no longer aborts the complete slate. The current direct no-write replay covers all 16 games with zero context holds and produces a nonempty 1,260-row classified board. No model equation, grade threshold, side, stake, lock, settlement, writer, cron, or lease changes. Evidence and rollback are recorded in the September 16 injury-pagination audit above.

- September 10 member-lifecycle and controls hotfix: reader lifecycle `nfl_player_props_member_lifecycle_2026_09_10_r1_overnight_rollover` keeps the locked game reader available through play and postgame recording, then removes the prior Eastern game date at the established 2 a.m. ET board rollover while preserving the canonical locked snapshot, tracking row, settlement inputs, and historical evidence unchanged. The same filtered row set now drives the matchup navigator, Today’s Radar, research count, full board, and open reader, and the paired full board now honors its selected sort instead of forcing signal order. A SELECT-only production audit at `2026-09-10T14:35:11.334Z` found a fresh `14:21:09.777Z` Week 1 snapshot with 2,474 member rows: the prior-date NE–SEA game contributed 172 rows (0 Best Angles / 1 Lean / 13 Watchlists / 158 No Plays), while 2,302 current/future-date rows remained (12 / 79 / 320 / 1,891). The single NE–SEA actionable was already recorded and settled as one immutable loss. The hotfix rolls off only those 172 ineligible rows, with zero promotions, zero demotions, and zero changes to projections, probabilities, sides, grades, prices, stakes, locks, provider calls, database writes, writer/cron ownership, or the shared `prediction_pipeline:nfl` lease. Evidence: `docs/model-audits/2026-09-10-nfl-player-props-member-lifecycle-hotfix.md`.
- September 7 collection-capacity and invalid-input correction: provider observation `nfl_player_props_provider_observation_2026_09_07_r8_week_one_identity_capacity`, runtime/board/member `nfl_player_props_runtime_2026_09_07_r11_out_of_support_hold` / `nfl_player_props_board_2026_09_07_r14_out_of_support_hold` / `nfl_player_props_member_2026_09_07_r17_out_of_support_hold`, and writer `nfl_player_props_writer_2026_09_07_r20_identity_capacity` replace the undersized 400-player Week 1 aggregate ceiling with a bounded 512-player ceiling after natural run 118039 received 475 identities. The independent 64-player-per-game contamination guard, deterministic 100-ID batches, 18-game slate ceiling, eight-page Sharp ceiling, concurrency, writer ownership, shared `prediction_pipeline:nfl` lease, and last-known-good failure preservation remain unchanged. The declared maximum collection budget increases by two requests, 49→51, and the combined collection-plus-settlement ceiling increases 67→69. The first unblocked no-write catalog exposed 14 DraftKings receptions offers outside the immutable empirical distribution's support. Those rows are now unavailable model inputs: they emit no probability, prediction, or grade, count in existing unavailable-context diagnostics, and cannot abort the remaining coherent board. No line threshold or probability clamp is introduced. The primary-feed replay covered 16 games, 41,547 observations, 475 identities with a 36-player single-game maximum, 17,043 exact offers, and 2,250 decisions; 28 unsupported outcomes were omitted while the coherent board remained 7 Best Angles / 57 Leans / 251 Watchlists / 1,783 No Plays / 152 Held. Model, calibration, residual, decision, grade-threshold, stake, lock, tracking, settlement, snapshot storage, member presentation, and cron schedule semantics are unchanged. Candidate evidence and live acceptance are recorded in `docs/model-audits/2026-09-07-nfl-player-props-identity-capacity-r2.md`.
- September 3 forecast-authority release: model/calibration `nfl_player_props_distribution_model_2026_09_03_r7_forecast_authority` / `nfl_player_props_distribution_calibration_2026_09_03_r7_forecast_authority`; residual/projection `nfl_player_props_market_residual_calibration_2026_09_03_r8_single_application` / `nfl_player_props_market_coherent_projection_2026_09_03_r2_single_distribution`; decision/runtime/board `nfl_player_props_decision_2026_09_03_r10_forecast_authority` / `nfl_player_props_runtime_2026_09_03_r10_forecast_authority` / `nfl_player_props_board_2026_09_03_r13_forecast_authority`; member/writer/tracking `nfl_player_props_member_2026_09_03_r16_forecast_authority` / `nfl_player_props_writer_2026_09_03_r19_forecast_authority` / `nfl_player_props_tracking_2026_09_03_r10_forecast_authority`. An evaluated sportsbook is excluded from every forecast benchmark. With no target-excluded alternative, the existing independent player distribution is authoritative and the independent-book action gate remains closed. The existing target-excluded QB point head is applied once rather than receiving a second residual-market vote. For ordinary two-way props, one frozen empirical residual family produces the final probability, decimal posterior median and interval; an exact-price value on the opposite side cannot become Lean or Best Angle. Exact named-book prices and opening movement remain downstream grade economics; intentional one-sided anytime-TD semantics are unchanged. The frozen natural 16:06:09Z Week 1 replay changes 702 final probabilities and 394 projections, with zero forecast-side field changes; 11 actionable projection/side contradictions become zero. One Passing Yards row promotes and five Receptions rows demote, moving actionables 37→33 with no previously actionable category flattened. All 698 evaluation-only rows use independent fallback, locks remain byte-identical, and provider/query/write/cron/lease ceilings are unchanged from writer r18. Roll back this complete release family to r6/r7/r1/r9/r12/r15/r18/r9 while retaining the September 3 identity-capacity collector release. Evidence: `docs/model-audits/2026-09-03-nfl-player-props-forecast-authority.md`.
- September 3 collection-capacity correction: provider observation `nfl_player_props_provider_observation_2026_09_03_r7_week_one_identity_capacity` and writer `nfl_player_props_writer_2026_09_03_r18_week_one_identity_capacity` replace the preseason 300-player aggregate ceiling with a bounded 400-player Week 1 ceiling and an independent 64-player-per-game fail-closed guard. Player IDs are still fetched and enriched exactly in deterministic 100-ID batches; unmatched roster/team/role identity remains Held under the existing runtime contract. The maximum collection budget increases by one request, 48→49. Model, calibration, residual, probability, projection, decision, grade, stake, lock, tracking, settlement, snapshot storage, lease, cron schedule, and member presentation releases are unchanged. The repair was prompted by three natural cycles receiving 306 legitimate Week 1 player IDs while preserving the coherent 10:36Z last-known-good board. Evidence: `docs/model-audits/2026-09-03-nfl-player-props-identity-capacity.md`.

- Active September 2 QB target-exclusion release: Passing Yards rows emit model/calibration `nfl_player_props_distribution_model_2026_09_02_r6_qb_target_exclusion` / `nfl_player_props_distribution_calibration_2026_09_02_r6_qb_target_exclusion`; decision/runtime/board `nfl_player_props_decision_2026_09_02_r9_qb_target_exclusion` / `nfl_player_props_runtime_2026_09_02_r9_qb_target_exclusion` / `nfl_player_props_board_2026_09_02_r12_qb_target_exclusion`; member/writer/tracking `nfl_player_props_member_2026_09_02_r15_qb_target_exclusion` / `nfl_player_props_writer_2026_09_02_r17_qb_target_exclusion` / `nfl_player_props_tracking_2026_09_02_r9_qb_target_exclusion`; QB point head `nfl_player_props_qb_passing_projection_2026_09_02_r2_target_excluded_consensus`. Each evaluated sportsbook is excluded before the existing QB point consensus and ordinary cross-line residual. With no alternative, the existing independent recent-role distribution remains authoritative and the existing independent-book action gate keeps the row non-actionable. The exact evaluated quote remains downstream EV/grade economics only. The universal 90/10 point-head and 80/20 residual coefficients remain unchanged when target-excluded evidence exists; no singleton coefficient is introduced. On the release-pure 21:06:09Z Week 1 replay, all 128 Passing Yards rows have zero evaluated-offer consensus references: breadth is 2/108/18 for zero/one/two-or-more target-excluded alternatives. Across the full 1,116-row board, 112 projections/raw/final probabilities change, zero sides or actions change, and two No Plays become non-actionable Watchlists; board counts move from **6 Best Angles / 34 Leans / 96 Watchlists / 918 No Plays / 62 Held** to **6 / 34 / 98 / 916 / 62**, with 40 actionables unchanged. All 988 non-passing rows, locks, provider/write/query budgets, stakes, thresholds, writer/lease/cron ownership, settlement, and member presentation are identical. Natural cron telemetry reports release identity, target-excluded point/residual coverage, fallback rows, action count, lock count, and release mismatches; failed cycles retain the same-key last-known-good snapshot. Roll back the complete release family to r5/r8/r11/r14/r16/r8 and the r1 QB point head. Evidence: `docs/model-audits/2026-09-02-nfl-player-props-qb-target-exclusion.md`.
- Active September 1 market-coherent projection release: all supplied volume/yardage rows emit model `nfl_player_props_distribution_model_2026_09_01_r5_market_coherent_projection`; calibration `nfl_player_props_distribution_calibration_2026_09_01_r5_market_coherent_projection`; market residual `nfl_player_props_market_residual_calibration_2026_09_01_r7_market_coherent_projection`; decision `nfl_player_props_decision_2026_09_01_r8_market_coherent_projection`; runtime `nfl_player_props_runtime_2026_09_01_r8_market_coherent_projection`; board `nfl_player_props_board_2026_09_01_r11_market_coherent_projection`; member `nfl_player_props_member_2026_09_01_r14_market_coherent_projection`; writer `nfl_player_props_writer_2026_09_01_r16_market_coherent_projection`; tracking `nfl_player_props_tracking_2026_09_01_r8_market_coherent_projection`. Non-passing yardage/reception cards publish the probability-inverse point estimate `nfl_player_props_market_coherent_projection_2026_09_01_r1_probability_inverse`, so the shown projection and final market-calibrated probability describe the same empirical distribution; the independent point estimate remains stored as provenance. Current probabilities, sides, grades, stakes, exact prices, locks, and tracking are unchanged. Anytime-TD action grades require a real Pinnacle/Circa/Bookmaker reference and retain the existing role/EV/edge gates; today’s DraftKings/FanDuel-only feed remains capped at Watchlist. Evidence: `docs/model-audits/2026-09-01-nfl-player-props-market-coherent-projection.md`.
- Active September 1 QB passing repair: quarterback passing-yards rows use model `nfl_player_props_distribution_model_2026_09_01_r4_qb_passing_projection`; calibration `nfl_player_props_distribution_calibration_2026_09_01_r4_qb_passing_projection`; market residual `nfl_player_props_market_residual_calibration_2026_09_01_r6_qb_passing_projection`; decision `nfl_player_props_decision_2026_09_01_r7_qb_passing_projection`; runtime scorer `nfl_player_props_runtime_2026_09_01_r7_qb_passing_projection`; board `nfl_player_props_board_2026_09_01_r10_qb_passing_projection`; member `nfl_player_props_member_2026_09_01_r13_qb_passing_projection`; writer `nfl_player_props_writer_2026_09_01_r15_qb_passing_projection`; tracking `nfl_player_props_tracking_2026_09_01_r7_qb_passing_projection`. All other markets retain model/calibration/decision `r3/r3/r6`. The exact market board remains `nfl_player_props_exact_market_board_2026_09_01_r2_cross_line_opening`; runtime artifact remains `nfl_player_props_runtime_2026_09_01_r4_cross_market_movement`; provider observation remains `nfl_player_props_provider_observation_2026_08_31_r6_rate_limit_bounded`; settlement remains `nfl_player_props_settlement_2026_08_25_r3_bounded_finality`. Matching projected/confirmed starting quarterbacks use a 90% current primary-book market-implied passing center plus 10% median recent-role context. A single complete book may repair the projection but cannot authorize an action. Target-book-excluded different-line evidence may create a positive, non-adverse Watchlist only; Lean/Best Angle retain the same-line independent action gate. The frozen Week 1 board changes 4 passing signals up and 1 down, net +3 Watchlists, while all 918 non-passing decisions and all 27 actions remain unchanged. Evidence: `docs/model-audits/2026-09-01-nfl-player-props-qb-passing-projection.md`.
- Owner-approved cross-market grade policy: both sides of all seven modeled volume/yardage markets can use the common exact-economics ladder. Standard Lean requires 4% exact-price EV, 2pp target-excluded market edge, 70% participation, and one independent same-line book; Best Angle requires 8% EV, 3.5pp, 85%, and one independent book. Side-supporting same-book movement permits bounded 3%/1.5pp Lean and 7%/3pp Best Angle thresholds; price-only movement must be at least 2.5 implied-probability points. Adverse movement caps at Watchlist and missing/immaterial movement is neutral. No quota, stake change, or fabricated market is allowed. On the same 184 independently confirmed current outcomes, the final release produces 4 Best Angles / 23 Leans / 43 Watchlists / 114 No Plays, with 10 promotions, 9 demotions, and net +1 actionable versus the active-role-only challenger. The owner explicitly accepted forward-monitoring risk for market families that did not independently pass the original historical lane qualification. Touchdown, provider schedule, lease, locks, settlement, and stakes are unchanged. Evidence: `docs/model-audits/2026-09-01-nfl-player-props-active-role-recalibration.md`.
- Status: active for members as of 2026-08-25 from protected PR #214 / production commit `3fa3e64958d3408525001dc881d2709c53ab5a5c`. The qualified source artifact's historical `*_shadow_*` identifiers remain checksum provenance only and are never emitted by the production scorer, board, member snapshot, or tracking rows. `NFL_PLAYER_PROPS_ENABLED=true` and `NFL_PLAYER_PROPS_MEMBER_ENABLED=true` are the independent writer and visibility rollback gates. Schema migration v39 is applied to the primary database.
- Exact-price policy: every visible read requires a complete target-book line/side price. Lean and Best Angle always require at least one separate same-line book for a target-excluded market benchmark. Watchlist uses that same rule except for the explicit expected-starter passing-yards repair above: one target-book-excluded primary book at a different passing line may be transported through the existing empirical residual distribution and support a positive, non-adverse Watchlist, never an action. A complete one-book exact offer remains visible as explicit No Play with current-book no-vig context until independent confirmation exists. Game-level split feeds are not a props dependency and their absence never Holds a prop; the sport-owned market evidence is player projection/participation and injury context plus multi-book price and same-book opening/current/closing movement. Stale, incomplete, and missing-feature outcomes remain unavailable diagnostics. Held is reserved for genuine timestamped role/player-identity ambiguity.
- Actionable lanes: both Over and Under for passing attempts, passing completions, passing yards, rushing attempts, rushing yards, receptions, and receiving yards share the owner-approved cross-market policy above. A category that is not offered remains absent rather than fabricated. Anytime TD can use the existing Lean/Best Angle ladder only with a named Pinnacle/Circa/Bookmaker reference; a retail-only feed remains capped at Watchlist. Absolute raw-model/independent-market disagreement above the current 48pp p99 integrity boundary becomes completed No Play, never Held or actionable.
- Chronological evidence: 2025 is evaluation-only after training through 2024. Receiving-yards Under Best Angle returned +16.18% on 103 bets/45 games in selection and +10.79% on 67 bets/43 games in confirmation. Receptions Under Best Angle returned +16.93% on 119 bets/66 games and +20.40% on 113 bets/76 games. Rushing-attempt Lean returned +10.60% on 218 bets/95 games and +6.95% on 182 bets/107 games. Confirmation calibration gaps are 0.0412, 0.0466, and 0.0443 respectively. Cluster-bootstrap intervals remain wide and are a declared forward-monitoring risk, not a shadow or provisional runtime label. Exact historical CLV is unavailable because the 2025 source lacks paired target-book closing prices; immutable forward T-60 tracking captures it by release and locked timestamp.
- Complete-board audit: the no-write Week 1 capture at `2026-08-31T20:33:28.762Z` expanded **344** stored rows to **1,024** evaluated rows across all 16 games: **0 Best Angles / 19 Leans / 52 Watchlists / 898 No Plays / 55 Held**. Passing yards expands to 116 side/price reads for all 32 quarterbacks rather than roughly seven independently matched quarterbacks. Of the candidate rows, 613 are explicit non-actionable No Plays awaiting independent same-line confirmation. Matching-row changes under the unchanged policy are three promotions and one demotion; one newly visible independently confirmed Lean produces a net +2 actionable change. The candidate used 44 calls under the existing 48-call ceiling. SharpAPI still reports more data beyond the bounded eight-page ceiling, which remains a disclosed health diagnostic rather than a false completeness claim. Evidence: `docs/model-audits/2026-08-31-nfl-player-props-complete-board.md`.
- Rate-limit recovery: provider r6 / writer r12 disables SharpAPI's internal 429 sleep inside the optional props pagination loop. A rate limit now stops remaining Sharp pages immediately, retains pages already collected, and stamps a truthful health diagnostic; all non-rate-limit provider failures still fail closed. This prevents optional market enrichment from consuming the five-minute authoritative NFL writer window. BALLDONTLIE still supplies the complete primary catalog, and one-book rows remain explicit non-actionable No Plays, so coverage survives without manufacturing a grade. No model, projection, probability, threshold, grade, stake, lock, tracking, cron, lease, or schedule changes. Evidence: `docs/model-audits/2026-08-31-nfl-player-props-rate-limit-recovery.md`.
- Writer/tracking/settlement: the existing `nfl-forward-evidence` cron remains the only NFL prediction-writing endpoint and holds the sport-scoped `prediction_pipeline:nfl` lease. Props runs sequentially inside that writer, preserves the last coherent snapshot on provider failure, recomputes unlocked material changes, freezes at T-60, writes immutable Best Angle/Lean records idempotently, attaches same-book closing prices for CLV, and settles receptions/yards/attempts/pushes/anytime-TD from exact BALLDONTLIE game/player IDs.
- Partial-response continuity: member r9 / writer r10 extends the same failure-preservation rule to a successful HTTP response that contains only part of the prior coherent slate. A missing unlocked game/player/market/side outcome retains its prior exact tuple only while its provider observation remains inside the existing six-hour quote-freshness limit and before both lock and kickoff. A current outcome in that scope always replaces the prior row, including a changed line; stale rows expire, and locked/tracking behavior is unchanged. The live incident moved from 12 games / 320 exact-price member reads to 4 games / 128 reads in one natural writer cycle, with passing yards reduced to 10 side rows (approximately five quarterbacks). The repair changes zero projections, probabilities, sides, grades, stakes, model inputs, provider calls, writers, or schedules. Evidence: `docs/model-audits/2026-08-31-nfl-player-props-partial-snapshot-retention.md`.
- Reader/rollback: the normal member route is `/player-props?league=nfl`, reached through the shared MLB/NFL props pills. NFL and MLB use the same responsive reader-shell interaction contract; the NFL route supplies sport-specific role, market, exact-price, projection, probability, and T-60 evidence. Provider-listed availability status and report age are foregrounded on the board and in the reader with an explicit near-kickoff recheck; this does not silently change the projection or Bet grade. The private route `/dev/nfl-props-preview` remains available for controlled review. Disable `NFL_PLAYER_PROPS_MEMBER_ENABLED` to hide the member route and pill, and disable `NFL_PLAYER_PROPS_ENABLED` to stop future props writer stages; already locked records remain immutable.
- Conformance and forecast context: board DTO r5/member r7/writer r8 preserve the scorer, calibration, decision releases, probabilities, projections, grades, tracking tuple, and call ceiling. They add only existing timestamp-valid evidence to each winning member decision: opponent, scheduled start, provider-stamped competing-book prices, genuine same-book opening/current evidence, empirical 80% residual range, recent role/opportunity, opponent allowance, expected-quarterback status, injury-report status, team scoring environment, and authentic recent model-input trends. Member copy scopes itself to currently available market families and uses the universal `No Play` grade vocabulary. No new provider call, threshold, promotion, demotion, stake, or model input is introduced. Evidence: `docs/model-audits/2026-08-27-nfl-player-props-projection-context-r1.md`.
- T-60 boundary: the first writer cycle at or after lock freezes the latest provider observation selected at or before T-60, rather than an older unlocked row from the previous cycle. If a book removes an offer before that cycle, the last complete prior tuple is frozen only when it remained fresh at T-60; a stale removed offer becomes unavailable. Subsequent cycles retain the locked tuple unchanged. Snapshot `generatedAt` is the authorized evaluation timestamp, making the lifecycle reproducible.
- Load/finality boundary: production role, injury, and main-market inference reuses checksum-verified current NFL forward evidence inside the shared lease. Recurring production now includes the bounded same-book opening request needed for visible movement and is capped at 48 schedule/current+opening/identity/Sharp requests. Settlement still reads at most 1,000 eligible rows and processes at most 18 oldest games; the combined ceiling is 66. Closing prices attach to the still-pending locked row before settlement, closing the same-cycle CLV race without mutating a settled result.
- Launch verification: v39 was applied successfully to the primary database. Two post-migration natural leased cycles completed at `2026-08-25T22:21:14.278Z` and `2026-08-25T22:36:14.404Z`, each with 25 bounded provider calls, no error, and no premature tracking row because every decision remains unlocked. Production QA passed at 1280px desktop and 390x844 mobile, including league-pill navigation, exact counts, market filtering, URL-addressable selection, focus/scroll containment, Escape/close behavior, centered desktop reader, and full-screen mobile reader. The current Lab still labels authentication as a future phase, so there is not yet a real signed-in session boundary to test; NFL matches the same production access contract as MLB Player Props.
- Evidence: `docs/model-audits/2026-08-25-nfl-player-props-production-candidate-r4.md` and `docs/model-audits/2026-08-25-nfl-player-props-member-parity-launch-r1.md`.

## Premier League production release (active)

- Runtime/model release: `epl_goals_coherent_2026_10_01_r19_draw_arbitration`
- Probability core: one Dixon–Coles score PMF supplies decimal expected goals, likely and representative scores, Match Result, Double Chance, Total, and BTTS. A chronologically selected draw selector may choose Draw when the exact-score mode is level, the best-club/Draw gap is at most 8pp, the scoring-mean gap is at most 0.20, Draw is at least 24%, and neither club exceeds 40%; an accepted Draw equalizes the displayed team means around the unchanged Total so the final score and result remain coherent. The independent club PMF is otherwise authoritative unless at least two fresh, complete, target-excluded exact-2.5 Total vectors have distinct source families, distinct quote signatures, and unanimous direction; qualified evidence applies the versioned minimum-change Total tilt while preserving every Match Result marginal exactly. Evaluated Match Result, Total, and BTTS books and direct BTTS prices never enter the forecast.
- Coherent outcome contract: `epl_coherent_market_outcome_2026_09_02_r2_structural_target_exclusion`
- Display-grade / calibration release: `epl_grade_policy_2026_10_10_v25_exact_match_result_price_tiering`
- Match Result locked-score reader release: `epl_match_result_exact_locked_score_2026_08_23_r2`
- Member reader lifecycle: `daily_edge_weekly_reader_lifecycle_2026_08_21_r1`; EPL snapshot continuity/publication lifecycle: `epl_member_snapshot_lifecycle_2026_09_20_r3_verified_locked_record_reconstruction`; tracking lock policy: `epl_tracking_lock_2026_09_20_r2_verified_member_reconstruction`
- Runtime constants: `lib/services/epl/eplShadowModel.ts`
- Provider boundary: BALLDONTLIE supplies fixtures/history/stats, a complete current three-way moneyline fallback, and its distinct opening endpoint. `lib/providers/real_api/SharpApiEplMarketProvider.ts` remains primary for per-book Match Result, Double Chance, Total, and BTTS prices and makes one cached league-level splits request. A live Playbook probe proved EPL is unsupported: EPL aliases silently returned NFL rows, so Playbook is not allowed into EPL odds or splits.
- Model configuration: 365-day half-life, four-match shrinkage, 35% xG / 65% goals where xG is present, Dixon–Coles tau -0.10, separate home/away club attack and defense
- Grade boundary: Match Result remains prediction-first; price may grade the forecast but never substitute a less-likely value side. Match Result Best Angle requires at least 65% model probability, market-favorite agreement, a non-proxy forecast, a price above -250, and positive exact forecast-side expected value. The incumbent Best Angle accuracy path steps down only to Lean when exact value is nonpositive. Ordinary Lean and high-confidence short-price Lean require positive exact forecast-side expected value; otherwise they become Watchlist. Low-probability price dislocations remain monitoring context rather than accuracy-first actions. Double Chance remains forecast-anchored, tracked, and non-actionable. Total and BTTS retain the established 55% Lean and 53% Watchlist probability floors plus positive exact forecast-side expected value. The evaluated quote is economics/actionability evidence, never a generic forecast anchor.
- October 10 v25 professional Match Result price tiering: the r19 prediction, Draw selector, coherent score PMF and all selected sides remain unchanged. Match Result now applies the same exact offered-price discipline already used by Total and BTTS. A nonpositive-exact-EV row that otherwise clears Best Angle steps down to Lean; one that otherwise clears Lean becomes Watchlist. Positive-exact-EV paths retain their incumbent tier. The opened 30-game replay changes five Match Result actionables at 4-1/+0.736u to two at 2-0/+1.209u; all three demotions remain visible Watchlists. The current 40-market board keeps all seven actionables, with Arsenal Match Result moving Best Angle to Lean and no side, probability, price or projected-score change. EPL splits remain genuinely unavailable and neutral. A settled same-book movement challenger did not clear Total/BTTS proper-score gates, and a Match Result flip candidate never activated in its untouched block, so neither receives production authority. Evidence and rollback: `docs/model-audits/2026-10-10-epl-professional-match-result-tiering-v25-predeclaration.md`.
- October 1 r19/v24 accuracy repair: the conservative draw lane improved Match Result accuracy from 52.11% to 53.16% on 2024-25 selection, 48.68% to 48.95% on untouched 2025-26, and 36.67% to 43.33% on the exact 30-game 2026 r18 forward release. The accuracy-first grade replay changed exact forward Match Result actionables from 2-5 to 4-1. The current ten-game board has zero side changes, one actionable promotion and two actionable demotions: Arsenal at 68.0% becomes Lean, while the 44.6% Aston Villa and 48.6% Ipswich value forecasts become Watchlist. Total, BTTS, Double Chance, UCL, provider cadence, member fields, labels, layout, stakes, locks and tracking contracts are unchanged. Evidence: `docs/model-audits/2026-10-01-epl-draw-accuracy-grade-r19-v24.md`.
- Frozen authoritative replay: the ten-game retained r1 capture produced exact independent-PMF fallback in all ten games because the apparent alternatives were one conservatively correlated provider family. Relative to r16/v21, r18/v23 changes the complete 40-market board from 1 Best Angle / 12 Leans / 13 Watchlists / 14 No Plays to 1 / 8 / 18 / 13, with four tier promotions, eight demotions, two actionable promotions, six actionable demotions, all four grade categories represented, 40/40 exact quotes, and zero nonpositive-EV actionables. Match Result and Double Chance sides are unchanged; one Total side changes and is re-priced at its exact evaluated book. This is a structural provenance/coherence correction, not a claim of measured predictive lift; the frozen forward scorecard remains release-pure and automatic. Evidence: `docs/model-audits/2026-09-02-epl-structural-target-exclusion-r18.md`.
- Weekly-slate lifecycle: the stored active gameweek retains completed matches with their final score and advances only after every match in the round is final. The member board keeps matches throughout their Eastern game date, then removes prior-date matches after the established 2 a.m. ET soccer board rollover. Kickoffs retain canonical UTC instants and display in the member's browser time zone. Stored picks never disappear from lock, audit, settlement, or tracking history. This reader-only release changes zero projections, probabilities, sides, prices, grades, stakes, or official records.
- August 24 snapshot-continuity repair: the publication coverage gate now evaluates only non-final fixtures because sportsbooks normally remove prices after full time. Completed matches can no longer block a complete upcoming match from refreshing the weekly member snapshot. If the ordinary 24-hour cache deadline expires during a publication interruption, the EPL reader may use the newest stored weekly snapshot for at most eight days, but only while that snapshot still contains a game valid under the normal soccer board-date filter. It cannot resurrect an entirely completed old week. The next normal writer refresh replaces the continuity fallback and stamps `epl_member_snapshot_lifecycle_2026_08_24_r2`. Model r16, grade policy v21, projections, sides, grades, prices, locks, stakes, tracking, provider budgets, and the single leased writer are unchanged. Evidence: `docs/model-audits/2026-08-24-epl-weekly-snapshot-continuity.md`.
- Price health is response-time provider state: the latest v21 probe captured 40/40 selected current prices and 100/100 current outcome rows/trails across Match Result, Double Chance, Total, and BTTS, plus 618 complete all-book outcome rows from 13 sportsbooks. Sharp duplicate fixture buckets are ranked by exact fixture identity and full-game market breadth, and the odds calls are filtered by one official market at a time so large prop catalogs cannot push BTTS or Double Chance beyond a pagination cap. Compound Double Chance/total selections are rejected. BALLDONTLIE's complete current 1X2 board is a coherent same-vendor fallback only when Sharp's three-way bucket is incomplete. When a provider-native opening row is unavailable, Daily Edge uses the earliest verified same-book capture as the operational `Opening`. A second independent capture verifies a flat trail; subsequent unchanged polls are compacted, while every economic quote change remains append-only in `line_history`. The August 21 reader-integrity repair brings EPL onto WNBA's established oldest-to-newest paginated history contract: a newest-N cap can no longer evict a genuine early capture. Same-book movement remains directional evidence; when the current sportsbook differs, the earliest cross-book capture is shown separately and never mislabeled as movement. This changes zero current prices, predictions, probabilities, projections, sides, grades, stakes, promotions, or demotions; r16/v21 remains the active model/grade release. Evidence: `docs/model-audits/2026-08-21-epl-immutable-odds-history-reader.md`.
- Authoritative writer candidate: `app/api/cron/epl-daily-refresh/route.ts`, under the shared sport-scoped `prediction_pipeline` lease. The targeted `epl-pregame-lock` route uses the same lease and calls paid providers only for a game entering T-60.
- Official tracking: all four EPL markets write immutable `prediction_records`; T-60 is the public-record eligibility boundary. The member-snapshot publication boundary also preserves the complete locked projections, markets, prices, grades, and evidence against every later ordinary refresh. Official fixture metadata and final scores remain mutable after lock, and an already stored final result cannot regress to null. The scheduled shared `tracking-refresh` cycle includes `soccer`, ingests only the EPL external-id namespace when the EPL pipeline is enabled, and grades Match Result, Double Chance, Total, and BTTS from the final 90-minute score. Member aggregates expose EPL as `Premier League` while retaining historical World Cup rows under `World Cup`; the two competition records are never blended.
- T-60 disappearing-market recovery (September 7): tracking lock policy `epl_tracking_lock_2026_09_07_r1_prior_priced_tuple_fallback` freezes the last complete, previously published EPL market tuple when the provider removes that exact market at the lock boundary. It never invents a price, crosses sportsbooks, or replaces the stored prediction: the existing side, quote, probability, grade, and evidence are preserved byte-for-byte and only `locked_at` advances. A market that was never published with a coherent selected-side quote remains held. The correction closes the verified MAN@EVE BTTS omission from September 6, where a -178 published tuple existed at 09:37Z but the provider supplied no BTTS capture at or after the 12:00Z T-60 boundary. Cron telemetry now counts and reports these fallback locks. Model r18, grade policy v23, predictions, probabilities, projections, stakes, and provider budgets are unchanged. Evidence: `docs/model-audits/2026-09-07-epl-prior-priced-tuple-lock-recovery.md`.
- Verified locked-member reconstruction (September 20): publication lifecycle `epl_member_snapshot_lifecycle_2026_09_20_r3_verified_locked_record_reconstruction` and tracking lock policy `epl_tracking_lock_2026_09_20_r2_verified_member_reconstruction` close the reader gap left after the September 7 writer repair. Every due locked EPL game is reconstructed only from a complete four-market cohort in `prediction_records` matching the exact active model, calibration, and competition. Each stored member market must match its immutable scalar tuple, and all four rows must contain one identical stored projection; any missing or incoherent row blocks the whole publication. A verified reconstruction is the only path allowed to replace an older locked member card. The September 20 Liverpool at Bournemouth database cohort proves the prior +127 Match Result, -253 Double Chance, -188 Total, and -211 BTTS prices were all locked under r18/v23 even though the member snapshot dropped Double Chance and Total. This repair restores those exact stored objects and never recomputes a prediction, probability, projection, side, price, grade, or stake. Board impact is 0 promotions, 0 demotions, 0 side changes, and 0 stake changes. The existing single writers, sport-scoped `prediction_pipeline` lease, provider calls, request budgets, and model/grade releases are unchanged. Evidence: `docs/model-audits/2026-09-20-epl-verified-locked-member-reconstruction.md`.

- T-60 discovery repair (August 21): the targeted lock no longer assumes provider fixture IDs fit in a one-million-wide synthetic-ID range. It discovers due fixtures through unlocked current-release EPL records and can reconcile a due member snapshot when the slower writer locked the database first. The defect caused COV@ARS to miss the 2:00 PM EDT targeted boundary; the 2:07 PM daily writer locked the records at Circa -500 but left the member snapshot in `locking`. The repair changes no r16 probability, projection, selection, v21 grade, stake, or price and therefore retains r16/v21. Evidence: `docs/model-audits/2026-08-21-epl-heavy-favorite-grade-and-lock-audit.md`.
- Match Result score-head coherence (August 23 historical repair): the then-active r16 reader made its club Match Result score head explicit while Total and BTTS still used the separate r12 market-informed goals context. R18 supersedes that split-head presentation: one score PMF now supplies every displayed projection and market probability, while preserving the independent Match Result marginals exactly. The historical evidence remains in `docs/model-audits/2026-08-23-epl-match-result-score-head-coherence.md`.
- Cost boundary: historical 2022–25 training rows use a persistent versioned cache plus process deduplication; current-season finals refresh on the scheduled 30-minute writer; slate/provider assembly is cached five minutes; Sharp date catalogs are shared; concurrency is three; primary odds reads are capped at four narrow market calls per fixture and duplicate-event fallback is capped at ten additional calls across the weekly slate. Sharp splits use one cached league request per slate assembly, not one request per fixture; split history is not polled. Member reads use one stored weekly response snapshot and make zero provider calls.
- Production status: active for members as of 2026-08-19. `EPL_CRON_ENABLED`, `EPL_LOCK_CRON_ENABLED`, `EPL_DB_WRITES_ENABLED`, `EPL_FOUNDATION_CACHE_WRITES_ENABLED`, `EPL_PUBLICATION_ENABLED`, `EPL_PIPELINE_ENABLED`, and `PREMIER_LEAGUE_DAILY_EDGE_ENABLED` are enabled in Vercel Production. The 30-minute writer and targeted T-60 lock route remain independently reversible through those gates.
- Reader: local founder preview at `/dev/premier-league-preview`; the production Daily Edge branch is already wired to the stored snapshot behind `PREMIER_LEAGUE_DAILY_EDGE_ENABLED`.
- Rollback: restore r18/v23 inference and grading for future unlocked rows while preserving every locked r18/v23 or r19/v24 snapshot byte-for-byte. The seven EPL gates remain the emergency writer/member rollback; World Cup and UCL records/readers remain separate and no other soccer release or writer is replaced.

The August 23 r2 locked-score reader release retains r16/v21 probabilities,
picks, prices, grades, stakes, locks, tracking, writers, and provider budgets.
It corrects r1's reader-priority mistake: a legacy locked member snapshot can
contain the exact score projection members saw at T-60 even though it predates
the later `matchResultOutlook` field. r2 now prefers that immutable stored score
before any mathematical reconstruction. For BOU@MNC, the lock captured at
2026-08-23T12:03:35.791Z stores BOU 1.0419136028 / MNC 2.3228599219 and likely
score 1-2; the reader must display those values rather than the r1 reconstruction
BOU 1.145 / MNC 2.50. A probability reconstruction remains only a final fallback
when both the same-head field and locked score are genuinely absent. New locks
already persist `matchResultOutlook` directly. The locked snapshot is never
mutated. Board impact is zero promotions, zero demotions, and no decision or
tracking change. Rollback is r1 in PR #192.

r8 keeps the strongest transferable World Cup architecture—one coherent Dixon–Coles score distribution, three-way result semantics, forecast/value separation, immutable lock evidence, and shared soccer settlement—without importing national-team Elo, neutral-site rules, tournament coefficients, or the rejected World Cup market blend. Match Result, score lambdas, and r4 probabilities are unchanged. Total and BTTS use calibration-selected, sign-preserving shrinkage toward 50%: 60% raw-model weight for Over 2.5 and 65% for BTTS Yes. The previous league-rate anchor could flip a marginal Under/No score-distribution forecast into Over/Yes merely because the league base rate exceeded 50%. On the untouched final quarter, neutral-shrunk Over Brier/log loss was 0.24788/0.68883 versus raw 0.24917/0.69131 and the 0.24256/0.67820 constant baseline. Neutral-shrunk BTTS was 0.24739/0.68785 versus raw 0.24833/0.68969 and the 0.24690/0.68694 constant baseline. Both remain below the betting-quality gate; the change improves forecast coherence, not actionability. r8 retains r6's World Cup-style distribution explanation and r7's provider-timestamp trail integrity for home/draw/away, Over/Under, and BTTS Yes/No. The separate soccer-only “Complete price board” is removed; all outcomes now render inside the same OddSphere Market Pulse → Odds movement timeline used by MLB and WNBA, with the graded outcome highlighted and other outcomes retained as context.

v13 keeps every r8 projection and v12 grading threshold unchanged. It adds one sequential, capped recovery pass for incomplete Sharp fixtures and makes 40/40 selected-price plus 100/100 outcome-board coverage a hard publication gate. Partial rows may remain stored as visible holds for diagnosis, but an incomplete slate cannot replace the last coherent member snapshot. The Sharp `/splits` endpoint is authenticated and returns HTTP 200 but currently reports zero soccer/EPL rows across sport-, league-, combined-, and event-scoped probes. This is classified as endpoint-available/data-unavailable and excluded from grade decisions.

r9/v14 leaves every r8 probability, expected-goal projection, Total/BTTS decision, and provider call budget unchanged. A new model identifier is required because `prediction_records` uses model release as part of its immutable key; retaining r8 would overwrite v13 selection evidence. r9 makes Match Result selection forecast-first, removes forecast-opposed value promotion, changes >20pp absolute three-way disagreements to explicit No Play data holds, and records only genuine economic quote changes in a durable line-history path. The historical 2025–26 replay selected no draws by raw 1X2 argmax despite a 27.37% actual draw rate. World Cup-style margin bands, draw multipliers, and a trained multiclass recalibration were tested and rejected because they were unstable across chronological partitions or worsened Brier/log loss. Draw probability remains visible and calibrated; v14 does not claim a validated draw-pick layer.

r10/v15 leaves every r8 probability, expected-goal projection, Match Result, Total/BTTS decision, grade threshold, and provider call budget unchanged. It fixes Double Chance headline selection so the coverage side is anchored to the primary Match Result forecast instead of the largest price edge. The old rule could display an opponent-or-draw side against a strong predicted winner (for example Coventry or Draw beside an Arsenal forecast). All three Double Chance outcomes and their prices remain visible, but only the forecast-covering side can be the headline. Because Double Chance has no validated actionable EPL threshold, the contemporaneous board impact is zero promotions, zero demotions, and no grade-distribution change. Rollback is r9/v14.

r11/v16 retains r10 Match Result, Double Chance, provider budgets, writer ownership, and settlement. A four-season chronological tournament used 2022–23 and 2023–24 for training, 2024–25 for selection, and 2025–26 as an untouched 342-match holdout with complete Football-Data average pre-closing 1X2 and Total coverage. The Total 25/75 club/market blend recorded 57.0% overall holdout accuracy and 60.2% at the selected 55% confidence floor. The independent BTTS candidate failed and was rejected. The 1X2+Total-implied BTTS distribution recorded 59.9% overall holdout accuracy and 58.8% at 55% confidence; 57% confidence was 61.3%. r11 also repairs EPL economic line-history merging and capture timestamps so member snapshots cannot overwrite durable observations and unchanged duplicate rows cannot masquerade as movement. The post-release audit recovered and verified Arsenal's -700 to -650 sequence in the member and durable histories. Evidence: `docs/model-audits/2026-08-19-epl-goals-market-r11-v16.md`.

r12/v17 retains every r11 probability, market side, grade threshold, writer, lock, settlement, provider budget, and line-history rule. It replaces the reader's club-only expected-goal display with the validation-selected 30% club / 70% 1X2+Total-fitted projection used to explain the goals markets. On the untouched 342-match holdout, combined team-goal MAE improved from 0.89576 to 0.87639 and total-goal MAE improved from 1.21499 to 1.19836. The contemporaneous Manchester United projection moved from MAN 1.64 / HUL 1.21 to MAN 2.03 / HUL 0.92, reconciling an Over 2.5 forecast with the low-confidence BTTS No forecast without changing either side or grade. Board impact is zero promotions and zero demotions. Rollback is r11/v16. Evidence: `docs/model-audits/2026-08-19-epl-goals-coherence-r12-v17.md`.

r13/v18 retains every r12 probability, projection, side, grade, provider budget, writer, and settlement rule. It scopes each rendered price trail to the current sportsbook so a provider-priority change (for example FanDuel to Circa) cannot masquerade as same-book line movement. Durable observations for every book remain append-only. Board impact is zero promotions and zero demotions. Rollback is r12/v17.

r14/v19 retains every r13 probability, projection, side, grade, provider budget, writer, and settlement rule. It closes the remaining source-switch gap by persisting all complete sportsbook boards already present in each scheduled Sharp odds response, rather than only the book selected for the current headline. This adds zero provider calls and no always-on stream. Each book has an independent opening/change/current trail, so Pinnacle history continues accumulating even when Circa or FanDuel is temporarily the selected source. Two independent identical captures are retained to verify a flat quote; further unchanged polls are compacted and cannot masquerade as movement. Board impact is zero promotions and zero demotions. Rollback is r13/v18.

r15/v20 retains every r14 probability, projection, side, grade, provider budget, writer, and settlement rule. It prevents legacy duplicate database rows carrying the exact same captured timestamp from satisfying the two-observation flat-verification rule. Only observations from distinct OddSphere capture times can verify a same-book flat trail. Board impact is zero promotions and zero demotions. Rollback is r14/v19.

r16/v21 retains every r15 probability, projection, side, grade, provider budget, writer, settlement rule, and unlocked refresh behavior. The single member-snapshot publication boundary now preserves any previously locked game's projections, market sides, prices, grades, and evidence, preventing the ordinary 30-minute refresh from replacing the public T-60 record. Event identity, official schedule metadata, and final results may still update; an existing final result cannot regress to null. Board impact is zero promotions and zero demotions. Rollback is r15/v20.

The four-season chronological tournament selected the runtime configuration on 2024–25, selected the xG blend on the first 285 matches of 2025–26, and reserved the final 95 matches for evaluation. Full 2025–26 accuracy was 48.68%, Brier 0.61610, log loss 1.02615, and team-score MAE 0.89956. Final-quarter accuracy was 43.16%, Brier 0.63409, log loss 1.05313, and MAE 0.91928; that deterioration is a declared limitation. Per-team goal projections ranged from 0.56 to 3.01 across the full untouched season, but their actual-score correlation was only 0.274 overall and 0.188 in the final quarter. The projections are therefore useful differentiated inputs, not a finished high-confidence score predictor. The price-eligible winner-confidence Lean rule was 56-41 on calibration and 11-8 on the untouched final period. Heavy favorites at a 65% model floor were 14-2 in calibration but only 1-3 in the small untouched final sample; v10 exposes them only as likely-winner context, never value or positive expected return. The 5pp value Best Angle rule was +2.924u over 127 calibration plays and +6.502u over 26 final plays. Full evidence and caveats are in `docs/model-audits/2026-08-18-epl-shadow-foundation-r1.md`.

## UEFA Champions League production release (active; provisional transferred grade policy)

- Runtime/model release: `ucl_goals_coherent_2026_10_06_r7_target_excluded_opening_market_score`
- Coherent outcome contract: `ucl_coherent_market_outcome_2026_10_06_r3_target_excluded_opening_match_result`
- Opening-market arbitration: `ucl_opening_market_score_arbitration_2026_10_06_r1_corroborated_crossing_log_pool_30`
- Display-grade/calibration release: `ucl_grade_policy_2026_10_06_r7_opening_market_score_inputs`
- Competition context: `ucl_competition_context_2026_09_03_r2_qualifying_truthful`; settlement: `ucl_regulation_settlement_2026_09_03_r3_complete_lock_manifest`
- Frozen history manifest: `ucl_history_manifest_2026_09_03_r1` (185/126/63, cutoff `2026-01-28T20:00:00.000Z`, match SHA-256 `00d3761b7d94851776ffb5b893bdaded8dec85657f769140a2aef0dacd306d36`; 754 team-stat rows, stat SHA-256 `3b817b9aa164ebc5141c26dddf9194611735d98708deef2b5b7f16df91314f88`)
- Member lifecycle: `ucl_member_snapshot_lifecycle_2026_09_03_r4_et_midnight_matchweek_rollover`
- Runtime constants: `lib/services/ucl/uclModel.ts`, `lib/services/ucl/uclCoherentMarketOutcome.ts`, `lib/services/ucl/uclPreviewGrade.ts`, and `lib/services/ucl/uclCompetitionContext.ts`. The UCL model, outcome and grade authorities are owned/versioned in UCL; the EPL module supplies only shared display/writer adapters.
- Provider boundary: the dedicated Ball Don't Lie UCL v1 product owns fixtures, history, stats, availability, 1X2 fallback, and provider opening odds. The documented plural `seasons[]` and bounded `start_date`/`end_date` filters ignored their values in live tests, returning 2026 and 2011 rows respectively. Production does not retry those known-bad paths. Current fixtures and historical cohorts each use the empirically verified singular `season=` transport, paginate, deduplicate exact IDs, reject conflicting duplicates and every returned-season mismatch, and fail closed on an empty current season or any historical season without regulation-final rows. Cache reads and fresh reads must also match the frozen match and team-stat manifests exactly before training. Cached telemetry must prove the same ready singular-season strategy and exact 189/189 cohorts. Schema v6 persists only authenticated raw inputs and deterministically rebuilds joined xG training rows on read. The deviation remains explicit in provider-health telemetry. The read-only replay returned exactly 189 rows for 2024 and 189 for 2025; 754 team-stat rows joined after the complete cohort passed. Empty, mismatched, partial, or manifest-drifted history is a write/publication error: the cycle preserves the last-known-good member snapshot and cannot publish a default-prior replacement. SharpAPI league `uefa_-_champions_league` owns the primary exact-book Match Result, Double Chance, Total, and BTTS board plus its truthful splits availability state.
- Model/grade boundary: one UCL-owned regulation-time PMF supplies every outcome. r7 preserves the independent club model by default. Only a target-excluded median of at least two complete provider opening 1X2 books whose leader differs from the independent leader by a corroborated five-point market lead may activate a 70% independent / 30% market log pool; the solved scoring rates preserve the independent expected total. The evaluated exact quote remains downstream economics/grade evidence and can never validate itself. Match Result, Double Chance, Total, BTTS, projected goals, and grades consume the same final PMF. On 38 priced selection matches, result accuracy improved from 20/38 to 23/38, Brier from 0.202889 to 0.199603, log loss from 1.017579 to 1.002929, and per-team score MAE from 1.130246 to 1.127154. On the untouched 20-match confirmation block, accuracy stayed 10/20 while Brier improved from 0.198784 to 0.195149, log loss from 0.988708 to 0.974952, and score MAE from 1.170749 to 1.160122. Runtime parity was exact. The same-input 18-fixture board moved from 14 to 13 actionables with one promotion and two demotions; no missing price was manufactured. The frozen r6 independent replay remains the underlying model benchmark: 52.38% Match Result holdout accuracy, 0.19890 Brier, 0.99638 log loss, 0.22968 Total Brier, 0.23845 BTTS Brier, and 1.18637 team-score MAE. No quota, manufactured balance, contrarian selection, or stake is permitted. Evidence: `docs/model-audits/2026-10-06-ucl-opening-market-score-r7-result.md`.
- Competition boundary: reciprocal schedule topology supplies leg and aggregate context. July/August is explicitly qualifying rather than league phase; unsupported provider round numbers are not claimed as provenance. Qualification/advancement is not inferred from Match Result.
- Writer/member boundary: `ucl-daily-refresh` and `ucl-pregame-lock` use the existing `prediction_pipeline:soccer` lease and shared soccer writer implementation. UCL alone enables prior-priced-tuple recovery, so EPL lifecycle behavior remains unchanged. A disappearing T-60 quote locks the prior complete tuple without rewriting it; an always-missing market locks as held. Snapshot repair can authenticate already-locked current-authority IDs without changing their T1 payload. Both the regular refresh and targeted lock path verify every T-60-due game before publication: all four exact model/calibration/competition rows and every persisted scalar must pass identity and immutable-field checks, and the locked card is reconstructed from each DB row's stored `member_market_at_capture`; no fresh held tuple can stand in for a prior priced tuple. An incomplete refresh preserves the prior member LKG and publishes nothing. A refresh whose current-price coverage collapses from a nonzero prior member board to zero is also a publication/write error and preserves that priced LKG. Partial 1–3-market locks stay outside member publication, settlement, aggregate Tracking, and winner scorecards until the exact four-market manifest exists. Held rows are void and excluded from accuracy/ROI. One master-gated flag contract controls providers, writes, publication, member/API/navigation exposure, foundation writes, locks, and settlement. All 36 current clubs have deterministic ESPN-family crest IDs and primary colors through the same shared card components used by EPL.
- Board lifecycle: the default member board selects one UCL round/matchweek. All fixtures played on the current `America/New_York` calendar day remain through ET midnight even after final whistle. On the next ET day, completed prior-day fixtures fall off while scheduled or in-progress fixtures in the same multi-day round remain; once that round has no current-day or future fixture, the complete upcoming round populates. The default slate cache is ET-day-keyed, and that selected ET day is frozen through preview construction and locked-card snapshot merging, so neither cache nor the shared EPL 2 a.m. carryover can retain the prior UCL board across midnight. Explicit requested historical/manual matchweek navigation remains complete and unchanged.
- Tracking boundary: UCL records stay `sport=soccer` with exact competition identity and T-60 lock eligibility, then display under `ucl`. Generic soccer settlement always excludes UCL; only the exact UCL pass may grade it, and that pass requires the master/write settlement gate plus a complete same-game/external-event/slate/model/calibration four-market lock manifest. Current-release aggregate and release-pure winner-accuracy readers enforce the same manifest, admit only the exact active model plus calibration pair for Current release, and exclude held rows from W/L. When the master/member gate is off, direct UCL tracking returns unavailable and member, homepage, and public track-record API reads exclude stored current UCL rows and dynamic baselines without deleting them or reusing an enabled-state cache/snapshot; if a mixed public aggregate cannot be safely separated, the current composite fails closed. The separately rendered static historical UCL archive remains visible with legacy provenance. Older row-level releases and the two aggregate-only legacy baselines remain labeled archive data and are never blended with current-release accuracy. Tracking aggregation contract is `tracking_aggregate_v8_locked_prediction_accuracy_2026_09_04`.
- Evidence and validation boundary: `docs/model-audits/2026-09-03-ucl-chronological-r2-predeclaration.md`, `docs/model-audits/2026-09-03-ucl-chronological-r4-result.md`, `docs/model-audits/2026-09-03-ucl-opening-odds-actionability-predeclaration.md`, `docs/model-audits/2026-09-03-ucl-opening-odds-actionability-result.md`, `docs/model-audits/2026-09-03-ucl-epl-grade-transfer-r6-predeclaration.md`, and `docs/model-audits/2026-09-03-ucl-epl-grade-transfer-r6-result.md`. Forecast metrics remain release-pure. The provisional grade transfer is owner-authorized, transparently labeled, and must be evaluated forward by exact release and T-60 lock; it is not described as UCL historical-price validation.
- October 10 professional market-reader audit: r7 remains unchanged. The exact locked forward release was 13-3 across 16 actionables (+5.461 flat-stake units), with every actionable positive at its exact offered price. Same-book no-vig movement-toward rows went 9-1, movement-against rows 1-2, and flat rows 3-0, but the required paired promotion pool was only 3-3; therefore movement remains audit context instead of an automatic switch. Authentic public splits were absent and remain neutral. The live 18-fixture readiness replay had 16 actionables, zero nonpositive-EV actionables and zero incoherent rows. Evidence and limitations: `docs/model-audits/2026-10-10-ucl-professional-market-reader-r7-result.md`.

## Shared tracking settlement

- Settlement contract: `tracking_settlement_v4_epl_completed_status_2026_08_22`
- Runtime constant: `lib/services/trackingSettlementRepairService.ts`
- Authoritative writer: the existing sport-scoped `tracking_refresh` job under the shared
  `prediction_pipeline` lease

The v2 settlement contract retains every current model, calibration, selection, price, lock, and
grading rule. It adds a bounded database-only catch-up (at most three historical slate dates per
sport per run) for existing pending grades whose stored game is already terminal. This prevents a
transient missed settlement from remaining pending after the slate leaves the normal
yesterday/today/tomorrow provider window. The catch-up calls the same authoritative grader and
does not add a second prediction writer or fetch historical provider slates.

The v3 settlement contract retains v2's bounded repair and every non-EPL rule. It adds EPL to the
hourly shared tracking cycle, requires the immutable T-60 lock before an EPL record can grade or
enter member aggregates, and separates `english_premier_league` from historical World Cup rows in
member-facing competition buckets. The scorer remains the shared regulation-time soccer grader.

The v4 settlement contract retains every v3 lock, competition, grading, and aggregation rule. It
adds BallDontLie EPL's persisted terminal token `completed` to the shared grader and bounded
pending-repair discovery. This closes the production mismatch where an EPL game had a trusted
full-time score but remained pending because other sports use `final`, `STATUS_FINAL`, or `OFF`.
No prediction, probability, projection, market side, play grade, price, stake, or locked record is
changed; only deterministic settlement of existing locked rows is affected.

## MLB champion

- Operational cadence / rollover: `mlb_daily_refresh_schedule_2026_10_07_r1_readiness_gated_rollover`. The default member board changes ET dates at 03:00 and silently retains the prior complete date-keyed snapshot until the new date publishes successfully. The existing sole leased slate writer receives DST-safe 03:05 ET seed opportunities: Vercel invokes at 07:05Z and 08:05Z, while the route admits only the invocation whose New York hour is 03 and makes zero provider calls on the other. Current-season pitching and batting remain guarded by their existing successful once-per-slate-day markers; later full and intraday cycles reuse them. Partial core work, failed Market Intelligence, or a failed response-snapshot write cannot replace the prior complete board. Prediction formulas, market interpretation, sides, scores, probabilities, grades, stakes, locks, tracking, member copy, labels, and layout are unchanged. Evidence: `docs/model-audits/2026-10-07-mlb-readiness-gated-rollover-cadence.md`.

- October 8 first-inning opening continuity advances the shared member presentation release to
  `daily_edge_member_presentation_2026_10_08_r24_mlb_fi_opening_continuity`. The FI market model
  already consumes coherent target-excluded current/opening pairs and same-book movement before
  producing its posterior. The member reader now recognizes that current target-excluded reason
  format when resolving the evaluated sportsbook, so its existing same-book `line_history` rows
  populate NRFI and YRFI Opening/Prior instead of appearing blank. Legacy reason parsing remains
  supported; books are never crossed. Predictions, post-market probabilities, scores, sides,
  exact current prices, grades, actionability, locks, tracking, providers, query counts, copy,
  labels, and layout are unchanged. Promotions, demotions, and changed decisions are 0 / 0 / 0.
  Evidence and rollback: `docs/model-audits/2026-10-08-mlb-fi-opening-continuity.md`.

- Projection runtime: resolved automodel `v2_2`
- Projection core: `mlb_projection_core_v2_6_corroborated_total_opposition_preserve_margin_2026_10_05`
- First-inning runtime: `fi_v2` with FI-scoped release `mlb_first_inning_release_2026_09_04_r85_independent_uncertainty` and probability head `mlb_first_inning_fi_v10_independent_uncertainty_target_excluded_2026_09_04`. r85 retains r84's pre-r61 65% independent / 35% target-excluded multi-book posterior and its 48%-52% corroborated uncertainty band. When the evaluated quote is the sole accepted pair, the forecast remains independent-only and now requires the independent probability to clear 55% NRFI or 55% YRFI; otherwise it is a genuine null-side Toss-Up. The evaluated quote remains exact-price economics only. Full-game tuples, probabilities, grades, the sole writer/lease, providers, query budgets, locks, tracking, and settlement are unchanged.
- Public calibration: `mlb_public_calibration_v37_professional_moneyline_tiering_2026_10_09`
- Decision release: `mlb_daily_edge_decision_2026_10_09_r91_professional_moneyline_tiering`
- Rule bundle: `mlb_daily_edge_rule_bundle_v76_professional_moneyline_tiering_2026_10_09`
- Market input snapshot: `mlb_market_input_snapshot_v3_current_line_pagination_2026_09_08`
- Model-layer schema: `mlb_model_layer_versions_v20_projected_lineup_continuity`
- Input eligibility: `mlb_input_eligibility_v2_projected_lineup_last_verified_continuity_2026_10_07`
- Grade policy: `mlb_public_grade_policy_v60_professional_moneyline_tiering_2026_10_09`
- Correction policy: `mlb_prediction_corrections_v25_corroborated_total_opposition_2026_10_05`
- Tracking contract: `member_facing_lock_v8_priority_retry_minute_cadence_2026_08_11`
- Lock coherence: `mlb_lock_coherence_2026_09_02_r3_failed_economics_tuple`
- Machine registry: `lib/automodel/mlbModelLayerVersions.ts`
- Authoritative member-facing writer: `lib/services/predictionRecordService.ts`

The October 9 r91 release changes only future unlocked MLB Moneyline tier
arbitration. The already released confidence/value/score/market cohort advances
from Lean to Best Angle without widening any evidence gate: it still requires a
60%-plus independent selected-side probability, bounded exact-price friction,
a projected-score margin on that side, observed same-book directional
movement, no public-split conflict, no unresolved correction/cap state, and
complete Moneyline data. Its opened release-separated replay was 46-15,
+9.795u and positive in each declared chronological block. The older
tight-market-price sleeve remains actionable but requires non-negative exact
offered-price edge for Best Angle; otherwise it is Lean. The neutral 70/70
SharpAPI consensus sleeve follows the same strongest-tier price rule. No side,
probability, price, projected score, Total, first-inning decision, stake,
provider, schedule, writer, lease, lock, copy, label, or layout changes. The
opened loss audit explicitly rejects a broad adverse-movement Moneyline flip:
the incumbent side went 6-2 and its opposite-side counterfactual went 2-6.
Evidence and rollback are in
`docs/model-audits/2026-10-09-mlb-professional-moneyline-tiering-r91-predeclaration.md`.

The October 7 projected-lineup continuity release changes no projection formula,
probability head, side selector, price, grade, stake, member copy, label, layout,
writer, lease, schedule, or provider-call count. A projected provider response may
replace one game/team lineup only after at least eight distinct mapped batters and
eight distinct batting positions are present for that exact team. The complete
unit is upserted before stale projected rows are removed; an empty, malformed, or
partially mapped response preserves the prior verified unit. A team with an
already complete official lineup is never downgraded by projected data. Complete
input produces the same lineup rows and therefore zero side, promotion, demotion,
or actionable-count changes. The outage/partial fixtures intentionally preserve
the preceding board rather than manufacturing a new one from missing data.
Locked historical tuples remain immutable. Evidence and rollback are in
`docs/model-audits/2026-10-07-mlb-projected-lineup-continuity.md`.

The October 5 r90 release keeps the independent MLB model primary and repairs
one release-specific full-game Total market-reading gap. A future unlocked row
can flip only when model confidence is at most 57.5%, a target-excluded
two-sided no-vig pair favors the other side, a continuous same-book price trail
moves against the pick, and either an opposing money-versus-ticket pattern or
the existing MLB internal sharp-resistance signal independently corroborates
it. Missing evidence is neutral and books are never crossed. The corrected
side must have a real quote. Its one-decimal team scores retain the independent
margin and either retain an already-coherent Total or reflect the Total across
the listed line, keeping score, side, probability, and price coherent.

On 58 opened retrospective rows the fixed selector moved direction from 20-38
to 38-20 and improved Total MAE in all four chronological blocks. This is
provisional evidence, not a guaranteed hit rate. The rule cannot promote a Best
Angle and still passes through the ordinary exact-price/grade gates. The
October 5 current-board replay has no qualifying MLB row, so same-input current
board side changes, promotions, demotions, and actionable-count changes are
0/0/0/0. No provider call, schedule, writer, lease, stake, member copy, label,
or layout changes. Evidence and rollback are in
`docs/model-audits/2026-10-05-mlb-corroborated-total-opposition-predeclaration.md`
and its paired result.

The October 1 official-slate continuity repair changes no MLB formula, probability
head, grade threshold, stake, or member presentation. The model-layer schema advances
through r90 to `mlb_model_layer_versions_v19_corroborated_total_opposition` while retaining input
eligibility policy `mlb_input_eligibility_v1_official_tbd_starter_neutral_bullpen_2026_10_01`.
When a successful
MLB Stats schedule response is available, unmatched lower-authority conditional games
are excluded from active ingestion. Hidden retractions are excluded from shared game-id
maps and cannot be revived by ordinary publication. On a one- or two-game official
postseason slate where every probable starter remains officially TBD, the starter gate
admits only those exact officially verified games to the existing low-tier
starter-neutral/bullpen model. The member card receives one coherent decimal score,
Moneyline and Total predictions, verified prices, and market evidence; Best Angle is
blocked and first-inning action remains held without pitcher identity. The next ordinary
leased cycle replaces the fallback inputs after official starters arrive. Evidence and rollback are in
`docs/model-audits/2026-10-01-mlb-official-tbd-slate-continuity-predeclaration.md`.

The September 26 projection-core release changes only future unlocked MLB
member score projections. When the existing target-excluded market-aware Total
agrees with the already-authoritative Total forecast, the displayed score uses
that Total while preserving the incumbent projected margin exactly. A conflict,
missing market Total, disabled calibration, or exact-line candidate preserves
the incumbent score. Moneyline winner/margin, Total side/probability/grade,
first inning, exact prices, stakes, providers, copy, labels, writer, lease,
locks, and tracking remain unchanged. The fixed shadow was evaluated on 302
settled games stamped with the preceding exact projection core: team-score MAE
improved 2.403725→2.342682 and Total MAE 3.435397→3.302318 while margin MAE and
winner accuracy were identical. All three chronological partitions improved
both team-score and Total MAE. A same-input 13-game dry run changed seven score
projections with zero side, grade, probability, confidence, or board-count
changes. Evidence and rollback are in
`docs/model-audits/2026-09-26-mlb-market-total-score-projection-v2-5.md`.

The September 30 evidence-integrity release advances the shared resolver to
`market-intelligence-v2.3-unified-price-map-0.6.0-coherent-observation`. It keeps
Circa and Pinnacle in their established priority order, but requires a current
selected-side observation to remain within six percentage points of the median
of at least four books before that book and its history can influence market
intelligence. The member movement trail applies the same principle to at least
three complete two-sided pairs with a four-point no-vig tolerance. This
quarantines the isolated CHC-SD Circa SD -425 / CHC +345 observation while the
coherent board remains SD -133 through -155; it does not ban or globally
downweight Circa. The SD -135 exact-price recommendation, projections, sides,
probabilities, grades, stakes, locks, tracking, writers, schedules, leases, and
provider calls are unchanged. Evidence and rollback:
`docs/model-audits/2026-09-30-market-evidence-source-integrity.md`.

The September 24 r89 release retains the r88 Total probability head, every
predicted side and score, and the full member presentation. It replaces only
the failed additive Total Lean sleeve: the incumbent 55%+ selected-probability
cohort is retired, while 52% inclusive through 55% exclusive may qualify only
with at least a 0.5-run same-side projection gap. Exact-price edge, adverse
movement, public/split conflict, completeness, provisional, and side-change
gates are unchanged. Chronological reconstruction was 35-30 / 29-23 / 11-9 in
train / August validation / September 1-18 confirmation; the release-separated
r88 check was 5-1 versus 3-12 for the retired sleeve. No quota, stake, provider,
cron, copy, label, or layout changed. Evidence and rollback are in
`docs/model-audits/2026-09-24-mlb-total-action-recalibration-r89.md`.

The September 19 r88 totals release changes only the full-game Total
probability head. For each slate, the existing authoritative writer makes one
bounded database read and reconstructs the Over result from the latest 90
settled, locked MLB Total predictions strictly before that slate date. A
Beta(5,5)-smoothed run-environment rate receives 35% weight and the existing
target-excluded, market-regularized Over probability receives 65%. The selected
90-game/35% candidate was fixed on chronological train plus August calibration,
then improved the untouched September 1–18 holdout from 48.07% to 54.94%
accuracy, Brier 0.252973 to 0.247758, and log loss 0.699253 to 0.688790. At
available locked prices, the all-forecast sensitivity moved from -18.419 units
(-7.91%) to +15.317 units (+6.60%); this is forecast-head evidence, not a claim
that every forecast is actionable.

The exact September 19 no-write record-builder replay covered all 15 games.
Totals moved from 2 Best Angles / 0 Leans / 7 Watchlists / 6 No Plays to
0 / 4 / 9 / 2: four promotions, two demotions, net +2 actionables, and six
side changes. The regime head is already downstream of the existing market
regularizer, so the writer neither price-calibrates it a second time nor sends
it through the superseded, historically rejected Total side-candidate stack.
All exact-price, data-quality, freshness, provisional, and negative-economics
gates remain active. If the bounded prior read fails or fewer than 90 settled
rows exist, the model preserves the r87 probability unchanged. Moneyline,
first inning, projection scores, providers, UI copy/labels, stakes, locks,
tracking, settlement, cron cadence, sole writer, and `prediction_pipeline:mlb`
lease are unchanged. Evidence and rollback are in
`docs/model-audits/2026-09-19-mlb-totals-regime-calibration-r88.md`; rollback is
the complete r87 release family without rewriting any locked row.

The September 8 r87 current-line correction preserves every r86 model formula,
probability head, side rule, grade threshold, provider, cadence, stake, lock,
tracking, and settlement rule. It extends stable, bounded `lines.id` pagination
to the two downstream full-slate consumers omitted by r86: the authoritative
prediction-record price snapshot and the member Daily Edge current-price
reader. Both now consume the same complete current Moneyline, Total, and
first-inning row set instead of accepting PostgREST's default 1,000-row prefix.
The SELECT-only MLB odds-health audit uses the same reader. A saturated
10,000-row response fails closed rather than publishing a partial price board;
locked records remain immutable. Evidence and exact board impact are recorded
in `docs/model-audits/2026-09-08-mlb-current-line-pagination-r87-predeclaration.md`
and `docs/model-audits/2026-09-08-mlb-current-line-pagination-r87-result.md`.
Rollback is the complete r86 release family.

The September 5 r86 input correction preserves the r82 full-game model formulas,
all r85 first-inning probability/calibration/tuple identifiers and behavior, and
every stake rule. It replaces the full-game feature snapshot's single unbounded
`lines` response with stable `id`-ordered 500-row pages and a fail-closed 10,000
row ceiling. This prevents PostgREST's 1,000-row response limit from silently
dropping the last games on a large slate and falsely classifying priced Moneyline
and Total markets as unavailable. The correction restores authentic named-book
price inputs only; it does not fabricate a price, alter a locked record, or add a
second writer.

Shared member presentation release: `daily_edge_member_presentation_2026_10_08_r24_mlb_fi_opening_continuity`.
Internal operational holds remain high-severity health/recovery state, but the
member board, filters, cards, headlines, and Bet Grade surface them as No Play
with an explicit incomplete-evidence reason. The response reports evaluated
markets separately from operational exceptions; exceptions are never counted
as completed grades. Every operational exception preserves the model-owned
outcome prediction, probability, and projected score. Only the incomplete
exact-price bet tuple is withheld: evaluated bet side, sportsbook price,
market fair probability, edge/gap, EV, actionability, and grade price. This
universal contract applies to every Daily Edge sport and changes no projection,
probability, forecast side, exact price, writer grade, action, stake, tracking
row, lease, or lock behavior. On prediction surfaces, a missing directional
market side on a legacy snapshot falls back to the model-native output (for
example, `Projected total 8.3` or the projected score) rather than the Bet
Grade label. A football market-prediction health failure caused only by a missing verified line now
uses that same score-derived fallback instead of erasing the model outlook. It shows projected
margin or projected total, never a fabricated sportsbook line, Over/Under side, price, edge, EV,
actionability or grade. No Play appears only in Bet Grade surfaces.
The r6 football reader presents five market-specific primary drivers before a
disclosure containing every remaining verified row, and moves injury and
availability reporting below those drivers as explicit context. When a verified Spread or Total
line exists, its released line-specific prediction remains authoritative and wins over the
score-derived fallback. These are presentation-only changes: model
probabilities, projected scores, exact lines and prices, grades, stakes,
tracking rows, writers, leases, and locks are unchanged.
The r8 presentation contract removes three false reader implications without
changing any forecast or decision tuple. An internal No Play with no eligible
named-book price says sportsbook odds are unavailable and, when present, shows
the Playbook line only as consensus context instead of promising odds below.
For the active NFL r9 release, the score panel also distinguishes the discrete
score/winner forecast from the separately calibrated Spread and Total heads;
it does not claim those line-specific probabilities are same-PMF while the
coherent r2 candidate remains inactive.
For active CFB, the reader now labels `modelProbability` as the price-calibrated
Bet-grade probability and distinguishes it from the independent joint-PMF score
and winner forecast. The CFB side guard still preserves the PMF-selected side,
but its market-informed calibration and consensus blend may materially change
the exact-price probability; r8 no longer calls those two probability heads the
same forecast.
The r5 presentation contract also preserves authentic current prices, lines,
and two-sided same-book movement when an internal operational exception makes
the exact-price Bet grade unavailable. Operational No Play suppresses only the
incomplete evaluated-bet tuple; it cannot erase independently ingested market
evidence. For unlocked MLB Moneyline and Total readers, the current best quote
remains separate from a deterministic movement-reference sportsbook. When the
best-price book has no history, the movement panel uses the richest current
two-sided exact-line book and labels both books explicitly; it never combines
prices from different sportsbooks into one trail. MLB first-inning continues
to use its named-book two-sided YRFI/NRFI 0.5 board.
On the 2026-08-26 15:00:51Z MLB snapshot, 42 evaluated markets remain 3 Best
Angles / 12 Leans / 14 Watchlists / 13 evaluated No Plays. Three HOU-NYY
starter exceptions move from the retired public Held label into public No
Play, yielding 16 public No Plays while remaining 3 internal operational
exceptions. Bounded starter recovery remains under the existing
`prediction_pipeline:mlb` lease, targets at most three explicitly identified
games, and cannot mutate locked rows. Evidence and rollback are recorded in
`docs/model-audits/2026-08-26-daily-edge-operational-no-play-recovery.md`.

The August 31 MLB provider-gap cadence hardening keeps every model and release
identifier above unchanged. The existing starter-only health repair now runs
hourly at :35 during the active MLB ingestion window instead of every two
hours. It remains capped at three explicitly flagged games, uses the shared
`prediction_pipeline` lease, excludes locked/started games, and cannot rewrite
predictions, grades, tracking, or the member response. Newly resolved starter
evidence is incorporated only by the next normal authoritative slate writer.
No Sharp decision-input substitution is added: source-specific history still
recovers every 15 minutes, and absent Circa inventory remains explicit rather
than being fabricated or replaced by a presentation fallback. Evidence and
rollback are recorded in
`docs/model-audits/2026-08-31-mlb-provider-gap-recovery-cadence.md`.

The August 28 MLB r71 evidence-integrity release withholds exact 0% or 100%
ticket/handle shares when the provider observation has no verifiable sample
count. The rule is field-specific: valid non-endpoint tickets remain available
when only money is an unsupported endpoint, and vice versa. It is enforced at
the SharpAPI adapter, signal writer, last-known-good carry-forward, provider-
separated mirror, authoritative decision writer, lock snapshot, and member
reader. No replacement percentage is synthesized and Playbook is not relabeled
as SharpAPI. Existing locked picks, exact prices, probabilities, actions,
stakes, tracking rows, and settlement remain immutable. On the frozen August
28 45-market replay, counts move from 2 Best Angles / 16 Leans / 12 Watchlists /
15 No Plays to 2 / 15 / 12 / 16: zero promotions and one demotion, TEX-MIL
Moneyline, whose market-led Lean had depended on an unverified 0/0 SharpAPI
pair. The existing market-led promotion rule remains active and tested for
valid non-endpoint evidence. Fifteen games retain complete named-book line
coverage; no evaluated price is an outlier against its exact-line multi-book
center. Raw alternate totals and first-inning ladders remain stored as provider
observations but are excluded by the existing consensus main-total and 0.5-run
first-inning selectors. Evidence and rollback are recorded in
`docs/model-audits/2026-08-28-mlb-verified-split-evidence-r71.md`. Rollback is
r70/v58/v48 with correction policy v22 and member presentation r8.

The August 28 MLB r72 persisted-mirror cleanup retains every r71 decision,
grade, price, reader, lock, and tracking rule. The first normal r71 cycle
proved that new canonical split rows were sanitized, but a provider-separated
mirror skipped a matched observation when both verified fields became null;
that left 16 older endpoint rows persisted. r72 makes MLB's normal upsert write
that explicit null/null cell so older unsupported values are cleared. Other
sports keep their sparse empty-row behavior. No provider request, percentage,
projection, probability, side, quote, grade, stake, or immutable record is
created or changed. Evidence and rollback are recorded in
`docs/model-audits/2026-08-28-mlb-persisted-split-clear-r72.md`. Rollback is
r71/v59/v49 while retaining the r71 member endpoint guard.

The August 29 MLB r73 transition-integrity release prevents a single unlocked
writer cycle, retry, or sportsbook freshness rotation from creating a public
Moneyline action. An upward transition must retain the same game, market,
selected side, normalized line, and probability head across at least two
distinct natural `game_predictions.computed_at` cycles and twenty elapsed
minutes. Sportsbook is excluded from that canonical identity only because each
exact current book/price/time tuple independently passes the existing coherent
price selector and MLB's validated rule-specific economics. While pending, the
last coherent lower grade/reason remains public; adverse safety, health,
identity, and coherence demotions remain immediate. Locked rows are immutable.
The shared pure contract is
`daily_edge_action_promotion_stability_2026_08_29_r1`; MLB stamps model-layer
schema v6, evaluation-price policy v3, decision r73, rule bundle v61, and grade
policy v51. Projection, probability, calibration v27, correction v22, stake,
writer, lease, provider load, and tracking math are unchanged. The rejected
universal nonnegative-EV alternative and chronological duration evidence are
recorded in
`docs/model-audits/2026-08-29-mlb-action-promotion-stability-validation.md`.
Rollback is r72/v60/v50/schema v5/evaluation-price v2.

The August 31 MLB r74 evidence-recency correction makes the source-aware split
pair frozen by the authoritative writer the newest internally coherent pair,
not merely the most complementary pair whose rows happen to be adjacent in a
provider-history response. Both sides must have the same provider, source
book, source type, and exact verified provider observation timestamp (or the
same ingestion timestamp when the provider supplies no observation time).
Among valid pairs whose ticket and money complements remain within the
existing two-point tolerance, the newest observation wins; an invalid newest
pair falls back only to the newest earlier coherent pair. This prevents an
older favorable Sharp pair from briefly restoring an MLB action before a later
refresh selects newer resistance. Probability heads, calibration v27,
selected-side logic, prices, split thresholds, action-promotion timing, stakes,
writer, lease, providers, and locks are unchanged. The release stamps schema
v7, selector v2, decision r74, rule bundle v62, grade policy v52, and
correction policy v23. Frozen evidence and rollback are recorded in
`docs/model-audits/2026-08-31-mlb-source-aware-split-pair-recency.md`.
Rollback is r73/v61/v51/correction v22/schema v6 with the r73 promotion policy
and evaluation-price v3 retained.

The September 1 MLB r75 sharp-Moneyline source recovery repairs a provider
pagination asymmetry without inventing market evidence. When an event bucket
already proves Pinnacle, Circa, or Bookmaker main-Total inventory but its
generic paginated payload lacks a complete two-sided sharp Moneyline, the
existing bounded line collector makes one market-scoped Moneyline request and
merges the exact named-book rows through the same identity, alternate-line,
dedupe, and database-bound validation. The 100-call cap, sole collector,
shared `prediction_pipeline:mlb` writer lease, storage paths, side/probability
heads, calibration v27, thresholds, stakes, locks, and r73 two-cycle public
promotion contract remain unchanged. A frozen September 1 read-only pass
recovered 23 complete Circa/Pinnacle book-game pairs across 12 of 15 games,
with two raw promotions and one raw demotion, zero side/probability changes,
and 93 calls under the existing cap. First-inning remained complete across all
15 games from retail books but contained no supported sharp-book pair, so no
sharp first-inning evidence is inferred. The release stamps schema v8,
decision r75, rule bundle v63, grade policy v53, Moneyline price-source v2,
and evaluation-price policy v4. Split selector v2 and correction policy v23
remain unchanged. Evidence and rollback are recorded in
`docs/model-audits/2026-09-01-mlb-sharp-moneyline-source-recovery.md`.

The September 1 MLB r76 coherent sharp-retail joint forecast makes the
already-authoritative V2.2 posterior consume one complete market read rather
than applying a late grade-only nudge. For Moneyline and the exact listed
Total, the snapshot forms complete two-sided no-vig prices per sportsbook,
requires at least two supported sharp books and two supported retail books,
and gives the median sharp cohort and median retail cohort equal group weight.
The Moneyline consensus supplies the market run-share prior; the Total price
supplies the market-implied scoring mean. Those priors enter the existing
data-quality-weighted baseball/market posterior before decimal team scores,
probabilities, sides, exact-price economics, and grades are derived. Circa,
Pinnacle, and Bookmaker prices contribute to the sharp cohort when present;
DraftKings, FanDuel, BetMGM, Caesars, and other supported books contribute to
the retail cohort. Fresh public ticket/handle evidence remains an independent
context check: a material opposite split can reject the enhanced map, while
missing splits are neutral and never hold or flatten the board. The feature
uses the established 90-minute snapshot freshness window and performs no new
provider call or database query.

The frozen current-slate audit applied Moneyline evidence to 11 of 15 games
and Total evidence to six, changed six decimal score projections, changed one
raw Total direction, and produced no Moneyline direction change; raw V2.2
grades moved once and never expanded indiscriminately. A release-separated
August 25–31 chronology found the new Total probability modestly better in
both partitions, while Moneyline Brier and score-error movements were small
and mixed. This release therefore claims coherent market interpretation and
broader live evidence use, not guaranteed accuracy or retrospective profit.
First-inning keeps its existing market-backed head until a complete paired
price history supports the same integration. The sole writer, shared
`prediction_pipeline:mlb` lease, promotion persistence, exact-price grade
economics, stakes, locks, and tracking contract are unchanged. The release
stamps schema v9, calibration v28, projection core v2.3, decision r76, rule
bundle v64, grade policy v54, coherent price-map v1, and market-calibration
policy v2. Evidence and rollback are recorded in
`docs/model-audits/2026-09-01-mlb-coherent-sharp-retail-joint-forecast.md`.

The September 1 stable-opening reader repair keeps one operational opening
book/value throughout an unlocked MLB game's displayed movement trail. The
earliest complete same-line two-sided sportsbook wins; later history depth
cannot rotate `Opening` to another book. Current/evaluated price shopping and
all writer/model behavior remain unchanged. Evidence is recorded in
`docs/model-audits/2026-09-01-mlb-stable-opening-display.md`.

The September 1 MLB r77 first-inning named-book consensus makes FI V2 consume
every fresh, complete, coherent two-sided 0.5-run NRFI/YRFI pair from the
supported named-book board. A supported sharp pair is not required: when the
FI board is retail-only, the median of its complete named-book no-vig
probabilities is still authoritative market evidence. When sharp and retail
cohorts are both present, their medians receive equal cohort weight. One
complete named book remains sufficient. When a coherent same-book 0.5-run
opening is retained, current-minus-opening movement contributes a fixed 20%
residual capped at one probability point; changing book composition cannot
masquerade as movement. Partial or missing books, openings, or FI-specific
splits contribute no adjustment and never create a hold; `splits_consensus` is
excluded and no retail price is relabeled as ticket/handle or sharp-split
evidence. The current consensus and bounded movement residual enter the 25%
independent / 75% market posterior before FI expected runs, side, and
model-owned grade classification. Exact-price economics remain attached to
the same priority-selected complete named-book pair used by the tracking
writer, so consensus or movement evidence cannot substitute a synthetic
offer.

At `2026-09-01T21:42:43.702Z`, the read-only same-input 15-game replay found
complete named-book coverage on 15/15 games and supported sharp-pair coverage
on 0/15. The candidate consumed one to seven complete books per game, used
coherent opening movement on 13/15, retained the exact evaluation book and
both exact prices on all 15, and held board counts at 1 NRFI / 6 YRFI / 8
Toss-Up and 2 Leans / 5 No Bets / 8 Toss-Ups: zero actionable promotions,
zero actionable demotions, and zero side changes. Thirteen probabilities and
their natural-decimal expected-run projections changed together; mean absolute
expected-run movement was 0.00315512 and maximum movement was 0.01280974.
The retained FI-v4 chronology had 153 finalized locked rows from August 20–31,
but complete replayable named-book line history existed for only 56, all from
August 28–31. On that limited, non-selection sample, all 56 had replayable
movement, r77 moved mean absolute probability by 0.4046pp (maximum 4.3761pp),
produced two promotions and three demotions, and was modestly worse than FI v4
on Brier (0.244244 vs 0.243037), log loss (0.681629 vs 0.679216), and
exact-price action return (15-9, +2.593u on 24 actions vs 17-8, +4.845u on 25).
R77 therefore claims coherent use of the complete price
board, not retrospective accuracy or profit improvement; immutable v4 locks
remain unchanged and future r77 rows are tracked separately by release and
lock time. Projection core v2.3, full-game heads, decimal score output,
promotion persistence, correction policy v23, stakes, sole writer, the shared
`prediction_pipeline:mlb` lease, locks, tracking, and member presentation stay
unchanged. The release stamps schema v10, calibration v29, decision r77, rule
bundle v65, grade policy v55, FI probability head v5, FI named-book price-map
v1, and FI market-calibration v2. Evidence and rollback are recorded in
`docs/model-audits/2026-09-01-mlb-first-inning-named-book-consensus.md`.

The September 1 MLB r78 first-inning member-tuple coherence repair keeps r77's
forecast, natural-decimal posterior, expected-runs calculation, exact-price
economics, sides, grades, stakes, promotion policy, writer, provider reads,
and shared `prediction_pipeline:mlb` lease unchanged. It repairs only the
unlocked handoff from the just-completed authoritative writer into the existing
prediction-record sync: a current directional FI `no_bet` now publishes its
current side, exact selected-side posterior, expected runs, named-book
evaluation pair, writer cycle provenance, and No Play grade instead of being
mistaken for an absent actionable proposal and converted to a stale held
Toss-Up. The sync uses an FI-only successful writer tuple only when it is at
least as new as the persisted source row, so a delayed/out-of-order result
cannot regress a newer natural cycle. A genuinely missing or incoherent r77
evaluation pair still fails closed into the existing hold path. There is no
reader override and no new cron, provider, database, writer, or lease path;
locked records remain byte-immutable. The narrow live reproduction is BAL@COL
and STL@LAD: r77 source rows were current YRFI No Plays with Bally evaluation
quotes while their unlocked member rows had been stale held Toss-Ups. The
paired fixture repairs both to the source tuple, changes no model forecast or
actionable grade, and therefore has zero promotions and zero demotions. The
release stamps schema v11, decision r78, rule bundle v66, and FI
member-tuple contract v1; r77 probability head v5, calibration v29,
price-map v1, market-calibration v2, grade policy v55, and all full-game r76
heads remain unchanged. Evidence and rollback are recorded in
`docs/model-audits/2026-09-01-mlb-first-inning-member-tuple-coherence-r78.md`.

The September 2 MLB r79 first-inning evaluated-quote exclusion corrects one
structural forecast defect without introducing a new market-interpreter
ladder: when the exact FI evaluation sportsbook is the only incumbent-accepted
complete current pair, it remains available only for the exact selected-side
price, fair probability, EV, and downstream grade economics. The authoritative
FI posterior, natural-decimal expected runs, and side instead remain the
existing independent FI output. A target-excluded complete named-book pair
keeps the complete r77/v5 current-consensus and bounded FI-movement posterior
path byte-for-byte; no-current, stale, one-sided, and missing-data behavior is
unchanged. This is not a broad single-book ban, a split mapping, a qualitative
market override, or a calibrated multi-book trust claim.

The paired read-only September 2 current-board comparison ran the unmodified
v5 base and r79 candidate against the same 15 current snapshots and FI lines:
eight evaluation-only singleton rows changed only because they had no
target-excluded accepted pair; four target-excluded multi-book rows and three
no-current rows were exactly unchanged. The singleton rows were STL@LAD
(+2.813pp NRFI, still Toss-Up), ATH@TEX (+3.191pp, Toss-Up to NRFI Lean),
SEA@BOS (+10.099pp, retained NRFI Lean), TOR@CLE (+12.764pp, retained NRFI
Lean), SD@CIN (+7.652pp, YRFI Lean to NRFI Lean), SF@PIT (+12.107pp,
retained NRFI Lean), MIA@KC (+15.862pp, retained NRFI Lean), and MIL@CHC
(+11.642pp, retained NRFI Lean). Their exact Bally evaluation prices were
preserved. The board moves from 5 NRFI / 2 YRFI / 5 Toss-Ups / 3 Held and 6
actionable Leans to 7 NRFI / 1 YRFI / 4 Toss-Ups / 3 Held and 7 actionable
Leans: one tested promotion (ATH@TEX), zero demotions, and one forecast side
change (SD@CIN). This reports forecast and grade effects separately; it makes
no retrospective accuracy or profitability claim. Existing locks, r78
unlocked member-tuple coherence, sole writer, provider/query paths, and the
shared `prediction_pipeline:mlb` lease remain unchanged. The release stamps
schema v12, calibration v30, decision r79, rule bundle v67, FI probability
head v6, and FI market-calibration v3; price-map v1, member-tuple contract
v1, grade policy v55, all full-game heads, and locked rows remain unchanged.
Evidence and rollback are recorded in
`docs/model-audits/2026-09-02-mlb-fi-evaluated-quote-exclusion-r79.md`.

The September 3 MLB first-inning r80 forecast-authority release extends the
evaluation-book exclusion to every forecast input: the exact evaluated book is
excluded from current consensus, comparable opening/current movement, and the
authoritative posterior. It remains solely the exact fair-price and EV/grade
pair. When no target-excluded complete pair exists, the independent FI
distribution supplies the posterior and natural decimal expected runs; valid
price availability remains neutral to freshness/hold handling. Classification
is posterior-only, so the retired price bridge cannot promote, demote, or flip
NRFI/YRFI. Toss-Up is an explicit null-side, non-actionable FI result rather
than a hidden directional boolean. This FI-scoped release stamps probability
head v7, market-calibration v4, member-tuple contract v2, and dedicated FI
release ID r80 only on first-inning snapshots; MLB-wide schema, calibration,
decision/rule, grade IDs, and ML/total tuples remain unchanged. Locks, the
sole writer/lease, provider/query budgets, and no-current behavior remain
unchanged. Evidence, frozen evaluation plan, and rollback are recorded in
`docs/model-audits/2026-09-03-mlb-fi-forecast-authority-r80-predeclaration.md`.

The September 3 MLB r81 first-slate publication-cycle release closes the
draft-to-published sequencing gap without changing forecast or grade math.
When the existing publish gate promotes at least one MLB game, the orchestrator
runs the existing prediction-record synchronization once more after publication.
The promotion-stability cycle identity now comes from the authoritative model
`computed_at`, so the pre-publish and post-publish synchronizations from one
model run count as one observation, never two. A pending public tuple preserves
every non-null historical publication timestamp; only a null timestamp may be
initialized by the post-publish pass. This can allow an otherwise-qualified
Moneyline promotion after the intended two distinct natural writer cycles and
20 elapsed minutes. Probabilities, projected scores, sides, thresholds, stakes,
locks, providers, writers, cron schedules, and the shared lease are unchanged.
The release stamps decision r81 and rule bundle v69 while retaining every r80
model, calibration, probability-head, grade-policy, and correction identifier.
Evidence and rollback are recorded in
`docs/model-audits/2026-09-03-mlb-first-slate-publication-sync.md`.

The September 4 MLB first-inning r84 owner-directed rollback restores the
pre-r61 high-quality probability blend: 65% independent FI distribution and
35% target-excluded market context. Medium-, low-, missing-market, threshold,
and posterior-cap behavior remain unchanged. This is a forecast-head change,
not a price rule: the evaluated sportsbook remains excluded from forecast
consensus whenever an independent alternative exists, a singleton evaluated
pair remains independent-only for probability and decimal expected runs, and
the exact evaluated quote remains solely downstream EV/grade economics. r84
retains explicit null-side Toss-Ups, r81 writer/member persistence, locked-row
immutability, and the existing sole writer and MLB prediction-pipeline lease.
Only the FI-scoped release, probability head v9, and market-calibration policy
v6 change; MLB-wide schema, calibration, decision/rule, grade, ML, and Total
identifiers remain unchanged. This rollback is not represented as a
holdout-winning recalibration: the historical comparisons and forward-only
acceptance boundary are recorded in
`docs/model-audits/2026-09-04-mlb-fi-pre-r61-probability-rollback-r84.md`.

The September 4 MLB first-inning r85 release corrects the uncertainty contract
for evaluation-only rows without restoring evaluated-price self-validation.
The successful July 11-August 8 head produced 75 Toss-Ups among 322 locked
forecasts (23.3%); the earlier 238-row performance report counted only settled,
priced directional picks and was not a complete board denominator. r85 keeps
r84 byte-identical when a target-excluded market pair exists. When no such pair
exists, the authoritative event probability and decimal expected runs remain
the independent model output, but a probability between 45% and 55% is an
explicit null-side Toss-Up rather than a marginal binary call. The band was
predeclared before the outcome join and improved directional accuracy in the
training, validation, and untouched partitions while leaving every probability,
Brier score, and log loss unchanged. Exact evaluated price remains downstream
EV/grade-only. Only the FI-scoped release, probability head v10, and market
calibration policy v7 change; the member tuple contract, all MLB-wide IDs,
Moneyline/Total behavior, writers, locks, and tracking remain unchanged.
Evidence and rollback are recorded in
`docs/model-audits/2026-09-04-mlb-fi-independent-uncertainty-r85.md`.

The September 4 MLB r82 full-game Total scope correction enforces the already-published Under-only
contract for `total_sharpapi_money_over_tickets_support_lean`. Runtime had incorrectly allowed an
Over to enter the sleeve even though the Over branch was rejected in validation and holdout. R82
retains the validated Under path and every existing price, movement, split-gap, quality, probability,
lock, stake, provider, and writer constraint; an Over can no longer be promoted by this rule.
Decision/rule/grade stamps are r82/v70/v57 and the sleeve is
`total_sharpapi_money_over_tickets_support_lean_v2_under_only_2026_09_04`. Full-game Moneyline and
all first-inning behavior and FI r84 identifiers are unchanged. Roll back the full-game scope change
to r81/v69/v56 and the v1
 sleeve without rewriting locked history. It preserves the independently scoped FI r85 release,
 probability head, calibration policy, member tuple, and first-inning behavior. Evidence:
 `docs/model-audits/2026-09-04-mlb-total-sharpapi-under-scope-r82.md`.

The September 2 MLB r80 full-game structural-coherence release removes two
publication defects without introducing an uncalibrated market-reversal
formula. When a full-game Moneyline or Total has exactly one accepted complete
named-book pair, that pair remains the exact evaluated quote for break-even
probability, EV, and grade economics, but it cannot validate itself as
forecast evidence. A singleton Moneyline pair cannot own the team scoring
split, and a singleton Total pair cannot own the scoring environment; each
dimension falls back to the independent baseball projection while any
separately corroborated market dimension remains available. When both are
singletons, the posterior receives the exact independent projection before
the unchanged baseball-only team residual correction.
Moneyline/Total probability regularization also does not shrink toward either
singleton quote. A
singleton exact price cannot self-authorize a Best Angle without a
target-excluded pair; the independent forecast may still reach Lean through
the existing exact-price economics and promotion-stability contract. A
multi-book r76 coherent price map remains unchanged while the forward capture
accumulates the source-diverse chronology required for a later broader
interpreter.

The authoritative V2.2 decimal score/PMF now also owns the published full-game
Moneyline and Total sides. Existing inversion, raw-side, pick-calibration, and
Total residual candidates remain available as internal evidence and may stand
down or demote the authoritative side, but `prediction_records` cannot relabel
the public forecast to their opposite side. A favorite becoming No Play is not
an underdog prediction; a future underdog reversal must first change one
qualified upstream posterior, decimal score, winner, and side coherently from
persistent target-excluded source-diverse evidence. Missing splits remain
neutral, and no underdog/action quota is used.

The release stamps schema v13, calibration v31, projection core v2.4,
decision r80, rule bundle v68, Moneyline/Total probability heads v3,
full-game market-calibration v3, grade policy v56, and correction policy v24.
First-inning r79/v6, the coherent price-map v1, providers, feature-snapshot
queries, sole writer, shared `prediction_pipeline:mlb` lease, locks, tracking,
stakes, and member presentation are unchanged. Frozen prediction-quality and
exact-price grade results are reported separately in
`docs/model-audits/2026-09-02-mlb-fullgame-structural-coherence-r80.md`.
Rollback is the complete r79/r76 release set above; immutable prior locks are
never recomputed.

The September 2 MLB T-60 lifecycle correction extends lock coherence r3 only
for an exact, already-finalized Moneyline failed-economics No Play. The lock
gate may freeze that public No Play when the raw actionable candidate and
stored row match on pick, side, line, price, confidence, probabilities, edge,
publication time, evaluated-book identity, stability identity/status, candidate
grade, and terminal decision provenance. The exact-price quote must either be
provably incoherent or fall below the stored sport-owned economics floor. It
cannot freeze a different side, price, book, quote time, probability, status,
reason, grade, or non-No-Play row. This repairs the fail-closed loop in which a
correct exact-price stand-down could never satisfy the final T-60 comparison
and therefore remained unlocked through first pitch. It changes no projection,
probability, grade, promotion rule, stake, provider/query load, writer, lease,
lock timing, tracking formula, or member reader. Evidence:
`docs/model-audits/2026-09-02-mlb-lock-failed-economics-coherence-r3.md`.
Rollback is lock coherence r2; existing locked rows remain immutable.

The August 30 MLB T-60 lifecycle patch makes the lock gate understand r73's
already-persisted pending-promotion shape. A fresh raw candidate may differ
from the intentionally retained lower public tuple while confirmation is
pending. Lock coherence r2 permits that one difference only when the stored
contract/status/reason are exact, the candidate side, line, odds,
probabilities, edge, publication time, and evaluated price exactly match the
fresh proposed row, and the public pick/side remain unchanged. The lock then
freezes the retained public tuple; it never promotes the candidate at T-60.
Any unrelated mismatch still fails closed. Projection, probability, grade,
promotion timing, stake, provider load, writer, and tracking math are
unchanged. Roll back only the lock gate to r1.

The August 28 MLB source-split recovery r73 changes only the member evidence
boundary under shared presentation r11. Circa remains the first-priority
source-specific split pair. When Circa is absent, partial, stale, or rejected
as an unsupported exact 0/100 endpoint pair, the reader may show a complete
two-sided DraftKings ticket-and-handle pair as `DraftKings · Circa fallback`;
BetMGM is eligible only if it independently supplies the same complete pair.
The fallback is source-labeled, is never relabeled as Circa, never replaces
Playbook public consensus, and is not passed to the recommendation-decision
sharp-evidence input. It therefore changes no projection, probability, side,
exact price, grade, stake, lock, tracking row, or settlement. Fresh, complete
Circa evidence automatically suppresses the fallback. Evidence and rollback are
recorded in `docs/model-audits/2026-08-28-mlb-source-specific-split-recovery-r73.md`.
Rollback is presentation r10 while retaining MLB decision r72 and every r71/
r72 evidence-integrity guard.

The August 26 r70 tier-ladder release adds one strictly nonactionable
Moneyline monitoring rung. A complete, unchanged-side tuple that fails action
only on signed SharpAPI resistance or a perturbation-stable small adverse move
may display Watchlist when model probability is at least 50%, the exact price
is -300..+200, exact-price EV is at least -3%, the score projection agrees,
there is no independent public conflict, and adverse movement is at most
0.75 implied-probability points. The decision remains `board_action=no_play`,
its actionable grade and stake remain null, and the resistance/movement reason
is preserved in the snapshot. Operational holds, side corrections, incomplete
tuples, projection/public conflicts, material movement, and worse exact-price
value remain reasoned No Play. The frozen chronological audit found no
actionable Lean candidate with sufficient validation/confirmation evidence, so
all Lean and Best Angle thresholds remain unchanged. On the exact August 26
same-input board, CIN-SF moves from No Play to Watchlist; board counts change
from 1 Best Angle / 1 Lean / 1 Watchlist / 12 No Plays to 1 / 1 / 2 / 11,
with zero actionable promotions, zero demotions, and unchanged Total and First
Inning markets. Evidence: `docs/model-audits/2026-08-26-mlb-tier-ladder-r70.md`.
Rollback is r69/v57/v47/correction v21.

The August 25 r69 reader-integrity repair retains every r68 probability,
projection, selected side, evaluated book/line/price/time, threshold, action
rule, stake rule, writer, lease, and T-60 boundary. The member reader now
applies the game-wide completeness audit by missing-field ownership: a
Total-only price gap continues to hold Total but cannot hide an independently
complete Moneyline or First Inning writer decision. Shared, unknown, and
market-owned required fields still fail the affected market closed; locked
cards remain immutable. The frozen August 25 board comparison restores three
reader-hidden actions (PIT-SD Moneyline Best Angle; CHC-ARI and PIT-SD First
Inning Leans), creates no new writer action, changes no Total, and makes zero
demotions. Full evidence is recorded in
`docs/model-audits/2026-08-25-mlb-late-five-market-scoped-reader-completeness-r69.md`.
Rollback is r68/v56/v46/correction v20.

The August 23 r68 integrity repair retains every r67 probability, projection,
selected side, exact evaluated price, signed-split threshold, movement
threshold, promotion cohort, stake rule, writer, lease, and T-60 boundary. A
missing Total-only field can no longer block an otherwise complete Moneyline
decision. Final `best_angle`, `play_grade`, and `decision_pipeline` fields are
serialized from one authoritative post-champion action so a candidate Best
Angle that fails a genuine Moneyline/data gate cannot leak through a boolean
fallback. Locked rows remain immutable. The predeclared cliff/hysteresis audit
authorized no threshold change: every candidate missed the frozen confirmation
sample gates. Full evidence and paired board impact are recorded in
`docs/model-audits/2026-08-23-mlb-moneyline-grade-integrity-r68.md`. Rollback is
r67/v55/v45/correction v19.

The August 22 r67 grading repair retains every r66 probability, projection,
selected side, exact evaluated price, same-book movement trail, Total rule,
First Inning rule, stake rule, writer, lease, and T-60 boundary. Validated
SharpAPI money-below-ticket resistance remains visible as a warning, but it no
longer erases a Moneyline Lean when the active probability head is at least
60%, the run projection agrees with the side, the evaluated price is inside
-300..+200, same-book movement is not adverse, and no independent public split
conflict or correction/data hold applies. The exception is capped at Lean and
can never create a Best Angle. The exact current-head locked replay was 6-1,
+1.652u, +23.6% ROI (3-1 through August 18; 3-0 from August 19 onward). The
current read-only comparison produced three task-owned Moneyline promotions
(MIA, HOU, and ARI), zero Moneyline demotions, and no Total or First Inning
code change. Full evidence and the distinction between outcome confidence and
exact-price value are recorded in
`docs/model-audits/2026-08-22-mlb-strong-winner-resistance-lean-r67.md`.
Rollback is r66/v54/v44/v26.

The August 22 r66 movement-coherence repair retains every r65 projection,
probability head, selected side, price-eligibility threshold, promotion rule,
stake rule, writer, lease, and T-60 boundary. Line movement is now measured
only between the opening and current quote from the sportsbook whose exact
price is evaluated for the Bet grade. A source change can no longer compare an
opening quote from one book with a current quote from another and manufacture
support or resistance. Missing same-book history fails closed as unknown.
Locked records remain immutable. The paired current-board impact and production
verification are recorded in
`docs/model-audits/2026-08-22-mlb-same-book-evaluated-movement-r66.md`. Rollback
is r65/v53/v43/v25.

The August 21 r65 Moneyline price-coherence repair retains every r64 projection,
probability head, selected side, First Inning rule, Total rule, writer, lease, and
T-60 lock boundary. An unlocked Moneyline recommendation is now evaluated at a
fresh, same-book two-sided, multi-book-corroborated playable quote rather than
silently keeping a sportsbook-priority price while the reader displays a better
current quote. The probability-market baseline remains separately stamped and
the probability head is unchanged. Price shopping cannot create a new action in
r65; outcome confidence remains non-actionable likely-winner context, while Bet
Grade remains price-sensitive. On the exact same-input August 21 paired dry run,
r64 and r65 both produced 16 actions and 29 nonactions: zero promotions and zero
demotions. CLE@COL moved from the current priority baseline -175 to fresh Saba
-161 but remained No Play because validated money-below-tickets resistance still
stood down the bet. The locked reconstruction used 72 unique current-head game
locks with zero duplicate weighting; only six historically nonactionable rows had
a material coherent price improvement, which was too sparse to authorize a new
promotion sleeve. The supplementary availability path also rejects the stale,
implausible August 19 Playbook report and falls back to current official MLB
40-man injured-list statuses with explicit source health; availability remains
explanatory and changes no model input. Evidence and rollback are recorded in
`docs/model-audits/2026-08-21-mlb-price-coherence-availability-r65.md`. Rollback
is r64/v52/v42/v24.

The August 21 r64 first-inning action calibration retains r63's 25% independent / 75%
same-book two-sided no-vig probability head, 52%/48% directional boundary,
starter and lineup holds, writer, lease, lock behavior, and every Moneyline and
Total champion. It changes only the price-aware decision policy for marginal
NRFI calls. An NRFI posterior below 54% is actionable only when it clears the
actual offered NRFI break-even probability; otherwise it is a Toss-Up. The
paired route permits an existing probability-band Toss-Up to become NRFI only
when its NRFI posterior clears the actual offered break-even probability. The
new YRFI exception fails closed because only one historical row qualified and
none qualified in the latest window; YRFI remains available through the
incumbent validated 48% boundary. The policy cannot override a data-quality, starter, lineup, or
freshness hold, cannot bypass a provisional grade cap, and does not force an
opposite side.

The read-only chronological replay found 924 stored rows representing 922 unique
game-lock observations from June 7 through August 20. Two duplicate lock rows
were discarded before scoring; 921 unique observations had complete model and
outcome fields and entered the metrics. Relative to r63, r64 moved from 424
actions at 250-174 (59.0%) and +21.984 units to 364 actions at 218-146 (59.9%)
and +26.138 units. The 129-game
August 1-10 validation slice improved from 36-30, -2.758 units to 35-23,
+3.818 units; the 133-game August 11-20 diagnostic slice moved from 37-29,
-0.259 units to 29-22, +0.050 units. Because probabilities are unchanged, Brier
and log loss are unchanged. The rule demoted 83 marginal NRFI actions and
promoted 23 price-qualified NRFI Toss-Ups (14-9, +4.970 units), for a transparent net
reduction of 60 actions (14.2%). Actionable NRFI share fell in every window:
71.1% to 66.5%, 70.5% to 67.1%, 63.6% to 58.6%, and 71.2% to 62.7%.

On the exact 15-game August 21 unlocked slate captured at 10:23:52 a.m. EDT,
r63 showed 10 NRFI / 0 YRFI / 5 Toss-Ups. The no-write r64 replay showed 5 NRFI
/ 0 YRFI / 10 Toss-Ups: zero promotions and five NRFI-to-Toss-Up demotions—
WSH@MIA at -120, NYM@CWS at -130, LAA@TEX at -130, CHC@SEA at -125, and
PIT@LAD at -125. All 15 rows were unique, and locked rows remain immutable.

A movement override was rejected: line history existed for only 50 latest rows
and none of the earlier 789 rows, leaving no chronological validation path.
Changing the blend, train-only logistic recalibration, starter first-inning ERA
shrinkage, WHIP additions, asymmetric side weights, and a full-board posted-EV
gate were also rejected for unstable held-out promotions, worse probability
quality, or unacceptable board collapse. Evidence and rollback are recorded in
`docs/model-audits/2026-08-21-mlb-first-inning-price-aware-calibration-r64.md`.
Rollback is r63/v51/v41/v23 with the r61 first-inning bridge; locked historical
rows remain immutable.

The August 21 r63 incident repair retains every r62 projection, probability
head, calibration, side-selection rule, grade policy, action threshold, stake
rule, and the r61 first-inning bridge. It restores the previously tested
source-aware MLB Sharp-split ingestion path that was absent from production
`main`: exact-date current rows can be recovered from a mixed provider
payload; bounded current-event history discovery runs through the existing
Market Intelligence v2 writer; ambiguous doubleheaders fail closed; and the
leased 15-minute split refresh publishes only verified evidence. The
minute-cadence T-60 lock-only path remains scoped to entering game IDs and
cannot invoke the slate/history collector.
Playbook consensus is never relabeled as Sharp-book data. Evidence and rollback
are recorded in
`docs/model-audits/2026-08-21-mlb-sharp-splits-production-recovery-r63.md`.
Rollback is r62, which preserves all model champions but returns MLB Sharp
context to the known missing/fail-closed production state.

The August 21 r62 reconciliation restores the tested r48/r54/r55 Moneyline
and Total release line on top of production r61 without changing the r61
first-inning probability head, pick boundary, or grade gate. Moneyline again
uses the scoped 40%-45% raw-side champion and rejects market-only opposite-side
manufacture; Total again uses the guarded runtime-residual champion and its
exact-price probability calibration. The confidence/value/context Lean paths
are restored for unchanged coherent sides. The writer, shared
`prediction_pipeline` lease, lock immutability, and one-record ownership remain
unchanged.

On the August 21 15-game read-only paired dry run, all 15 first-inning rows were
identical to r61. Moneyline changed five nonactionable forecast sides without
inheriting an old-side action and added two Leans with zero actionable
demotions. Total added one Lean with zero actionable demotions. The resulting
board moved from three to five actionable Moneylines and from zero to one
actionable Total; locked rows remain immutable. Chronological validation and
holdout evidence, exact promotion/demotion counts, and rollback boundaries are
recorded in `docs/model-audits/2026-08-21-mlb-release-reconciliation-r62.md`.
Rollback is r61/v50/v40/v22/schema v3; that rollback removes the restored
Moneyline/Total layers while retaining the deployed first-inning bridge.

The August 20 r61 first-inning bridge supersedes deployed r46 and the
operator-only r60 stamps that were never present on production `main`. It
changes only MLB first-inning probability calibration and its model-owned Lean
gate. High-quality rows now blend 25% independent matchup probability with 75%
same-book two-sided no-vig market probability instead of 65%/35%. A directional
pick still requires the existing 52%/48% boundary, complete fresh half-run
prices, publishable lineups, and starter/data-quality gates. A model-owned Lean
requires nonnegative selected-side no-vig edge; negative-edge rows and the
existing Toss-Up band remain non-actionable. No movement flip is added.

The candidate was frozen before the earlier June 7-July 10 replication slice
was opened. Across 902 locked games it produced 418 actions at 246-172
(58.9%), +21.016 units, and +5.0% ROI. Replication was 121-78 (+18.907u),
development 51-36 (+3.403u), August 1-10 validation 36-30 (-2.758u), and the
August 11-20 settled diagnostic window 38-28 (+1.464u). Validation probability
quality improved to .2447 Brier/.6824 log loss from .2468/.6865; the latest
window improved to .2436/.6803 from .2456/.6843 on the identical 127 settled
rows, while AUC improved from .545 to .593 under the market-backed blend. The
paired action replay promoted 61 rows (38-23,
+5.195u) and demoted 149 (73-76, -4.134u), a transparent net reduction of 88
actions rather than a hidden empty-board policy. On the August 20 locked slate,
the dry run changes seven actionable NRFI rows and one NRFI No Play plus one
Toss-Up into five NRFI Leans and four Toss-Ups. It does not force a YRFI side.

Rollback is deployed r46/v45/v36/v19 with the prior 65% independent weight and
1.5-point Lean edge floor. Locked historical rows remain immutable. The writer
remains `predictionRecordService` under the shared sport-scoped
`prediction_pipeline` lease.

Moneyline precedence is immutable unless a later versioned release explicitly replaces it:

The August 14 r43 completion release expands SharpAPI event discovery to the
union of the verified `+EV` and `low_hold` feeds, then directly probes
deterministic provider event IDs for any game still missing from the
authoritative database slate. This restores current event odds even when no
qualifying opportunity row exists at a poll. The r42 aggregate-splits
slate-identity guard remains in force; mismatched SharpAPI public percentages
are never used. See
`docs/model-audits/2026-08-14-mlb-complete-sharpapi-event-discovery-r43.md`.

The August 14 r44 reader-coherence release makes MLB first-inning Market Read
consume the same selected-side, same-book price trail displayed in the
two-sided NRFI/YRFI movement tracker. It removes the first-inning exception
from the existing visible-odds alignment path without changing its movement
thresholds, prediction side, probability, projection, writer ownership, or
stake. The authoritative stored prediction grade remains authoritative; the
paired current-board impact is zero promotions and zero demotions. Evidence
and rollback details are recorded in
`docs/model-audits/2026-08-14-mlb-first-inning-market-read-alignment-r44.md`.

The August 14 r45 rendered-coherence follow-up removes the redesigned reader's
independent 1.25-point movement cutoff when the canonical Market Read endpoints
exactly match the visible same-book trail. The renderer now consumes the
versioned canonical direction in that case, preventing contradictory copy such
as “effectively flat” beside “Slight Market Resistance.” It changes no odds,
threshold in the authoritative classifier, prediction, grade, side,
probability, projection, or stake. Evidence is recorded in
`docs/model-audits/2026-08-14-mlb-first-inning-rendered-market-read-r45.md`.

The August 14 r46 endpoint-coherence follow-up recognizes a verified 0.5-run
NRFI/YRFI board even when the canonical Market Read omits redundant line-number
fields. Exact selected-side first/current price equality remains required.
Full-game totals and spreads retain strict point-line matching. This changes no
prediction, grade, side, probability, projection, stake, or movement threshold.
Evidence is recorded in
`docs/model-audits/2026-08-14-mlb-first-inning-board-endpoint-coherence-r46.md`.

1. Existing inversion logic.
2. Existing pick calibration.
3. Existing market-aware side correction.
4. Freeze the final side and its price/probability tuple.
5. Apply signed money-minus-ticket evidence only to the grade on that frozen side.

The signed rule never flips a side. A picked-side gap of at most -10 points stands down an
otherwise unchanged action. A gap of at least +10 may promote a Watchlist to Lean only with at
least 54% picked-side model probability, a real selected-side price, no opposing movement or
public conflict, complete data, and no prior side change. It never creates a Best Angle.

Historical paired replay: 282 actions at -1.5% ROI became 285 at +9.3%; the holdout moved from
47 at +11.9% to 53 at +18.9%. The guarded promotion cohort was 67 plays at +29.4%; the demotion
cohort was 64 plays at -17.1%. Board delta: +3.

The August 11 r29 totals correction policy keeps every historically unstable opposite-side
correction candidate rejected and hidden. A rejected candidate no longer automatically stands
down the original model side. The original side is restored and must independently pass the
existing price, positive-EV, projection-alignment, probability, data-quality, and validated-grade
gates. The forward correction audit found that the prior blanket stand-down removed nine original
sides that went 7-2 (+4.04 units, +44.9% ROI), while the rejected candidates went 2-7 (-5.09
units, -56.6% ROI). The paired current-slate replay and rollback evidence are recorded in
`docs/model-audits/2026-08-11-mlb-totals-rejected-correction-original-side-r29.md`.

The August 11 r30 grade policy adds one additive full-game Total Lean sleeve found by a nested
walk-forward market search: a high-quality, projection-aligned Under with at least 55% model
probability, nonnegative but sub-5-point offered-price edge, a price from -145 through -105,
at most 35% of tickets, and picked-side money at least five points below picked-side tickets.
Those two split fields must come from the SharpAPI sharp-adjacent source on which the sleeve was
validated; a consensus/Playbook row cannot activate it.
It never changes the selected side, probability, projection, price, Best Angle status, or stake;
missing/stale data and every existing no-bet gate retain priority. The member board gains a Lean
only when this complete joint configuration is present. The current August 11 slate has zero
qualifiers, so r30 changes no current recommendation while enabling the validated future sleeve.
Evidence and rollback details are recorded in
`docs/model-audits/2026-08-11-mlb-total-under-low-ticket-resistance-r30.md`.

The August 11 r33 source-alignment release fixes a pre-activation contract mismatch discovered by
the broader sharp-decision audit. The r30 Under sleeve was validated on latest-at-lock SharpAPI
splits, while its first implementation read the legacy aggregate split row. r33 reads the frozen
source-aware SharpAPI pair directly and fails closed when that provider is absent. The August 11
board still has zero qualifiers for this sleeve, so the correction changes no current pick or
grade. Full evidence and rollback details are in
`docs/model-audits/2026-08-11-mlb-total-under-sharpapi-source-alignment-r33.md`.

The August 11 r34 source-alignment release extends that exact-provider contract to the two
Moneyline decisions that were also validated on reconstructed SharpAPI observations: the signed
money-minus-ticket promotion/stand-down and the r32 slate portfolio ranker. They now read the
selected-side SharpAPI pair from the frozen source-aware snapshot and fail closed when that pair
is absent; Playbook or the legacy aggregate row cannot substitute. This does not change the
older market-correction and conflict rules that were designed around their existing aggregate
input. Evidence and rollback details are recorded in
`docs/model-audits/2026-08-11-mlb-moneyline-sharpapi-source-alignment-r34.md`.

The August 11 r35 grade-policy release makes the existing low-ticket Total Under sleeve genuinely
market anchored. The same validated SharpAPI split, Under side, -145 through -105 price, at-most
35% ticket share, five-point money-below-tickets gap, high data quality, and projection-alignment
requirements remain. Model probability and model-versus-price edge remain visible context but no
longer veto this market-defined sleeve: the rows they excluded went 8-1 across seven dates and
were positive in chronological train, validation, and holdout. Existing holds, missing-price
failures, projection conflict, side corrections, and no-bet gates still have priority. Evidence
and rollback details are recorded in
`docs/model-audits/2026-08-11-mlb-total-under-market-anchored-r35.md`.

The August 12 r36 grade-policy release adds an independent, market-anchored Moneyline Lean
sleeve after the existing top-one portfolio ranker. It can promote an otherwise non-actionable,
unchanged final side only with complete high-quality/fresh data, a selected-side price from -120
through +200, at least a one-point opener-to-current implied-probability move toward that side,
and a frozen selected-side SharpAPI money-minus-ticket gap below 20 points. The recorded model
probability must remain in the observed 50%-plus selected-side range; 50% is an evidence-coverage
boundary, not a calibrated confidence claim. No 53%, 54%, or 55% grade threshold applies. It never
changes the selected side, probability, price, Best Angle flag, or stake, and it cannot bypass a
hold, no-bet, stale-data, missing-price, or side-correction gate. Current-head evidence was 23-11
at +40.5% locked-price ROI across 15 dates; after removing overlap with the existing ranker it was
22-11 at +36.5%. The August 12 paired dry run adds no current play. Evidence and rollback details
are recorded in `docs/model-audits/2026-08-12-mlb-market-led-moneyline-lean-r36.md`.

The August 12 r37 combined release supersedes the not-yet-deployed r36 sleeve and incorporates
the full MLB/WNBA market-pattern search. For MLB Moneylines, a movement Lean now requires at
least a 1.5-point opener-to-current implied-probability move, a -200 through +200 price, a
selected-side SharpAPI money-minus-ticket gap below 10, and an unchanged, correction-safe final
side. The full cohort was 15-5; after the existing r32 ranker was removed, the incremental cohort
was 11-5, with the recent validation and holdout periods going 9-2. The broader one-point rule was
rejected after final-side changes were separated and its early period was negative.

R37 also adds a neutral-movement Moneyline Best Angle only when both selected-side SharpAPI
tickets and money are at least 70%, data quality is high, the price is -200 through +200, and no
market correction or inversion fired. It went 45-15 (+26.4% ROI): 27-9 train, 14-5 validation,
and 4-1 holdout. Sensitivity at 70%, 75%, and 80% was stable; lower incremental bands were not
promoted because they borrowed most of their strength from this 70% cohort. No model-probability
floor is used.

For MLB totals, r37 adds an Under-only SharpAPI support Lean at -145 through +145 when selected-
side money exceeds tickets by at least 10 points, movement is not against the pick, and quality is
high. It went 17-5: 8-1 train, 5-3 validation, and 4-1 holdout. The corresponding Over branch was
rejected after going 6-6 in both validation and holdout. R37 also preserves a complete two-sided
first-inning market as a non-actionable Toss-Up when lineups are publishable but a probable
starter has genuinely not yet been published; an absent FI market, lineup problem, or scratch
still holds.

The August 12 r38 integration release preserves every r37 side, probability, grade, price, and
stake rule while fixing the authoritative record writer's handoff for that unpublished-probable
first-inning case. R37 correctly produced a market-backed non-actionable Toss-Up in
`game_predictions`, but the record writer still allowed only the older sparse-named-starter
reason and omitted the public `prediction_records` row. R38 recognizes both explicitly approved
Toss-Up reasons. It cannot create an actionable FI play and still fails closed for an absent FI
market, lineup failure, scratch, or any blocker outside opposing-starter FI availability.

The August 13 r39 totals replacement release stands down the older generic validated-Lean sleeve
after its exact post-launch cohort went 5-8 (-23.5% locked-price ROI). It replaces that sleeve
with a narrower, market-confirmed original-Under path: when the mean-side correction is rejected,
the unchanged original Under may become a Lean only with an exact two-sided SharpAPI split, high
data quality, a real -145 through +145 selected-side price, and every missing-market, divergence,
or explicit no-bet safeguard clear. It never flips the side or changes the price, probability,
projection, Best Angle status, or stake. Frozen-context forward replay was 19-6-1 (+41.1% ROI),
positive in all four chronological weeks; date-block bootstrap P(profitable) was 0.9952. The Over
branch was rejected at 1-7. Historical paired impact removes 13 old-sleeve Leans and adds 26 new
Under Leans (net +13); the August 13 paired board adds four Leans with no current old-sleeve
demotion. Rollback is the exact r38 release and v28 grade policy. Full evidence is recorded in
`docs/model-audits/2026-08-13-mlb-total-mean-selector-original-under-r39.md`.

The August 13 r40 Moneyline continuity release closes the interaction gap between r37's
neutral-consensus Best Angle and its movement Lean. A high-quality, fresh, correction-safe
Moneyline with a -200 through +200 price and exact selected-side SharpAPI tickets and money both
at least 70% remains a Best Angle only while movement is neutral. If movement becomes favorable,
the same evidence now produces a Lean rather than falling to Watchlist; movement against the pick
still receives no protection. The rule does not change the side, probability, projection, price,
or stake. Historical favorable-movement rows went 40-18 (+11.0% ROI); the previously
nonactionable incremental cohort went 24-8 (+17.8% ROI) and was positive in train, validation,
and holdout. The paired August 13 board adds one Lean—Texas at the current snapshot—with no
demotions. Evidence and rollback details are in
`docs/model-audits/2026-08-13-mlb-consensus-grade-continuity-r40.md`.

The August 14 r41 data-identity release prevents SharpAPI slate-rollover
contamination. The provider's event-id date is no longer trusted by itself:
before any split is merged, at least 70% of unique matchup identities must
resolve on the requested slate and the payload must fit that slate better than
the prior slate. Partial, stale, and ambiguous payloads fail closed. This does
not add or change a predictive rule, side, probability, projection, price, or
stake. At the incident snapshot, the provider returned ten matchup rows: only
two matched August 14 while nine matched August 13. The repeated MIL-LAD pair
had therefore received August 13 splits and incorrectly activated one Total
Lean; removing that false input changes exactly that action and manufactures no
replacement. The member reader separately recovers verified both-side movement
from canonical append-only price observations without feeding that recovery
into prediction decisions. Evidence and rollback details are in
`docs/model-audits/2026-08-14-mlb-sharp-slate-identity-and-reader-price-history-r41.md`.

The August 14 r42 completion release applies r41's same whole-payload schedule
identity gate to the separate Market Intelligence observation writer. The
post-r41 live audit proved that the recommendation signal path failed closed,
but the observation writer could still persist the stale repeated-matchup
payload and expose it to source-aware reader/history consumers. R42 rejects
that payload before current or history observations are built. No predictive
formula, side, probability, projection, valid price, or stake changes. Evidence
is recorded in
`docs/model-audits/2026-08-14-mlb-all-writer-sharp-slate-identity-r42.md`.

The August 11 tracking-contract v8 operational release keeps the shared MLB
`prediction_pipeline` lease authoritative while preventing an ordinary writer collision from
leaving a game visibly open for another five-minute interval. The targeted pregame sweep now
runs every minute and waits for the shared lease for at most 20 seconds before deferring to the
next minute. It does not open the lock window before T-60, add a writer, change any model,
probability, side, grade, or stake, or refresh a full slate on no-op sweeps. The incident and
rollback evidence are recorded in
`docs/model-audits/2026-08-11-mlb-lock-priority-retry-v8.md`.

The August 20 EPL tracking-aggregate v2 release preserves the competition
identity in the bounded tracking query. This keeps unlocked EPL rehearsals out
of official accuracy, preserves the immutable T-60 locked row as canonical,
and separates Premier League results from World Cup history without changing
any EPL prediction, probability, projection, grade, price, or stake. Evidence
and rollback details are recorded in
`docs/model-audits/2026-08-20-epl-tracking-aggregate-identity-v2.md`.

The August 11 r32 release adds a slate-level MLB Moneyline portfolio ranker after all existing
side selection, correction, no-bet, price, freshness, and data-quality gates. It jointly scores
the frozen model probability, offered-price break-even, model-versus-price edge, picked-side
ticket and money shares, their gap, price shape, and captured opener-to-lock market behavior.
It may promote at most the highest-ranked qualifying Watchlist to Lean; it is not a quota and
may add no play. A qualifying row needs at least 50% model probability—the structural boundary
at which the binary model prefers the selected side—a price from -220 through
+200, a learned probability at least equal to the offered break-even, complete high-quality
market evidence, and no movement against the pick. It never changes the side, probability,
projection, price, Best Angle status, or stake.
Its ticket and money inputs must be the frozen selected-side SharpAPI observations used in the
training reconstruction; missing SharpAPI data makes the candidate ineligible.

Exact-record floor sensitivity found no defensible 55% cliff: under the current probability head,
the 50-52%, 52-54%, 54-55%, 55-56%, and 56-58% non-actionable bands were not monotonic. With the
50% selected-side floor, current-head daily walk-forward selection produced 25 plays at 20-5 and
+40.9% locked-price ROI across July 11-August 8. Allowing a second or third daily selection
degraded materially, so only rank one is live. The paired August 11
replay adds one Moneyline Lean (Cincinnati at the then-current +135) to the previously zero-action
Moneyline board; totals and first-inning decisions are unchanged by this ranker. Evidence and
rollback details are recorded in
`docs/model-audits/2026-08-11-mlb-sharp-portfolio-selected-side-floor-r32.md`.

The August 11 r28 first-inning availability release keeps MLB Stats as the authoritative starter
source and fills only an empty side through the existing ESPN probable-pitcher fallback. The
shared service retries ESPN's equivalent official site API host when its primary host is empty or
unavailable from production. A game with named probable starters, a complete two-sided FI market,
and publishable offense context now degrades to a non-actionable Toss-Up when verified starter
history is sparse; an actually unknown starter or missing FI market remains an explicit hold.
The r28 tracking-coherence follow-up preserves that Toss-Up in `prediction_records` even though
its retained audit correctly says the directional fresh-data gate did not pass. It never assigns
a side, price, edge, units, or actionable grade to that row. Data-health actionable counts now
use the actual member grades (Lean/Best Angle) instead of counting Watchlists as actionables.
The tracking follow-up is recorded in
`docs/model-audits/2026-08-11-daily-edge-fi-tracking-coherence-r28.md`.
The paired live-slate replay is recorded in
`docs/model-audits/2026-08-11-daily-edge-fi-probable-availability-r27.md`.

## NBA regular-season champion (active from 2026-10-20)

- Model / prediction record: `nba_v2_independent_first_2026_10_06_r1`
- Market marriage: `nba_market_marriage_2026_10_06_r1_independent_first`
- Grade policy: `nba_grade_policy_2026_10_06_r1_coherent_exact_price`
- Lock coherence: `nba_lock_coherence_2026_10_06_r1_official_and_context_tuple`
- Official markets: moneyline and total; Spread remains the existing context-only card market

The October 6 r1 release corrects NBA season identity, excludes unfinished/preseason rows from the
early-season sample, uses the regular-season context outside the playoffs, and replaces the old
continuous market-grounded score with the independent possession/efficiency/Four-Factors score. A
regressed prior-season handoff owns October-November until current-season evidence accumulates. Market
evidence remains downstream for exact-line probability, coherent same-book fair-price economics and
grades. Spread and Total are solved at the exact displayed consensus line; books or handicap points are
never crossed to fabricate a no-vig pair. Missing selected-side price/fair evidence cannot create an
actionable grade. No unvalidated NBA score flip is active.

The existing pregame sweep now performs a bounded final NBA line refresh and sole-writer pass at T-60,
verifies a coherent current-release Moneyline/Total tuple plus the captured context Spread, and only then
locks both official rows. Prior locks remain immutable. The board stays closed through October 19 and
opens automatically on October 20 without member copy, label, or layout changes. Evidence and explicit
limitations: `docs/model-audits/2026-10-06-nba-independent-first-regular-season-r1.md`.

## NBA/NHL operational refresh schedules

- NBA refresh release: `nba_daily_refresh_schedule_2026_10_07_r3_readiness_gated_rollover`
- NBA schedule: stable-input refresh once daily at `30 11 * * *`; volatile seed/line/snapshot refresh hourly at `12 6-10,12 * * *` and every 30 minutes at `12,42 0-5,13-23 * * *`; all writes fail closed unless `NBA_CRON_ENABLED=true`
- NBA public-tracking eligibility: `nba_tracking_window_2026_10_05_r2_preseason_only`; valid prior-season history remains eligible, dates `2026-07-01` through `2026-10-19` are excluded, and the 2026-27 regular season is eligible from `2026-10-20`
- NBA member-board eligibility: `nba_member_board_window_2026_10_05_r1_preseason_snapshot_guard`; the member API returns an empty slate inside the same closed preseason window before consulting response snapshots, while regular-season model behavior begins unchanged on `2026-10-20`
- NHL refresh release: `nhl_daily_refresh_schedule_2026_10_08_r10_pregame_coverage_gate`
- NHL schedule: stable-input refresh once daily at `45 11 * * *`; volatile seed/line/split/prediction/snapshot refresh hourly at `18 6-10 * * *` and every 30 minutes at `18,48 0-5,12-23 * * *`; all writes fail closed unless `NHL_CRON_ENABLED=true`

The October 7 NBA operational release replaces the long overnight writer gap with separated stable and volatile work. The existing route remains authoritative, joins the NBA prediction lease before publishing, and prepares a date-keyed snapshot ahead of the DST-safe 03:00 ET member cutover. A failed incoming run leaves the prior complete board in place without member copy or labels. The October 5 r2 NBA tracking-window correction preserves valid 2025-26 postseason history, excludes only the July 1 through October 19 offseason/preseason window from both member aggregate paths, and refuses to create NBA prediction records inside that window. Game, line, and score ingestion may continue for operational rehearsal, but preseason activity cannot affect public wins, losses, category records, recaps, or streaks. The paired member-board r1 guard applies that identical closed window before the Daily Edge response-snapshot fast path, preventing a cached rehearsal slate from rendering preseason cards beneath the already-correct `No games today` navigation state. It retains prior-season access and automatically permits the 2026-27 regular season board on October 20. For identical regular-season input, the rollover release changes zero sides, projections, probabilities, prices, grades, promotions, demotions, or actionable counts. NHL's October 7 readiness release preserves the existing complete-slate model and writer, separates daily team/goalie inputs from its volatile cadence, prepares the incoming date before the same DST-safe 03:00 ET cutover, and retains the prior complete board when the incoming source cycle is partial. A verified empty date is publishable readiness. The existing sport lease and r10 T-60 final market/lock owner remain authoritative. For identical regular-season input, the rollover release changes zero sides, projections, probabilities, prices, grades, promotions, demotions, or actionable counts.

The October 8 NHL r10 operational release applies the completeness gate only
to games still in a pregame state or lacking a complete three-market lock.
Live, final, canceled, or postponed games with complete immutable stored locks
are omitted from new pregame odds calls; a provider withdrawing their pregame
spread or Total after puck drop therefore
cannot block fresh prices and a coherent snapshot for later games on the same
slate. Unknown or scheduled states, and any non-pregame game without a complete
lock, still require complete coverage and fail closed. The October 8 exact
production replay changes the six incomplete-scope errors on four already-live,
fully locked games to zero while retaining full
three-market pricing for both upcoming games. Predictions, prices, grades,
locks, tracking, copy, labels, and layout are unchanged. Evidence and rollback:
`docs/model-audits/2026-10-08-nhl-pregame-coverage-gate-r10.md`.

## NHL regular-season champion (active from 2026-10-01)

- Model: `nhl_regular_2026_r17_target_excluded_total_reconciliation`
- Calibration: `nhl_regular_calibration_2026_r17_target_excluded_total_reconciliation`
- Decision: `nhl_regular_decision_2026_r17_target_excluded_total_reconciliation`
- Reader: `nhl_daily_edge_reader_2026_10_09_r13_target_excluded_total_reconciliation`
- Public tracking start: `2026-09-29`
- Official markets: moneyline, total, spread (puck line)
- Retired release: `nhl_v0_2026_finals`

The October 9 r17 professional market-reader release preserves the validated
r16 Moneyline arbitration and makes the Total score responsive to the complete
exact-line price board. The evaluated sportsbook family is removed before
forming the evidence board; at least two other complete over/under pairs are
required. Each pair is de-vigged, their median Over probability is mapped to a
Poisson Total mean, and that market target receives full authority with a
named-book pair or 80% with broad retail confirmation only. A stable named or
broad sequence moving against the endpoint reduces authority by 35%; missing
sequence is neutral. Public splits remain visible but do not move the score
because NHL's historical split observations cannot yet prove exact T-60
freshness. The goal margin is re-solved so r16 Moneyline probability is
preserved, then one joint distribution owns the final score, Moneyline,
puck-line, Total, probabilities, and grades.

If a side change moves the best evaluated price to another sportsbook, the
target exclusion is recomputed until the final side and excluded sportsbook
reach a fixed point; a cycle or incomplete remainder fails closed to r16.

Across the chronological 65-game audit, Total direction moves from 27-37-1 to
31-33-1 through six corrections and two harms; Total Brier improves from
0.28415 to 0.26362 and Total MAE from 2.01136 to 1.92811. One coherent puck
change adds one correction and no harm, retaining a combined plus-five net side
result. Moneyline remains exactly 41-24 with identical probability and
calibration. The unchanged grade policy moves 149 to 137 actionables through
six promotions and 20 demotions, while actionable accuracy moves from 53.38%
to 55.88%. The later 20-game segment improves Total direction from 6-14 to
9-11 and actionable exact-price return from -4.15u to +1.06u. The October 9
current-board rehearsal retains nine of 12 markets actionable, with one Total
side change, one grade change, and no Moneyline change. Existing locks retain
their exact stored r7-r16 payload and release identity. Evidence and rollback:
`docs/model-audits/2026-10-09-nhl-professional-market-reader-result.md`.

Reader r13 preserves stored writer snapshots as the authority before and after
lock. Only the no-record fallback invokes the same fixed-point target-excluded
calculation as the writer, preventing a cold read from displaying a different
score or side while the ordinary r17 tuple is being published.

The October 8 r16 correctness release gives the sole writer and member reader
one shared exact-quote selector. It accepts only a complete two-sided exact
market/line pair, rejects an isolated price more than 50 American points from
the candidate median when at least three books exist, and carries the selected
sportsbook, side, line, price, and observation time as one tuple. Future locks
persist that tuple in the existing snapshot. Reader r12 renders a locked row
from its stored prediction and frozen quote only; a later mutable odds refresh
cannot change its displayed price or sportsbook. Legacy locks remain byte-for-
byte unchanged, and an ambiguous unstored legacy sportsbook is left unknown
rather than invented. The October 8 zero-write board replay preserves all 24
locked market records and produces six unlocked future records with zero side,
score, probability, grade, promotion, demotion, or actionable-count changes.
No provider call, schedule, lease, member copy, label, layout, coefficient,
threshold, stake, or tracking rule changes. Evidence and rollback:
`docs/model-audits/2026-10-08-nhl-exact-quote-price-mapping-r16.md`.

The October 7 r15 correctness release uses three bounded exact-event full-game
market scopes so a single partial generic response can no longer suppress the
other available named books. It rejects incoherent two-way pairs before they
can drive consensus, movement, or best-price grading. The current three-game
replay restores 18–19 complete books and 112–118 canonical rows per game while
preserving every score, prediction side, grade, and the five-actionable board.
Promotions and demotions are zero. No new writer, schedule, lease, member copy,
label, layout, stake, threshold, or model coefficient is introduced. Evidence
and rollback: `docs/model-audits/2026-10-07-nhl-complete-multibook-market-ingestion-r15.md`.

The October 3 r14 release preserves every r13 score, probability, prediction
side, market-reading decision, price, stake, writer, lease, schedule, lock,
tracking row, and member-facing surface. It reserves Moneyline Best Angle for
at least 70% selected-side probability and a 5-percentage-point exact-price
edge, and Total Best Angle for at least 65% calibrated selected-side
probability and the same 5-point exact-price edge. A previously actionable
Best Angle that misses those stricter confidence requirements remains a Lean;
no play is removed. The validated puck-line policy and its Watchlist-to-Lean
promotion remain unchanged.

The exact October 3 production-board replay moves 14 Best Angles / 16 Leans /
9 Watchlists to 6 / 24 / 9. Eight Best Angles become Leans, while all 30
actionable markets, all 39 market rows, and every pick remain. Current r13
settled evidence is only 11 Best Angles and is treated as a warning rather
than an accuracy estimate: Totals were 2-5 and Moneylines 1-3. Evidence and
rollback: `docs/model-audits/2026-10-03-nhl-best-angle-calibration-r14.md`.

The October 1 r13 release preserves the r12 independent model, market-reading
arbitration, coherent projected score, probabilities, and prediction sides. It
makes the existing exact-price grade surface explicitly price-aware: a Best
Angle at -200 or shorter remains actionable as a Lean, while a selected price
of -900 or shorter is a No Play. The paired promotion path moves a puck-line
Watchlist to Lean only at the already validated 58% selected-side probability
and 5-percentage-point exact-price edge band. On the October 1 production board,
the exact replay changes 10 Best Angles / 6 Leans / 8 Watchlists to 8 / 8 / 8:
UTA -213 and EDM -208 move from Best Angle to Lean, with zero side changes,
zero No Plays, zero actionable promotions, zero actionable demotions, and all
16 actionables retained. This is a grade-only release; no member copy, label,
layout, score, probability, pick, provider call, writer, schedule, lease, lock,
or stake changes. The same release also lets a cold empty Daily Edge page
request the newly published server slate immediately, once per mount, while
retaining the normal 60-second refresh and last-known-good behavior. Evidence
and rollback:
`docs/model-audits/2026-10-01-nhl-price-aware-grade-and-empty-slate-recovery-r13.md`.

The September 30 r12 model release replaces opening-season stale-team behavior
with a target-excluded current-roster skater prior during each team's first ten
regular-season games, filters default goalie history to the verified current
roster, and falls back to neutral goalie context when no eligible current goalie
is known. Roster data is loaded once per slate and cached; the existing writer,
schedule, provider cadence, sport-scoped lease, lock, tracking, member copy,
labels, and layout remain unchanged. Current-season team evidence automatically
supersedes the opening roster path after the bounded window.

R12 also removes the generic continuous 20% market anchor. The independent
forecast is left intact unless current no-vig price, a continuous same-book
move, and complete source-aware money/ticket evidence all corroborate the
opposite side. A qualified current or future conflict becomes a discrete flip,
not a partial blend, and the final margin is solved into one coherent score
distribution while preserving the independent Total. Uncorroborated conflict
does nothing. The untouched 2025 replay improves winner, Brier, team-score MAE,
margin MAE, Total MAE, and puck-line direction; historical Total direction is
0.38 percentage points lower and is recorded as the reviewed score-accuracy
tradeoff. The September 30 board retains all nine markets and five actionables with two
promotions paired to two demotions. Locked r10/r9/r7 tuples remain immutable and
tracking-eligible. Evidence and rollback:
`docs/model-audits/2026-09-30-nhl-roster-market-arbitration-r12.md`.

The September 29 r10 lifecycle release preserves every r9 score coefficient,
market-reading weight, decision threshold, and grade. It corrects the live
handoff exposed after r9 deployment: NHL's daily writer had created the slate,
but the generic T-60 sweep froze that earlier tuple without rerunning the NHL
model against the newest exact-event prices and same-book trail. The existing
pregame sweep now refreshes only the entering NHL event, persists the ordinary
split fallbacks, reruns the sole NHL writer under the shared sport-scoped lease,
requires one coherent current-release Moneyline/Total/puck-line tuple, retires
only superseded unlocked transition rows, and then locks and republishes the
member snapshot. Locked r7 rows remain immutable and tracking-eligible. The
paired score/grade board impact is zero; this release changes freshness and
lock ownership rather than model math. Evidence:
`docs/model-audits/2026-09-29-nhl-t60-market-refresh-r10.md`.

The September 30 r7 reader release
`nhl_daily_edge_reader_2026_09_30_r7_sharp_split_identity` preserves the r10
model, calibration, decision, score, probability, grade, stake, lock, and
tracking contracts. It applies the established canonical NHL team normalizer
to both current SharpAPI named-book splits and the DraftKings Network fallback,
so provider labels such as `NY Islanders` and `LA Kings` match canonical `NYI`
and `LAK` cards. The existing Sharp Book Splits section, source hierarchy,
silent last-known-good continuity, and member copy remain unchanged. A missing
Total split now fails closed instead of borrowing the puck-line pair. A
production-feed replay covers all three September 30 games and all nine market
slots from SharpAPI, with DraftKings Network independently covering all six
available Moneyline/Total slots. Evidence:
`docs/model-audits/2026-09-30-nhl-sharp-split-identity-r7.md`.

The September 30 r8 reader release
`nhl_daily_edge_reader_2026_09_30_r8_split_source_independence` prevents one
SharpAPI named-book observation from populating both Public Consensus and Sharp
Book Splits. Public Consensus now requires independently resolved Playbook
multi-book evidence. SharpAPI named-book splits and DraftKings Network remain
eligible for the existing Sharp Book section and last-known-good continuity, so
the fallback does not disappear. If independent sources genuinely agree, both
may display. No copy, label, layout, model input, score, side, probability,
grade, stake, lock, or tracking behavior changes; promotions/demotions and the
actionable-count change are all zero. Evidence and rollback:
`docs/model-audits/2026-09-30-market-evidence-source-integrity.md`.

The September 30 r9 reader release
`nhl_daily_edge_reader_2026_09_30_r9_independent_public_retail_fallback`
preserves r8 source independence while filling an empty public lane from a
complete BetMGM retail row when the final Sharp Book section is owned by a
different named book. Playbook remains primary for Public Consensus; Circa and
DraftKings retain the existing Sharp Book hierarchy and continuity. The same
book or observation can never occupy both panels, and a missing distinct retail
row leaves Public Consensus unavailable. The current three-game / nine-market
board has zero promotions, demotions, actionable-count changes, or changes to
scores, sides, probabilities, grades, actions, stakes, locks, or tracking.
No copy, label, layout, provider call, schedule, writer, or lease changes.
Evidence and rollback:
`docs/model-audits/2026-09-30-nhl-independent-public-retail-fallback-r9.md`.

The September 30 r10 reader release
`nhl_daily_edge_reader_2026_09_30_r10_playbook_identity_repair` repairs the
NHL-only Playbook observation join: canonical database abbreviations and
Playbook full team names now resolve through the same existing NHL normalizer.
This restores the independent Public Consensus lane from complete Playbook
money-and-ticket rows while SharpAPI named-book evidence remains exclusively in
Sharp Book Splits. It adds no request, writer, schedule, lease, copy, label, or
layout. Public splits remain display/internal evidence only and do not alter the
r10 score or grade equations; projected scores, sides, probabilities, prices,
grades, stakes, locks, tracking, board count, promotions, demotions, and
actionable count are unchanged. Evidence and rollback:
`docs/model-audits/2026-09-30-nhl-playbook-split-identity-r10.md`.

The October 6 r11 reader release
`nhl_daily_edge_reader_2026_10_06_r11_grade_tracking_parity` preserves every
r14 forecast, projected score, probability, exact-price decision, price-aware
grade, stake, lock, split source, and market-reading equation. It repairs two
deterministic publication/tracking gaps. First, the NHL Daily Edge reader now
consumes each market's price-aware writer decision and translates an actionable
NHL `model_only` storage token to the same Lean
grade already used by official tracking; `no_bet=true` still resolves to No
Play, and other sports retain their existing token meanings. It also accepts
the NHL writer's `best_signal` token as Best Angle. Second, the NHL settlement
service grades the already-official `spread` records as signed puck lines,
including pushes, rather than leaving them pending. The member puck-line chip
therefore no longer carries the obsolete context-only asterisk. This release
does not rewrite a locked prediction, add a market, change board count, or
introduce copy or labels. The ordinary settlement job may now settle previously
pending official puck-line records from their immutable locked tuple and
official final score. Forecast promotions/demotions are 0/0 because the writer
decisions are unchanged; the reader now truthfully renders those decisions.
Evidence:
`docs/model-audits/2026-10-06-remaining-sport-market-reading-result.md`.

Only NHL game type `02` is eligible for the reader, writer, and public tracking.
The September 22 game type `01` rows are preseason audit evidence and never enter
member tracking. The independent runtime exactly replays the release-pure 2026
opening priors and prior settled regular-season results, then applies the selected
market weights to produce one coherent projected score. BallDontLie NHL is the
cached current/prior stats provider; MoneyPuck remains the advanced prior context.

Public money/ticket observations are stored separately by Playbook and SharpAPI.
The product prefers the latest complete Playbook pair and silently falls back to
the latest complete SharpAPI pair. Failed refreshes do not clear the previous
complete observation and the member UI adds no freshness labels or copy. The
resolved source, provider agreement, and confidence are also retained internally
in the prediction snapshot so fallback evidence is no longer indistinguishable
from aligned dual-provider evidence. Public-consensus splits do not change the
r10 projected score. Named same-book Circa, Pinnacle, then Bookmaker movement
remains the trusted projection-moving lane; the no-vig multi-book price remains
the bounded Moneyline sanity input.

The September 29 r9 source-trust release evaluated 589 current-era games with
frozen pregame Playbook splits, official settled scores, and release-parity
independent forecasts. On the 147-game chronological confirmation window, the
independent Moneyline was 55.78%; the 20% price-sanity path without a public-
split nudge was 56.46%; adding the public-split nudge reduced direction to
54.42%. A learned conditional path was 55.78% and worsened probability
calibration. Money-minus-ticket direction was unstable across development,
tuning, and confirmation (55.52%, 48.80%, 56.03%). For Totals, the independent
path was 58.22% on 146 non-pushes while the learned conditional path fell to
56.16%. R9 therefore removes only unvalidated public-consensus projection
nudges. It changes no independent coefficient, no-vig price weight, named
same-book movement, exact-price threshold, stake, provider call, writer,
schedule, member copy, label, or layout. Evidence:
`docs/model-audits/2026-09-29-nhl-source-aware-market-trust-r9.md`.

The September 29 r8 validation release retains the r7 independent score,
opponent-adjusted Total, and 20% Moneyline market sanity path. Correcting the
historical settlement target for shootout-deciding goals invalidated the proposed
learned market blend: on 1,311 untouched 2025 games it made 132 flips with 61
corrections and 71 regressions. The current path was 55.07% on Moneylines,
53.56% on Totals, and 67.43% on puck-line direction. High-conviction validation
cohorts were 65.00% Moneyline at 12pp+ winner conviction and 62.22% Totals at a
0.5-goal+ model-line gap. A 5pp+ exact-price puck-line edge returned +2.56% in
2024 selection and +8.76% in untouched 2025 confirmation; only that stable band
can receive a puck-line Best Angle. The live transition replay retains 5/5 games,
15/15 markets, and 10 actionables. Already-locked r7 rows remain immutable,
visible, and tracking-eligible; only unlocked or future rows advance to r9.
Evidence: `docs/model-audits/2026-09-29-nhl-professional-architecture-market-marriage-r8.md`.

The September 29 r2 input-coverage release keeps the validated r1 coefficients
unchanged but replaces the incomplete league-wide odds scan with exact-event
retrieval. The opening-night slate supplies two-sided moneyline, total, and puck-
line inputs for every game. The opening-night five-game path uses eight provider calls;
a targeted market request is added only when props crowd a required game market
off the first event page. The release is separate because restoring missing prices
changes model inputs and member actionability.

The release-pure untouched holdout was 57.14% moneyline (336), 53.62% total
direction (207), and 67.86% puck line (336). The three-market candidate produced
821 actionable holdout decisions and zero demotions from an active regular-season
board because no prior regular-season board existed. Full design, source manifest,
board impact, failure behavior, and rollback are recorded in
`docs/model-audits/2026-09-23-nhl-regular-season-r1-predeclaration.md` and
`docs/model-audits/2026-09-23-nhl-regular-season-r1-result.md`. Complete-slate
input recovery is recorded in
`docs/model-audits/2026-09-29-nhl-complete-slate-odds-r2.md`.

The September 29 r3 professional joint-score release replaces the 90%-market-
anchored Total construction with a sport-specific rolling score model and a
coherent joint Poisson distribution. The independently modeled Total receives
zero fixed market-line weight. A separately calibrated ability-to-win head and
20% Moneyline sanity correction improve score error and winner probability
calibration; verified same-book movement and provider-separated splits remain
bounded conditional corrections. All three market sides derive from the same
decimal score means. The exact protocol, 394-game untouched holdout, current-
board promotions/demotions, input fallbacks, and rollback gates are recorded in
`docs/model-audits/2026-09-29-nhl-professional-joint-score-r3-predeclaration.md`
and
`docs/model-audits/2026-09-29-nhl-professional-joint-score-r3-result.md`.

The September 29 r4 quoted-puck-pair release retains the r3 score-model
coefficients and probability calibration unchanged. It makes the current-line
resolver order-independent when one sportsbook supplies repeated zero-handicap
rows alongside the actual `-1.5/+1.5` pair. Every complementary pair is now
enumerated per book and the existing main-puckline priority selects the real
quoted pair. The live MTL-TOR regression, board impact, and rollback gate are
recorded in
`docs/model-audits/2026-09-29-nhl-quoted-puck-pair-r4.md`.

The September 29 r5 total-confidence release retains every r4 score, side,
market line, price, grade, market-reading input, writer, lock rule, and member
surface. It replaces only the raw conditional Poisson Total confidence with a
release-pure Platt calibration fitted on priced 2024 games and reported once on
all 1,303 non-push priced 2025 Totals. Brier score improves from 0.247512 to
0.246984 and log loss from 0.688161 to 0.687084, while the 2025 Total direction
remains 54.95%. The existing grade policy remains non-flat and chronologically
stable: Best Angle Totals were 58.30% in 2024 and 57.51% in 2025; Leans were
53.60% and 55.28%. The current five-game board retains four Best Angles and one
Lean with no promotion, demotion, side, or score change. Evidence and rollback
are recorded in
`docs/model-audits/2026-09-29-nhl-total-confidence-calibration-r5.md`.

The September 29 r6 opponent-adjusted Total hybrid retains the r5 Moneyline
probability and winner exactly, retains puck-line direction, and replaces only
the weaker independent scoring-Total component. A recency-weighted 2018-2024
score fit consumes a pregame opponent-adjusted expected-goals state. The final
margin is solved at the repaired Total so one coherent joint Poisson distribution
preserves the r5 home-win probability. On the 394-game untouched priced-2025
segment, team-score MAE improves from 1.393818 to 1.389944, Total MAE from
1.857158 to 1.849124, and Total direction from 56.56% to 58.61%; Moneyline
accuracy/calibration and puck-line direction are unchanged. Full priced-2025
team-score, margin, and Total MAE also improve. The five-game opening board keeps
all 15 markets and 14 actionables, with one promotion and no demotion or side
change. Current-season game rows are applied only before the target slate; an
unavailable or incomplete update silently executes the exact r5 Total fallback
and cannot remove the board. Evidence and rollback gates are in
`docs/model-audits/2026-09-29-nhl-matchup-total-hybrid-r6-result.md`.

Reader follow-up `nhl_daily_edge_reader_2026_09_29_r2_writer_tuple_coherence`
uses the sole writer's active-release model/feature tuple for unlocked and
locked cards while continuing to read current prices separately. This prevents
an unlocked r6 record from being displayed with a state-missing r5 fallback.
Sibling market snapshots must be identical before the tuple is accepted. No
model, probability, score, grade, provider call, lock, member copy, label, or
layout changes. Evidence and rollback are in
`docs/model-audits/2026-09-29-nhl-r6-reader-tuple-coherence.md`.

The September 29 r7 runtime-parity release repairs a production/training unit
mismatch in the r6 special-teams inputs. The score fit was trained on expected
goals per game but live production supplied expected goals per 60 special-
teams minutes, compressing every opening-night Total toward five. r7 restores
the trained units without changing coefficients. Reader r3 exposes both sides
and same-book history through the existing price-trail contract, while refresh
r5 filters inactive/live/stale/alternate rows and accepts only coherent paired
quotes. The five-game replay retains all 15 markets and 10 actionables across
all three market families. Evidence, the explicit correctness exception and
rollback gates are in
`docs/model-audits/2026-09-29-nhl-runtime-parity-two-sided-prices-r7.md`.

The corrected September 29 r8 validation retains the r7 independent score,
opponent-adjusted Total, and validated 20% Moneyline market sanity path. The
proposed learned market blend is rejected after restoring official shootout
settlement outcomes: on 1,311 untouched priced 2025 games it fell from 55.07%
to 54.23% winner accuracy and made 71 bad flips against 61 corrections. Puck-
line Best Angle now requires a quoted exact-price edge of at least 5pp, the only
tested edge band with positive ROI in both 2024 selection and untouched 2025
confirmation. Split source/agreement confidence is retained internally for
forward evaluation but does not receive an unvalidated side-flip weight. Reader
release `nhl_daily_edge_reader_2026_09_29_r5_source_aware_transition`
preserves locked r7 tuples and quarantines incoherence by release; the writer
also preserves any locked transition row when both release rows coexist. The
five-game replay retains all 15 markets and 10 actionables across Moneyline,
Total, and puck line. Full corrected architecture research, rejected candidates,
board impact, and rollback gates are in
`docs/model-audits/2026-09-29-nhl-professional-architecture-market-marriage-r8.md`.

## WNBA champion

- Model: `wnba_v1_7_professional_market_evidence`
- Distribution: `wnba_coherent_normal_2026_10_06_v8_independent_first_decision_crossing`
- Calibration schema: `wnba_core_calibration_v4_single_market_entry`
- Grade policy: `wnba_grade_policy_v12_provenance_qualified_market_context_2026_10_09`
- Decision-tuple contract: `wnba_decision_tuple_v4_single_market_entry_2026_09_03`
- Prediction-record contract: `wnba_prediction_record_contract_v8_exact_price_denominator_2026_09_19`
- Machine registry: `lib/automodel/wnbaChampionRuntime.ts`
- Authoritative model writer: `lib/services/wnba/runWnbaModel.ts`
- Tracking writer: `lib/services/wnba/buildWnbaPredictionRecords.ts`
- Member reader: `lib/services/wnba/buildWnbaDailyEdgeAdapted.ts`
- Member-reader release:
  `wnba_daily_edge_reader_2026_10_09_r2_provenance_qualified_market_context`
- Scheduled owner: `/api/cron/wnba-daily-refresh` under the WNBA-scoped shared
  `prediction_pipeline` lease
- Operational refresh release:
  `wnba_daily_refresh_schedule_2026_10_07_r1_readiness_gated_cadence`
- Operational cadence: one three-day full preparation at `23 11 * * *`;
  current-slate intraday work hourly at `23 4-10,12 * * *` and every 30
  minutes at `23,53 0-3,13-23 * * *`. The default member board changes at
  03:00 America/New_York only after the incoming snapshot exists. A partial
  incoming cycle silently retains the prior complete board. Evidence and
  rollback:
  `docs/model-audits/2026-10-07-wnba-readiness-gated-cadence-predeclaration.md`.

The October 9 v1.7/v12/r2 candidate preserves v1.6's independent-first,
target-book-excluded Moneyline/Spread crossing rule and its coherent score
distribution. It repairs the evidence substrate: `line_history` is paginated
oldest-to-newest across the complete result rather than silently accepting the
server's newest-page cap; provider-opener metadata and `sharp_signals.computed_at`
are frozen; and the source-aware split archive is joined by canonical WNBA event
before every future unlocked decision. Generic money/ticket thresholds no longer
promote, demote, or veto a WNBA grade when source observation time and sharp-book
lineage are unverified. Those rows remain visible in the audit payload as
observation-only context, and missing splits remain neutral. Existing locked rows
remain byte-authoritative and are never recomputed. Predeclaration, complete loss
review, rejected candidates, board impact, and rollback gates are recorded in
`docs/model-audits/2026-10-09-wnba-professional-market-evidence-predeclaration.md`.

The September 3 v1.4/v6/v9 release retains the v1.3 removal of evaluated-book self-validation from Moneyline,
Spread, and Total. Complete paired evidence must be fresh, predecision, prestart, same-book,
same-line, and no more than 30 seconds skewed. The evaluated book and line are fixed from the
independent forecast before inference and that book is then excluded. Market authority requires
at least two remaining books from two conservatively independent source families. Circa,
Pinnacle, and Bookmaker retain distinct originator identities; every non-originator SharpAPI
label shares one unverified-lineage family. Missing, tied, stale, incomplete, singleton, or
correlated evidence returns the exact independent sport-model forecast. A posterior side change
is repriced from the complementary side of the same fixed evaluated pair, so price drives EV and
grade only and cannot select the forecast.

The target-excluded Moneyline consensus now enters the forecast exactly once. It no longer first
rewrites a cold-start team's Elo prior and then enters again through the dynamic Moneyline blend;
the sport-owned cold-start prior remains authoritative before that single market interpretation.
If qualified target-excluded Moneyline and Spread evidence imply opposing winner regimes, the
complete market story is classified as contradictory and all market forecast authority stands
down to the exact independent distribution. This is an evidence-quality fallback, not a
winner-only override: compatible evidence may retain or legitimately reverse the independent
winner, and the resulting single margin distribution regenerates probability, margin, score and
Spread together.

The September 19 v8 prediction-record handoff preserves the target-excluded fair probability as
the higher-authority market denominator when it exists. When it is intentionally null because
the remaining books do not span two independent source families, the already evaluated named-book
quote supplies only its exact break-even probability for value display, tracking evidence, and
health checks. It does not enter the forecast, validate its own side, or change the v1.4 model,
v6 distribution, v9 grade, decision tuple, board count, stake, writer, lease, or provider load.
Evidence and rollback: `docs/model-audits/2026-09-19-wnba-exact-price-denominator-r8.md`.

The September 29 v1.5/v7/v10 release replaces the sign-tilted final margin
distribution with one coherent normal distribution centered on the existing
validated expected margin. The prior distribution could preserve a separate
Moneyline probability and expected margin even when they implied opposing
winners or opposing sides of the quoted spread; the member score used the mean
while the predictions used those separate probability cuts. The new release
derives Moneyline probability, Spread probability, projected-score margin and
both selected sides from the same expected margin and incumbent variance. Total
projection and Total decisions are unchanged. Target-excluded Moneyline evidence
remains available once for exact-price value, conflict detection and audit;
qualified target-excluded Spread consensus retains the established 25/75 center.
No copy, label, layout, stake, provider request, writer, lease, schedule, lock, or
tracking-boundary behavior changes.

On 38 settled release-era games, the retained expected margin recorded 11.1979
margin MAE and 31/38 winner direction versus 11.3465 and 28/38 for the
probability-median display alternative. On 37 non-push spreads, the expected
margin implied 24/37 correct sides versus 22/37 for the prior published side.
All 38 Moneyline identities and all 37 Spread identities become score-coherent.
The current two-game board changes New York Moneyline Lean to Minnesota
Watchlist and Indiana -1.5 Watchlist to Las Vegas +1.5 Watchlist; both Totals and
all other grades remain. Actionables move 2 to 1: one owner-approved accuracy
demotion, zero promotions, with the existing symmetric exact-price promotion
paths retained. Evidence and rollback are recorded in
`docs/model-audits/2026-09-29-wnba-score-prediction-coherence.md`.

The October 6 v1.6/v8/v11 release removes the remaining continuous 25%
independent / 75% market-implied Spread center. The independent coherent margin
is now the exact default. Complete, fresh, target-excluded evidence from at
least two independently classified source families may use the already
qualified market center only when it crosses the independent winner or exact
Spread decision boundary and the Moneyline/Spread market story is not
contradictory. Evidence that agrees without crossing remains available for
price economics, grading and audit but has zero forecast effect. A qualified
crossing regenerates Moneyline probability, Spread probability and both decimal
team scores from one coherent margin distribution; the independent Total head
is byte/number-identical. The evaluated sportsbook never enters forecast
evidence.

The predeclared release-pure replay contained 42 settled forward games. Against
the v1.5 incumbent, the selected rule improved margin MAE from 11.8459 to
11.5658 and team-score MAE from 8.6589 to 8.6273 while preserving 33/42 winner
and 26/41 non-push Spread accuracy. On the untouched final 14-game chronological
block it improved incumbent margin MAE from 12.3143 to 11.7627 and team-score
MAE from 9.2547 to 9.1274 while preserving 9/14 winner and 10/14 Spread
accuracy. Only seven of 42 forecasts used market arbitration instead of all 42.
Same-book movement-only challengers were rejected because the stored movement
sample was too sparse and worsened directional accuracy. The October 6 live
slate contains zero WNBA games, so same-input board impact is zero promotions,
zero demotions and zero side changes; structural exact-price fixtures continue
to prove both promotion and demotion paths. No copy, label, layout, stake,
provider, schedule, writer, lease, lock or tracking-boundary behavior changes.
Evidence and rollback gates are in
`docs/model-audits/2026-10-06-wnba-independent-first-decision-crossing-result.md`.

The October 7 member-reader coherence release changes no WNBA model output,
prediction, probability, score, grade, stake, lock, or tracking tuple. Unlocked
market reads and movement trails now terminate at the same current same-book
quote displayed to members, while the writer's evaluated quote remains the
separate immutable grade price. Locked cards remain frozen at their lock quote.
The reader no longer applies a second negative-gap confidence cap to a current
v11 exact-price grade, and the deep audit uses the selected-side WNBA spread
sign convention. On the exact two-game live input the release preserves all
six market decisions, produces zero promotions and zero demotions, keeps four
actionables, and reduces the production deep-audit findings from eight to zero.
Evidence and rollback gates are in
`docs/model-audits/2026-10-07-wnba-current-quote-market-read-coherence.md`.

One versioned margin distribution preserves the final Moneyline win probability, expected
margin, and incumbent variance; Spread probabilities come from that same CDF, the independent
Total distribution supplies the total head, and decimal team scores are the algebraic
total/margin decomposition. Spread is independent-first; the former 25/75 center is considered
only for a qualified, non-contradictory winner or exact-Spread decision-boundary crossing.
Spread and Total can clear the former Watchlist caps only
when the established strength rules agree with a final-model probability edge over the evaluated
quote's break-even probability and at least 2% exact-price EV. Qualified target-excluded evidence
may move or corroborate the forecast, but a missing alternative set cannot suppress an
independently strong forecast at a genuine exact quote. Nonpositive economics demote without
changing the forecast. Public resistance remains active, while public support alone cannot
manufacture a Spread or Total action.

Structural fixtures prove both promotion and demotion paths, price-perturbation forecast
identity, correlated-retail fallback, newest coherent-pair selection, and singleton
non-flattening. The natural September 2 production board was empty: repeated leased refreshes
succeeded with zero provider calls and no capture rows. That is zero-slate operational health,
not a board-count or forecast-quality claim. The first real release-pure slate is scored
automatically. Evidence and rollback details are recorded in
`docs/model-audits/2026-09-02-wnba-authoritative-structural-market-result.md` and
`docs/model-audits/2026-09-03-wnba-v14-single-market-entry-result.md`.

The earlier v4/v5 spread promotion rules remain historical inputs to the current exact-value
intersection. They cannot bypass target exclusion or the positive-EV gate.

Exact current-release attribution removed five total/spread public promotions that went 0-5 and
added six spread agreement promotions that went 5-1 (+3.421 units), for a +1 board delta. The
broader historical promotion cohort reproduced at 14-3: 2-1 train, 6-1 validation, and 6-1
holdout.

The August 12 v5 policy adds a second, side-agnostic spread Lean path when the selected side has a
positive canonical projection gap, rest is not against that side, at least ten books quote the
spread, an exact selected-side price exists, and public conflict is absent. The cohort went 22-10
(+29.7% ROI): 9-6 train, 7-2 validation, and 6-2 holdout; 11-7 was incremental outside the v4
home Elo/stat agreement rule. It does not alter moneyline or total decisions.

The August 13 v6 coherence release preserves all v5 selection, projection, probability, price,
and grading rules, but makes the versioned WNBA writer grade authoritative in the member reader.
It removes a second, unversioned reader comparison between rounded display confidence and a
separately reconstructed no-vig probability that could silently demote an official Lean. Locked
v5-and-older rows retain their historical reader behavior. The current-slate paired dry run has
zero promotions and zero demotions; an August 1-14 diagnostic found four historical writer/reader
Lean-to-Watchlist mismatches that demonstrate the forward risk without rewriting that history.
Evidence and rollback details are recorded in
`docs/model-audits/2026-08-13-wnba-authoritative-reader-grade-v6.md`.

The August 21 v3 prediction-record contract preserves the champion model, side, probability,
grade, and stake behavior while binding each WNBA decision to one immutable evidence tuple:
model probability, market fair probability, outcome confidence, evaluated sportsbook/price/time,
grade, decision time, and release identifiers. Tracking copies that writer-owned tuple instead of
re-querying mutable odds. The reader exposes later quotes and point-line movement separately and
cannot regrade them; T-60 and already locked tuples remain frozen. The paired current-board dry
run retained three Leans and six Watchlists with zero promotions, demotions, side changes,
confidence changes, or stake changes.

The August 21 incoherent-total integrity follow-up preserves that same v3 release when a transient
provider board quotes the selected and opposing total sides at different point lines. The
authoritative writer carries forward a prior tuple only when side, line, exact model probability,
outcome confidence, grade, decision chronology, and every release identifier still match. The
unlocked reader may likewise reuse only the complete matching v3 tracking tuple; newer quotes at
another line remain separate context and cannot replace or regrade the evaluated decision. Locked
tuples still win unconditionally. The live GS@CHI reproduction and focused regression are recorded
in `docs/model-audits/2026-08-21-wnba-incoherent-total-tuple-fallback.md`.

## MLB Player Props production release

- Release: `mlb_props_2026_09_21_r43`
- Machine registry: `lib/mlb/props/marketModelVersions.ts`
- Authoritative writer: `/api/cron/mlb-player-props-refresh` through
  `refreshMlbPropsBoard`
- Status: authoritative signed-in member release

The September 21 r43 priced-offer retention release keeps fresh, supported pitcher offers visible when a confirmed probable starter has no recent MLB log sample. Such rows remain explicitly held by the existing Research or Data Check path with zero units. When no active scored model candidate exists, projection, probability, edge, EV, and fair odds remain null; when the established conservative pitcher scorer has an output but required member research is incomplete, the existing member-readiness gate preserves Data Check and zero units. r43 never substitutes the market for an independent model output. Hitter rows still require recent form, and every actionable pitcher row still requires the complete probability-backed model path. Snapshot validation permits a null projection only on an existing Research or Data Check hold and rejects it everywhere else. The writer, shared lease, provider budgets, exact-price selection, locks, tracking, UI copy, labels, and layout are unchanged. Evidence and rollback are recorded in `docs/model-audits/2026-09-21-mlb-props-priced-offer-retention-r43-predeclaration.md` and its paired result. Rollback is r42 without rewriting historical snapshots or locks.

The September 5 r42 price-confidence balance keeps the exact named-book quote attached and keeps
the underlying forecast, side, probability, projection, edge, EV, category eligibility, and
writer behavior unchanged. After every promotion and projection-side coherence check, ordinary
unlocked two-way Best Angles worse than -200 step down to Lean; any ordinary Best Angle or Lean
worse than -400 steps down to Watchlist with zero units. Exact -200 and -400 boundary prices retain
their higher permitted tier. The policy is a graduated confidence-placement ceiling, never a No
Play gate. Locked rows and separately validated milestone offers are immutable/exempt, and stakes
are unchanged for rows that remain actionable. On the September 5 13:27Z 5,963-row production
snapshot, 23 Best Angles / 85 Leans become 6 / 94, with nine Best Angle-to-Lean and eight Best
Angle-to-Watchlist changes. The September 4 snapshot moves 9 Best Angles / 3 Leans to 5 / 7 through
four Best Angle-to-Lean changes. Evidence and rollback:
`docs/model-audits/2026-09-05-mlb-props-price-confidence-r42-predeclaration.md` and
`docs/model-audits/2026-09-05-mlb-props-price-confidence-r42-result.md`. Roll back the runtime
release and price-confidence transform to r41 without changing historical snapshots or locks.

The September 2 r41 post-calibration coherence release leaves the r40 target-excluded posterior,
forecast side, decimal projection calibration, exact-price economics, category policies, and
missing-comparator neutrality unchanged. After every display projection calibration and portfolio
promotion has completed, an unlocked ordinary two-way Best Angle or Lean whose final displayed
projection opposes its evaluated side is downgraded to Watchlist with zero units and the existing
`PROJECTION_SIDE_CONTRADICTION` reason. Coherent actions remain eligible, and intentional one-sided
1+ Home Run milestone value offers remain exempt. The repair was prompted by Joshua Baez Over 0.5
RBIs at +281 retaining a Lean after its final projection calibrated to 0.42369049. Locked rows,
provider/query/write budgets, writer, lease, member UI, and every forecast/economic value remain
unchanged. Equal-input replay changes exactly that contradictory row from Lean to Watchlist
(`71 -> 70` actions; zero promotions/one safety demotion), removes the only ordinary actionable
projection contradiction, preserves all four Home Run milestone actions, and changes zero
probability/projection/side/price/economics tuples or locked rows. RBI remains populated with 395
rows; its sole prior action was the contradictory row, so actionability becomes zero without a
fabricated replacement. A second 3,534-row natural r40 snapshot reproduces the same one-row
correction (`53 -> 52` actions), preserves five milestone actions, and leaves every other category
unchanged. Equal-input replay and live proof are recorded in
`docs/model-audits/2026-09-02-mlb-props-r41-post-calibration-coherence.md`. Rollback is r40 without
rewriting any r41 lock or tracking record.

The September 2 r40 target-excluded forecast release removes the evaluated
sportsbook from every actual forecast anchor. Pitcher recommendation consensus,
hitter exact-line synthesis, cross-market movement, opening/current movement,
and verified split adjustments use only other books; when no eligible
alternative exists, the existing independent player distribution remains the
authoritative forecast automatically. One complementary posterior determines
the side and calibrated decimal projection. The evaluated named-book quote is
then used only for exact-price EV and grade. A side crossing can grade only from
the exact complementary offer for the same book, line, and cycle; otherwise the
new prediction remains visible and non-actionable. Existing category priors,
caps, thresholds, health handling, locks, stakes, provider budgets, sole writer,
and `prediction_pipeline` lease are unchanged.

The frozen 5,962-row r38 replay changes 5,374 probabilities and 5,128 decimal
projections across 5,493 measurable rows, with 205 posterior side crossings.
Actionables move 172→137 through seven promotions and 42 demotions; the candidate
retains 45 Best Angles, 92 Leans, 1,880 Watchlists, 2,242 No Plays, 1,382 Research,
and 321 Pending Data rows. No previously actionable category becomes flat. All
90 crossings without an exact same-cycle complementary quote remain
non-actionable; actionable quote mismatches and actionable projection/side
contradictions are both zero. Health rows and locked tuples are unchanged.
Target-excluded comparator breadth is 2,011 / 2,480 / 807 / 244 for zero / one /
two / three-plus alternatives, with zero evaluated-offer forecast references
and zero verified split adjustments. Natural refreshes emit release-pure target-excluded/fallback/
action/lock/coherence telemetry; invalid refreshes keep the prior canonical/member snapshot and retry
through the ordinary writer. The first natural r39 cycle at `2026-09-02T21:17:20.939Z` made the
unchanged 28 provider calls, wrote zero rows, and retained r38 because the legacy publication
validator required a comparator-derived `modelEdge` even when the target-excluded comparator was
truthfully absent. R40 leaves every r39 forecast, projection, side, probability, grade, price, and
stake unchanged, but makes that absent comparator neutral at the publication gate. A present
comparator still requires a coherent edge, while stale or invalid prices, missing required research,
non-finite values, and projection-side action conflicts still fail closed. The refreshed 5,269-row
replay moves r38's 32 Best Angles / 94 Leans / 1,556 Watchlists / 1,796 No Plays / 1,468 Research /
323 Pending Data to 23 / 82 / 1,450 / 1,923 / 1,468 / 323, with 105 actionables, four promotions,
25 demotions, zero actionable quote mismatches, and zero actionable projection/side contradictions.
R40 adds no action relative to the already-reviewed r39 row policy; it permits the complete r39/r40
snapshot to pass the same truthful missing-data contract. Telemetry now separately reports
actionables without a target-excluded comparator and actionable data-gate failures. Rollback is the
complete r38 runtime set below. Evidence is in
`docs/model-audits/2026-09-02-mlb-props-target-excluded-forecast.md` and
`docs/model-audits/2026-09-02-mlb-props-r40-missing-comparator-gate.md`.

The September 1 r38 market-aware forecast release moves genuine exact-line
market context ahead of side, probability, projection, and grade finalization
inside the sole existing writer. The authoritative probability now combines
the sport-specific independent model with an all-book current exact-line
anchor, bounded same-book opening/current line and price movement, and bounded
coherent related-player-market movement. Exact fresh public/sharp split fields
may contribute only when supplied on the matching prop row; the current live
feed supplies none, so missing evidence is neutral. Grade economics use the
evaluated named-book quote and a target-book-excluded same-line reference.
Generic evidence can add only a zero-stake Watchlist with at least one point of
reference edge, at least 2% exact-price EV, and no materially adverse context;
Lean and Best Angle remain restricted to the already validated market sleeves.
The model projection moves monotonically with the same final probability and
retains natural internal precision; existing member formatting alone controls
display precision.

The no-write production replay at `2026-09-01T21:46:39.849Z` was publishable
and compared 5,630 identical offer IDs from the 5,683-row r37 board with the
5,690-row r38 candidate. It changed 5,169 final probabilities and 4,825
projections, with target-book-excluded references on 4,709 rows, exact opening
movement on 1,168, coherent cross-market movement on 2,553, and zero split
adjustments because no exact fresh split payload was available. Actionables
moved from 142 to 166 through 33 promotions and 9 demotions; 75 No Play rows
moved to exact-value Watchlist. No action quota or broad action head was added.
Every currently populated supported category retained a positive-grade path;
Batter Triples remained unpromoted because the current posted longshot
economics did not clear the frozen edge/EV gate, while the all-category fixture
proves a coherent qualifying triples offer reaches Watchlist. Rollback is r37.
Evidence is in
`docs/model-audits/2026-09-01-mlb-props-market-aware-forecast-r38.md`.

The August 19 r37 projection-accuracy release adds a post-decision affine
expected-count calibration for Batter Hits + Runs + RBI, Batter Strikeouts,
Batter Total Bases, Pitcher Earned Runs, Pitcher Hits Allowed, and Pitcher
Strikeouts. It is downstream of the complete decision pipeline and is
structurally unable to change a probability, selected side, grade,
actionability, or stake. A non-regression guard retains the prior projection
whenever calibration would introduce a new selected-side contradiction. The
other markets remain byte-for-byte unchanged by the calibrator.

Markets were selected on August 4-10 only when both MAE and RMSE improved and
both improved on at least two-thirds of validation dates, then refit without
holdout outcomes and opened once on August 11-17. All six selected markets
held. Across 13,166 holdout rows, aggregate MAE improved from 0.80415 to
0.78889 and RMSE from 1.22134 to 1.18411. Both date-clustered and player-game
clustered bootstraps put the probability of aggregate improvement at 100% in
20,000 resamples. Because this is expected-count calibration rather than a
probability or betting-policy result, it provides no new permission to promote
or stake a wager. Board impact is zero promotions, zero demotions, zero grade
changes, zero stake changes, and zero actionable-count change. Rollback is r36.
Evidence and the known projection/direction limitation are recorded in
`docs/model-audits/2026-08-19-mlb-props-display-projection-calibration-r37.md`.

The August 19 r36 incident release restores the existing optional-environment
contract at the final publication boundary. Park and game-time weather gaps
were already explicitly optional model inputs and were accepted by the row
scoring gate, but the later snapshot validator incorrectly counted those same
disclosed gaps as missing required research. That contradiction rejected every
scheduled refresh even though live prices, mappings, and model outputs were
healthy. R36 excludes only the already-declared optional environment fields
from the required-research publication error; opposing-starter, pitch-mix,
identity, recent-form, and other required gaps still fail closed row by row.
The paired August 19 dry run retained all 5,705 rows and 126 actionables with
zero promotions and zero demotions. Rollback is r35, which restores the
whole-slate publication outage whenever an optional environment field is
unavailable. Evidence is in
`docs/model-audits/2026-08-19-mlb-props-optional-environment-publication-r36.md`.

The August 14 r35 stake-contract correction restores the owner-approved unit
definition: every non-Home Run Lean or Best Angle is 1.00u, while the
diversified Home Run longshot portfolio is 0.25u. R34 had incorrectly stamped
ordinary actionables at 0.25u and the Home Run and RBI portfolios at 0.10u.
R35 changes no selected side, line, price, probability, projection, grade,
promotion/demotion rule, or actionable count. Historical locked rows retain
their original r34 stake metadata; reporting may normalize them explicitly but
must not rewrite them. The no-write August 14 rebuild was publishable with
5,631 rows, 146 actionables (141 standard and five Home Runs), zero stake-policy
mismatches, and zero grade changes attributable to this correction. Evidence
and rollback details are recorded in
`docs/model-audits/2026-08-14-player-props-unit-stake-contract-r35.md`.

The August 13 r34 model release retains r33's weather and three-play Home Run
portfolio and adds two capped Lean sleeves selected chronologically from the
all-market value tournament. The Home Run complement excludes every hitter
and game already selected by the r33 basket, requires +351 through +650, at
least two points of model edge and 5% EV, ranks by model probability, and may
add up to two 0.10u Leans. Validation halves were 3-4 (+9.47u) and 2-3
(+5.11u); untouched August holdout was 5-19 (+2.93u, +12.2% ROI). This is a
diversified basket decision: rank one was strongly positive on holdout, while
rank two was negative independently, so no third complement is live.

R34 also adds at most the highest-EV Batter RBI Watchlist as a 0.10u Lean when
its existing final side has nonnegative edge and EV and a best price from -200
through +300. Validation was 6-2 (+8.89u); untouched holdout was 5-7 (+5.65u).
Ranks two and three failed validation and are not live. The paired August 13
rebuild adds two Home Run Leans and one RBI Lean, with no demotions. A Pitcher
Hits Allowed candidate stayed out of production because the full member-board
rebuild showed its current candidates carried the existing low-data-confidence
flag. Evidence is in
`docs/model-audits/2026-08-13-player-props-incremental-value-portfolios-r34.md`.

The August 13 r33 model release retained r32's missing outdoor weather
coordinates for MLB's neutral-site Field of Dreams venue. The PHI-MIN slate
arrived with that official venue name, so r31 could not resolve required
game-time weather and correctly held the entire snapshot.

R33 adds the validated Batter Home Runs portfolio Lean. It estimates the
hitter's home-run rate per plate appearance from the 20 most recent prior-only
games, shrinks with a 100-PA league prior, adjusts expected opportunities for
batting order and the verified park/outdoor-temperature environment, then
anchors 25% to the multi-book market consensus. Eligible 0.5 Over offers must
have nonnegative edge and EV at +150 through +1000. The three highest-EV best
prices are Leans at 0.10u with at most one hitter per game. Validation was 5-19
(+53.7% ROI); untouched holdout was 8-28 (+108.5% ROI), with date-block
P(profitable)=0.9698. The 4-play variant also stayed positive in both windows,
while 5 plays was flat in validation, supporting the three-play boundary.
Evidence and current-board impact are recorded in
`docs/model-audits/2026-08-13-player-props-home-run-pa-portfolio-r33.md`.

The complete August 13 all-market tournament covered 45,320 settled observations across 16
markets. It retained the r31 HRR Under, Doubles Under, and Batter Strikeouts Over accuracy
sleeves, rejected every broad probability challenger, and kept holdout-sensitive total-bases and
pitcher finalists out of production. A subsequent target-corrected Home Run portfolio test fixed
the tournament's equal-games/equal-opportunities defect and qualified the r33 release. The complete matrix is in
`docs/model-audits/2026-08-13-mlb-props-all-market-tournament.md`.

The r31 accuracy release removes the losing Home Run Over actionable promotion
while preserving the calibrated Home Runs probability and visible Watchlist
card. That selector was 7-49 on validation and 8-67 on the untouched August
holdout. Rich home-run context regressions and a replacement threshold selector
both failed holdout and remain rejected.

R31 pairs that demotion with two prior-only empirical/market accuracy sleeves.
Doubles Under 0.5 was 66-14 on validation and 142-32 on holdout; Batter
Strikeouts Over 0.5 was 12-6 and 27-14. Both require positive model-versus-market
edge, nonnegative locked-price EV, an eligible price, existing lineup/data
quality/freshness gates, and the best offer. The current-slate paired replay
added ten Doubles Unders and two Batter Strikeouts Overs, removed six Home Run
Overs, and produced an intended +6 actionable-board delta. Evidence and all
rejected market-by-market challengers are recorded in
`docs/model-audits/2026-08-12-player-props-market-by-market-accuracy-r31.md`.

The r30 H+R+RBI accuracy sleeve promotes only market-anchored Under candidates
selected on the July 24-31 validation window. It combines 25% prior-only,
line-aware empirical survival with 75% target-market probability and requires at
least 60% final probability, 1 percentage point of final edge, and 3% expected
value. Validation was 6-3 and the untouched August 1-11 holdout was 15-2 across
nine dates; date-block bootstrap support was 99.92% for hit rate above 50% and
99.44% for profitability. It added 17 holdout decisions over r29 with no
demotions. All broad context regressions and weaker action cohorts remain
audit-only. Evidence is recorded in
`docs/model-audits/2026-08-12-player-props-all-market-features-hrr-r30.md`.

The r29 pitcher workload guard prevents total season innings from being divided by a small
starter count for mixed-role pitchers. When the starter baseline is weak, current official start
logs own workload and the strikeout probability is held to the de-vig target-book market as a
non-actionable control. In 21 untouched weak-baseline strikeout observations across 10 dates,
the market control beat r28 on Brier score (`0.232115` vs `0.254888`), log loss (`0.657115` vs
`0.703085`), and 55% selected-side hit rate (`66.7%` vs `47.1%`). Established starters remain on
the existing model path. Evidence and board impact are recorded in
`docs/model-audits/2026-08-12-player-props-weak-pitcher-workload-r29.md`.

The r28 probable-pitcher contract uses MLB Stats as the authoritative starter source and fills
only an empty game side from ESPN's published probable, provided the name resolves to exactly
one active pitcher on the corresponding MLB roster and exactly one Ball Don't Lie player on the
same team. MLB Stats automatically supersedes the fallback on the next authoritative refresh.
Team-pair ESPN identity is never used to guess between doubleheader games, ambiguous mappings
remain held, and an operator kill switch can revert immediately to official-only behavior. If
ESPN's primary official site API host returns an empty slate from the production serverless
network, r28 retries ESPN's equivalent official site API host before declaring the source empty.

The paired August 11 shadow rebuild held all 5,874 offer rows and the same live prices constant.
Fallbacks for Jake Irvin and Carson Whisenhunt restored opposing-starter and pitch-mix research
to 370 rows. Required-research holds fell from 402 to 32, all of which had verified but
insufficient pitch-mix samples. The actionable board moved from 107 to 116 through 11 promotions
and 2 demotions (net +9); 105 actionables were retained. No stale odds, missing prices, mapping
errors, or publication errors were present. Full details are in
`docs/model-audits/2026-08-11-player-props-probable-fallback-r27.md`.

The r26 publication and launch-readiness contract preserves every research-quality gate at row
level. A row missing required opposing-starter or pitch-mix evidence must be
explicitly stamped `PENDING_DATA` or `RESEARCH`, remains ineligible for units,
and is disclosed in snapshot warnings. Those already-held rows no longer
freeze complete priced rows from unrelated games or falsely close the admin
launch gate. Any incomplete row carrying an ordinary Watchlist, Lean, or Best
Angle grade still blocks both publication and launch readiness.

The underlying r23 adapter remains intact: a current Ball Don’t Lie endpoint
response stamps the quote with the current fetch observation while retaining
`updated_at` in raw evidence for movement auditing. This prevents an unchanged
but still-listed offer from being falsely expired after 45 minutes.

The paired August 10 audit compared the latest valid r21 private snapshot with
an r23 read-only rebuild: 3,789 exact rows matched, 204 rows were added, 45
were removed, and the board grew from 3,834 to 3,993 rows. The actionable
board moved from 83 to 79 through 10 promotions and 14 demotions, with 69
actionables retained. The candidate was publishable with all 16 supported
markets, zero stale displayed odds, complete required research, and no public
flags enabled. Full details are recorded in
`docs/model-audits/2026-08-10-player-props-current-observation-r23.md`.

The August 11 paired production dry-run contained 5,821 offer rows and 103
actionables with complete research and fresh prices. Exactly 403 unrelated
rows were already fail-closed (`310 PENDING_DATA`, `93 RESEARCH`): 370 lacked
an announced opposing starter and 33 additional rows had a verified but
insufficient pitch-mix sample. Operational warnings distinguish source-not-yet-
published data, insufficient verified samples, and true unavailable data. The
r26 contract changes only snapshot and launch-gate availability: it promotes zero incomplete
rows, demotes zero complete rows, and leaves the actionable count at 103. See
`docs/model-audits/2026-08-11-player-props-held-research-readiness-r26.md`.
New WNBA records store the final published picked-side moneyline probability while retaining the
independent and final layers separately. Tracking refuses a source payload whose model,
distribution, or grade-policy identifier differs from the champion. The reader hides stale
unlocked payloads but preserves locked historical recommendations.

## Explicitly not active

### MLB Player Props pitcher shadow

- Shadow release: `mlb_props_shadow_pitcher_2026_08_12_r1`
- Feature contract: `mlb_props_shared_pitcher_features_v1_2026_08_12`
- Scope: prospective T-60 evidence for pitcher strikeouts; pitcher outs retained as a control
- Production effect: none; active props bundle remains `mlb_props_2026_08_13_r32`
- Evidence: `docs/model-audits/2026-08-12-player-props-shared-pitcher-shadow-r1.md`

The shadow path reuses the authoritative props refresh and records its immutable output in lock
metadata. It cannot change a member-visible probability, side, grade, or stake. Promotion requires
new chronological holdout evidence and a later active release identifier.

The following research findings are not production rules and must not be inferred from older
audit documents:

- MLB total probability shrink `k=.2`.
- MLB selected-side probability compression.
- Any new MLB first-inning probability or flip rule.
- Any WNBA money/ticket, steam, reverse-line-movement, or opposite-side flip rule.
- Any WNBA total probability recalibration or blanket projection blend.
- Any WNBA spread probability/anchor-weight change.

They require a new immutable release, exact paired replay through the entire downstream grade
pipeline, and the full `docs/model-change-safety.md` protocol.

## Release verification

Before calling a later change live:

1. Confirm these identifiers in the machine registries and member-facing snapshots.
2. Run `npm run verify:model-change` plus the MLB prediction-record, signed-evidence,
   market-signal, grade, and WNBA core suites.
3. Confirm all prediction writers use the sport-scoped `prediction_pipeline` lease.
4. Verify unlocked source releases are coherent and locked rows remain immutable.
5. Compare current board counts and market mix against the approved paired replay.
6. Verify the deployed commit, cron health, response freshness, and member reader after both a
   scheduled refresh and the next lock sweep.
