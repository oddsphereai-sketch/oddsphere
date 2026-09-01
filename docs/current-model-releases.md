# Current production model releases and qualified research candidates

This file is the human-readable production handoff registry. Runtime constants and stamped
prediction snapshots remain the machine authority. Future model work must start here, verify the
constants, and preserve the precedence and writer ownership below.

Last reviewed: 2026-09-01

## NFL Daily Edge generalized weekly production release

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

- Runtime/model release: `epl_goals_coherent_2026_08_20_r16`
- Probability core: r8 Match Result; r11 market-derived Total and BTTS heads; r12 validation-selected coherent published goal projection; r15 independently timestamped all-book line verification; r16 member-snapshot lock enforcement
- Display-grade / calibration release: `epl_grade_policy_2026_08_20_v21`
- Match Result locked-score reader release: `epl_match_result_exact_locked_score_2026_08_23_r2`
- Member reader lifecycle: `daily_edge_weekly_reader_lifecycle_2026_08_21_r1`; EPL snapshot continuity/publication lifecycle: `epl_member_snapshot_lifecycle_2026_08_24_r2`
- Runtime constants: `lib/services/epl/eplShadowModel.ts`
- Provider boundary: BALLDONTLIE supplies fixtures/history/stats, a complete current three-way moneyline fallback, and its distinct opening endpoint. `lib/providers/real_api/SharpApiEplMarketProvider.ts` remains primary for per-book Match Result, Double Chance, Total, and BTTS prices and makes one cached league-level splits request. A live Playbook probe proved EPL is unsupported: EPL aliases silently returned NFL rows, so Playbook is not allowed into EPL odds or splits.
- Model configuration: 365-day half-life, four-match shrinkage, 35% xG / 65% goals where xG is present, Dixon–Coles tau -0.10, separate home/away club attack and defense
- Grade boundary: Match Result remains prediction-first and unchanged from r10/v15. Double Chance remains forecast-anchored, tracked, and non-actionable. Total uses the validation-selected 25% raw club distribution / 75% de-vigged two-sided Total market forecast. BTTS fits coherent 1X2 and Total probabilities to a Dixon-Coles score distribution; the offered BTTS price is not used to select Yes/No. Total and BTTS receive Lean at 55% forecast confidence, Watchlist from 53% to below 55%, and No Play below 53%, always requiring a coherent current price. No Total/BTTS Best Angle path is enabled because a return-qualified cohort was not validated.
- The contemporaneous v21 no-write preview produced Match Result 3 Best Angles / 2 Leans / 1 Watchlist / 4 No Plays, Double Chance 4 Watchlists / 6 No Plays, Total 7 Leans / 3 No Plays, and BTTS 6 Leans / 3 Watchlists / 1 No Play. Total remained 7 Over / 3 Under and BTTS 8 Yes / 2 No. Relative to v20 this is zero promotions and zero demotions; r16 changes only post-lock member-snapshot publication and does not alter a probability, side, grade, or unlocked game.
- Weekly-slate lifecycle: the stored active gameweek retains completed matches with their final score and advances only after every match in the round is final. The member board keeps matches throughout their Eastern game date, then removes prior-date matches after the established 2 a.m. ET soccer board rollover. Kickoffs retain canonical UTC instants and display in the member's browser time zone. Stored picks never disappear from lock, audit, settlement, or tracking history. This reader-only release changes zero projections, probabilities, sides, prices, grades, stakes, or official records.
- August 24 snapshot-continuity repair: the publication coverage gate now evaluates only non-final fixtures because sportsbooks normally remove prices after full time. Completed matches can no longer block a complete upcoming match from refreshing the weekly member snapshot. If the ordinary 24-hour cache deadline expires during a publication interruption, the EPL reader may use the newest stored weekly snapshot for at most eight days, but only while that snapshot still contains a game valid under the normal soccer board-date filter. It cannot resurrect an entirely completed old week. The next normal writer refresh replaces the continuity fallback and stamps `epl_member_snapshot_lifecycle_2026_08_24_r2`. Model r16, grade policy v21, projections, sides, grades, prices, locks, stakes, tracking, provider budgets, and the single leased writer are unchanged. Evidence: `docs/model-audits/2026-08-24-epl-weekly-snapshot-continuity.md`.
- Price health is response-time provider state: the latest v21 probe captured 40/40 selected current prices and 100/100 current outcome rows/trails across Match Result, Double Chance, Total, and BTTS, plus 618 complete all-book outcome rows from 13 sportsbooks. Sharp duplicate fixture buckets are ranked by exact fixture identity and full-game market breadth, and the odds calls are filtered by one official market at a time so large prop catalogs cannot push BTTS or Double Chance beyond a pagination cap. Compound Double Chance/total selections are rejected. BALLDONTLIE's complete current 1X2 board is a coherent same-vendor fallback only when Sharp's three-way bucket is incomplete. When a provider-native opening row is unavailable, Daily Edge uses the earliest verified same-book capture as the operational `Opening`. A second independent capture verifies a flat trail; subsequent unchanged polls are compacted, while every economic quote change remains append-only in `line_history`. The August 21 reader-integrity repair brings EPL onto WNBA's established oldest-to-newest paginated history contract: a newest-N cap can no longer evict a genuine early capture. Same-book movement remains directional evidence; when the current sportsbook differs, the earliest cross-book capture is shown separately and never mislabeled as movement. This changes zero current prices, predictions, probabilities, projections, sides, grades, stakes, promotions, or demotions; r16/v21 remains the active model/grade release. Evidence: `docs/model-audits/2026-08-21-epl-immutable-odds-history-reader.md`.
- Authoritative writer candidate: `app/api/cron/epl-daily-refresh/route.ts`, under the shared sport-scoped `prediction_pipeline` lease. The targeted `epl-pregame-lock` route uses the same lease and calls paid providers only for a game entering T-60.
- Official tracking: all four EPL markets write immutable `prediction_records`; T-60 is the public-record eligibility boundary. The member-snapshot publication boundary also preserves the complete locked projections, markets, prices, grades, and evidence against every later ordinary refresh. Official fixture metadata and final scores remain mutable after lock, and an already stored final result cannot regress to null. The scheduled shared `tracking-refresh` cycle includes `soccer`, ingests only the EPL external-id namespace when the EPL pipeline is enabled, and grades Match Result, Double Chance, Total, and BTTS from the final 90-minute score. Member aggregates expose EPL as `Premier League` while retaining historical World Cup rows under `World Cup`; the two competition records are never blended.

- T-60 discovery repair (August 21): the targeted lock no longer assumes provider fixture IDs fit in a one-million-wide synthetic-ID range. It discovers due fixtures through unlocked current-release EPL records and can reconcile a due member snapshot when the slower writer locked the database first. The defect caused COV@ARS to miss the 2:00 PM EDT targeted boundary; the 2:07 PM daily writer locked the records at Circa -500 but left the member snapshot in `locking`. The repair changes no r16 probability, projection, selection, v21 grade, stake, or price and therefore retains r16/v21. Evidence: `docs/model-audits/2026-08-21-epl-heavy-favorite-grade-and-lock-audit.md`.
- Match Result score-head coherence (August 23): moneyline cards and readers now display the club-only score distribution that actually supplies the released three-way Match Result probabilities, pick, and v21 grade. Total and BTTS continue to use the separately validated r12 market-informed goals context. This prevents a different goals head from visually favoring the opponent beside the active Match Result forecast. The repair changes zero probabilities, sides, grades, prices, stakes, locks, or tracking rows; r16/v21 remain active. A chronological grade replay found that sub-50% Best Angles disagreeing with the market favorite were unstable across the two partitions, so no grade-policy claim or unpaired demotion is made. Evidence: `docs/model-audits/2026-08-23-epl-match-result-score-head-coherence.md`.
- Cost boundary: historical 2022–25 training rows use a persistent versioned cache plus process deduplication; current-season finals refresh on the scheduled 30-minute writer; slate/provider assembly is cached five minutes; Sharp date catalogs are shared; concurrency is three; primary odds reads are capped at four narrow market calls per fixture and duplicate-event fallback is capped at ten additional calls across the weekly slate. Sharp splits use one cached league request per slate assembly, not one request per fixture; split history is not polled. Member reads use one stored weekly response snapshot and make zero provider calls.
- Production status: active for members as of 2026-08-19. `EPL_CRON_ENABLED`, `EPL_LOCK_CRON_ENABLED`, `EPL_DB_WRITES_ENABLED`, `EPL_FOUNDATION_CACHE_WRITES_ENABLED`, `EPL_PUBLICATION_ENABLED`, `EPL_PIPELINE_ENABLED`, and `PREMIER_LEAGUE_DAILY_EDGE_ENABLED` are enabled in Vercel Production. The 30-minute writer and targeted T-60 lock route remain independently reversible through those gates.
- Reader: local founder preview at `/dev/premier-league-preview`; the production Daily Edge branch is already wired to the stored snapshot behind `PREMIER_LEAGUE_DAILY_EDGE_ENABLED`.
- Rollback: disable the seven EPL gates. World Cup records and readers remain separate; no World Cup release or writer is replaced.

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

- Projection runtime: resolved automodel `v2_2`
- First-inning runtime: `fi_v2` with probability head `mlb_first_inning_fi_v5_named_book_consensus_weight25_2026_09_01`
- Public calibration: `mlb_public_calibration_v29_first_inning_named_book_consensus_2026_09_01`
- Decision release: `mlb_daily_edge_decision_2026_09_01_r78_first_inning_member_tuple_coherence`
- Rule bundle: `mlb_daily_edge_rule_bundle_v66_first_inning_member_tuple_coherence_2026_09_01`
- Grade policy: `mlb_public_grade_policy_v55_first_inning_named_book_consensus_2026_09_01`
- Correction policy: `mlb_prediction_corrections_v23_split_pair_recency_2026_08_31`
- Tracking contract: `member_facing_lock_v8_priority_retry_minute_cadence_2026_08_11`
- Lock coherence: `mlb_lock_coherence_2026_08_30_r2_pending_promotion_tuple`
- Machine registry: `lib/automodel/mlbModelLayerVersions.ts`
- Authoritative member-facing writer: `lib/services/predictionRecordService.ts`

Shared member presentation release: `daily_edge_member_presentation_2026_08_28_r15_football_unavailable_prediction_copy`.
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
Grade label. An explicit football market-prediction health failure never uses
that fallback. No Play appears only in Bet Grade surfaces.
The r6 football reader presents five market-specific primary drivers before a
disclosure containing every remaining verified row, and moves injury and
availability reporting below those drivers as explicit context. When an NFL
Spread or an explicit CFB market-prediction contract has no directional
prediction, the prediction surface now says `Spread prediction unavailable`
instead of repurposing projected scoring margin as a bettable spread side;
an explicitly unavailable CFB Total similarly fails closed. These are
presentation-only changes: model
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

## WNBA champion

- Model: `wnba_v1_1_team_identity`
- Distribution: `wnba_market_heads_value_calibrated_2026_08_02_v3`
- Calibration schema: `wnba_core_calibration_v1`
- Grade policy: `wnba_grade_policy_v6_authoritative_reader_grade_2026_08_13`
- Prediction-record contract: `wnba_prediction_record_contract_v3_exact_decision_tuple_2026_08_21`
- Machine registry: `lib/automodel/wnbaChampionRuntime.ts`
- Authoritative model writer: `lib/services/wnba/runWnbaModel.ts`
- Tracking writer: `lib/services/wnba/buildWnbaPredictionRecords.ts`
- Member reader: `lib/services/wnba/buildWnbaDailyEdgeAdapted.ts`
- Scheduled owner: `/api/cron/wnba-daily-refresh` under the WNBA-scoped shared
  `prediction_pipeline` lease

WNBA moneyline selection and its established public-support grade behavior are preserved.
Public support cannot promote total or spread Watchlists. Public resistance remains active in all
markets. A spread Watchlist can promote to Lean only for the home side when Elo and statistical
home margins differ by less than three points, at least ten books quote the spread, an exact
picked-side price exists, and public conflict is absent. The rule never changes a side, projection,
probability, or stake.

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

## MLB Player Props candidate

- Release: `mlb_props_2026_09_01_r38`
- Machine registry: `lib/mlb/props/marketModelVersions.ts`
- Authoritative writer: `/api/cron/mlb-player-props-refresh` through
  `refreshMlbPropsBoard`
- Status: private launch candidate; not publicly enabled

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
