# Current MLB and WNBA model releases, plus shadow candidates

This file is the human-readable production handoff registry. Runtime constants and stamped
prediction snapshots remain the machine authority. Future model work must start here, verify the
constants, and preserve the precedence and writer ownership below.

Last reviewed: 2026-08-23

## NFL Daily Edge Regular Season Week 1 member release

- Active member release: `nfl_v1_member_release_2026_08_23_r2`; production model / calibration / decision: `nfl_v1_daily_edge_model_2026_08_23_r2` / `nfl_v1_daily_edge_calibration_2026_08_23_r2` / `nfl_v1_daily_edge_decision_2026_08_23_r2`.
- Outcome artifact / model / distribution / probability / representative-score releases: `nfl_v1_week_one_outcome_artifact_2026_08_23_r2_discrete_joint` / `nfl_v1_discrete_drive_outcome_2026_08_23_r2` / `nfl_discrete_drive_score_distribution_2026_08_23_r5` / `nfl_v1_discrete_joint_probability_2026_08_23_r2` / `nfl_v1_representative_score_2026_08_23_r2`.
- Forward evidence schema / collector / writer: `nfl_forward_evidence_snapshot_2026_08_23_r3_member` / `nfl_forward_evidence_collector_2026_08_23_r3_member` / `nfl_forward_evidence_writer_2026_08_23_r4_member`.
- Moneyline exact-price lane: runtime artifact `nfl_r6_moneyline_runtime_artifact_2026_08_22_r1`, model `nfl_market_led_moneyline_shadow_2026_08_22_r6`, calibration `nfl_market_led_price_calibration_shadow_2026_08_22_r6`, and source decision `nfl_market_led_moneyline_lean_shadow_2026_08_22_r6`. r6 remains the exact-price probability lane; the r10 same-PMF winner is now a mandatory direction-coherence guard before a member Lean.
- Runtime authority: `lib/services/football/nflV1WeekOneOutcome.ts`, `lib/services/football/nflV1ProductionDecision.ts`, `lib/services/football/nflForwardEvidenceWriter.ts`, and `lib/services/football/nflWeekOneHeldMemberFixture.ts`. The retired preseason publication is immutable rehearsal evidence and is never restored by a Week 1 read failure.
- Forecast contract: one discrete drive/scoring-event joint PMF supplies the displayed representative score, moneyline winner probability, spread cover probability, and total Over/Under probability. The representative score is a reachable integer score selected from the same PMF, agrees with its forecast winner, and replaces the misleading unconditional mode. Across the 16-game Week 1 slate the display spans 17–27 team points, -4 to +10 margin, and 39–50 total, with six Over and ten Under predictions, five duplicated score pairs, 100% winner fidelity, and zero tie/display-winner contradictions.
- Grade contract: a complete r6 exact-price moneyline qualifier becomes Lean only when its selected team matches the r10 PMF winner. A coherent moneyline nonqualifier is No Play. Spread and total publish their PMF prediction and exact current tuple as No Play because no separate exact-price action lane passed. Only a genuine identity, quote, quarterback-history, injury, or market-completeness failure becomes Held; projected-but-coherent starter status and unavailable SharpAPI splits remain visible context rather than automatic Holds. No Best Angle or stake is authorized.
- Current same-input board impact: the authoritative 16-game replay produces eight moneyline Leans and eight moneyline No Plays, plus 16 spread and 16 total No Plays: 8 Lean / 40 No Play / 0 Held / 0 Best Angle across 48 markets. The r10 coherence guard demotes the two direction-conflicting r6 candidates (Houston and Kansas City) rather than publishing a bet opposite the displayed winner. On the frozen 2024–25 replay, unguarded r6 was 252 actions, 159-93, +18.944u, +7.52% ROI; the guard retained 176, 121-55, +18.375u, +10.44% ROI. This is 76 tested demotions paired with the already-validated r6 promotions; it does not flatten qualifying coherent plays.
- Writer boundary: scheduled `/api/cron/nfl-forward-evidence` remains the single writer under the shared `prediction_pipeline:nfl` lease. It stores one coherent outcome/decision bundle beside each due immutable opening, unlocked, or T-60 evidence capture without an extra provider call. Member reads use the stored evidence and make zero provider calls. SharpAPI rows must strictly match NFL Week 1; Playbook public consensus is never relabeled as sharp-book data.
- Tracking boundary: this release does not write `prediction_records`, teams, games, settlements, stakes, or lifetime records. Every stored decision explicitly has `trackingEnabled=false`, and the writer reports `trackingAttempted=false`. Official T-60 tracking identity seeding and row insertion remain a separate, unimplemented release requiring their own review; no manual insert, backfill, or cron invocation is part of this member release.
- Reader/rollback: `NFL_WEEK_ONE_EVIDENCE_BOARD_ENABLED=true` selects the genuine 16-game Week 1 reader and `NFL_DAILY_EDGE_ENABLED` remains the top-level visibility rollback. An incomplete or incoherent game fails closed to Held without restoring preseason. Roll back the member release by restoring the r2 forward schema reader and evidence-only Held behavior; immutable evidence rows remain preserved.
- Evidence: `docs/model-audits/2026-08-23-nfl-discrete-drive-joint-r10.md`, `docs/model-audits/2026-08-23-nfl-r6-r10-direction-coherence.md`, `docs/model-audits/2026-08-23-nfl-discrete-drive-joint-r9.md`, and `docs/model-audits/2026-08-23-nfl-v1-comprehensive-outcome.md`.

## Premier League production release (active)

- Runtime/model release: `epl_goals_coherent_2026_08_20_r16`
- Probability core: r8 Match Result; r11 market-derived Total and BTTS heads; r12 validation-selected coherent published goal projection; r15 independently timestamped all-book line verification; r16 member-snapshot lock enforcement
- Display-grade / calibration release: `epl_grade_policy_2026_08_20_v21`
- Match Result locked-score reader release: `epl_match_result_exact_locked_score_2026_08_23_r2`
- Member reader lifecycle: `daily_edge_weekly_reader_lifecycle_2026_08_21_r1`
- Runtime constants: `lib/services/epl/eplShadowModel.ts`
- Provider boundary: BALLDONTLIE supplies fixtures/history/stats, a complete current three-way moneyline fallback, and its distinct opening endpoint. `lib/providers/real_api/SharpApiEplMarketProvider.ts` remains primary for per-book Match Result, Double Chance, Total, and BTTS prices and makes one cached league-level splits request. A live Playbook probe proved EPL is unsupported: EPL aliases silently returned NFL rows, so Playbook is not allowed into EPL odds or splits.
- Model configuration: 365-day half-life, four-match shrinkage, 35% xG / 65% goals where xG is present, Dixon–Coles tau -0.10, separate home/away club attack and defense
- Grade boundary: Match Result remains prediction-first and unchanged from r10/v15. Double Chance remains forecast-anchored, tracked, and non-actionable. Total uses the validation-selected 25% raw club distribution / 75% de-vigged two-sided Total market forecast. BTTS fits coherent 1X2 and Total probabilities to a Dixon-Coles score distribution; the offered BTTS price is not used to select Yes/No. Total and BTTS receive Lean at 55% forecast confidence, Watchlist from 53% to below 55%, and No Play below 53%, always requiring a coherent current price. No Total/BTTS Best Angle path is enabled because a return-qualified cohort was not validated.
- The contemporaneous v21 no-write preview produced Match Result 3 Best Angles / 2 Leans / 1 Watchlist / 4 No Plays, Double Chance 4 Watchlists / 6 No Plays, Total 7 Leans / 3 No Plays, and BTTS 6 Leans / 3 Watchlists / 1 No Play. Total remained 7 Over / 3 Under and BTTS 8 Yes / 2 No. Relative to v20 this is zero promotions and zero demotions; r16 changes only post-lock member-snapshot publication and does not alter a probability, side, grade, or unlocked game.
- Weekly-slate lifecycle: the stored active gameweek retains completed matches with their final score and advances only after every match in the round is final. The member board keeps matches throughout their Eastern game date, then removes prior-date matches after the established 2 a.m. ET soccer board rollover. Kickoffs retain canonical UTC instants and display in the member's browser time zone. Stored picks never disappear from lock, audit, settlement, or tracking history. This reader-only release changes zero projections, probabilities, sides, prices, grades, stakes, or official records.
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
- First-inning runtime: `fi_v2` with the versioned unpublished-probable availability head below
- Public calibration: `mlb_public_calibration_v27_strong_winner_resistance_lean_2026_08_22`
- Decision release: `mlb_daily_edge_decision_2026_08_23_r68`
- Rule bundle: `mlb_daily_edge_rule_bundle_v56_market_scoped_grade_integrity_2026_08_23`
- Grade policy: `mlb_public_grade_policy_v46_market_scoped_grade_integrity_2026_08_23`
- Tracking contract: `member_facing_lock_v8_priority_retry_minute_cadence_2026_08_11`
- Machine registry: `lib/automodel/mlbModelLayerVersions.ts`
- Authoritative member-facing writer: `lib/services/predictionRecordService.ts`

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

- Release: `mlb_props_2026_08_19_r37`
- Machine registry: `lib/mlb/props/marketModelVersions.ts`
- Authoritative writer: `/api/cron/mlb-player-props-refresh` through
  `refreshMlbPropsBoard`
- Status: private launch candidate; not publicly enabled

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
