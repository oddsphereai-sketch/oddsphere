# Premier League shadow foundation r1

## Production-candidate addendum: r8 / v10

Status: complete local production candidate; all writes, schedules, publication, and member visibility remain disabled pending founder approval.

The required tournament has now been run across 240 configurations. Model-family and base hyperparameters were selected using 2024–25 after fitting 2022–24; the xG blend and derived-market shrinkage were selected on the first 285 chronological 2025–26 matches; the final 95 matches remained untouched until the decision. The selected release is `epl_club_dixon_coles_2026_08_18_r8`: 365-day half-life, four-match shrinkage, 35% xG / 65% goals where xG is available, tau -0.10, and sign-preserving neutral shrinkage for Total and BTTS. r8 does not alter r4 lambdas or probabilities. It retains r6's distribution reconciliation and r7's all-outcome price-trail identity. The reader now presents those trails through the established MLB/WNBA Market Pulse and Odds movement component instead of a separate soccer-only price-board module. The raw modal exact score remains in audit output and is not presented as though it reconciles the three market heads.

Paired same-input board-count impact versus r7 is exactly zero promotions and zero demotions because r8 changes only reader composition. The final r8 live-provider dry run produced 4 Best Angles, 2 Leans, 10 Watchlists, and 24 No Plays across 40 market records. r8 adds no provider calls, writer, timer, database write, or per-card computation; it renders the existing seven outcome trails inside the shared Daily Edge movement module.

| Evaluation partition | Matches | Accuracy | Multiclass Brier | Log loss | Team-score MAE |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2025–26 calibration | 285 | 50.53% | 0.61010 | 1.01716 | 0.89298 |
| 2025–26 final holdout | 95 | 43.16% | 0.63409 | 1.05313 | 0.91928 |
| 2025–26 full season | 380 | 48.68% | 0.61610 | 1.02615 | 0.89956 |

The final-period drop is material. r3 is not represented as a certainty engine. Probability, price, and play grade remain separate facts.

Provider xG coverage is 0/380 for each of 2022–23, 2023–24, and 2024–25, then 379/380 for 2025–26. The selected 35% xG blend is therefore learned from and applied where that field genuinely exists; older matches remain goal-based and are never presented as xG-backed.

The v10 grade tournament keeps forecast confidence and price value as distinct paths:

| Rule | Calibration | Final holdout | Decision |
| --- | --- | --- | --- |
| Winner-confidence Lean: forecast probability ≥50%, same as market favorite, price >-300, full club history | 56-41 (57.73%), mean model p 57.66%, -5.40% ROI | 11-8 (57.89%), mean model p 56.07%, +3.05% ROI | Lean; accurate-confidence label, explicitly not a value claim |
| Expensive winner context: forecast probability ≥65%, same as market favorite, price ≤-300, full club history | 14-2 (87.50%), mean model p 71.13% | 1-3 (25.00%), mean model p 71.28% | Lean as likely-winner/parlay context only; poor standalone price and small, weak final sample are disclosed; never a value claim |
| Value Best Angle: highest 1X2 model-minus-market side ≥5pp, price >-300, full club history | 127 plays, +2.924u, +2.30% ROI | 26 plays, +6.502u, +25.01% ROI | Best Angle; only tested value floor positive in both partitions |

The Match Result value side may differ from the most likely result; the reader displays both, and Draw is a first-class possible forecast or value selection. For Total and BTTS, v10 does not let an unvalidated opposite-side price candidate replace the score-distribution forecast on the card. Instead, that candidate remains visible in the complete price board and the forecast is graded `No Play` when its own price edge is negative. This restores a coherent Arsenal example: Arsenal Match Result, Over 2.5, and BTTS No from the same 2.28–0.72 scoring distribution.

r4 also replaces side-flipping league-rate shrinkage with sign-preserving neutral shrinkage. Over uses 60% raw probability plus 40% at 50%; BTTS uses 65% raw plus 35% at 50%. On the final holdout, Over recorded 0.24788 Brier / 0.68883 log loss and BTTS 0.24739 / 0.68785. Both improve on raw probabilities but remain worse than their constant baselines, so neither receives an actionable threshold.

The added projection-spread audit found a full-holdout per-team lambda range of 0.56–3.01 (median 1.41), so the model is not literally emitting one constant score. Predictive separation is still limited: projected-vs-actual team-score correlation was 0.274 over the full untouched season and 0.188 in the final quarter. This limitation remains explicit and blocks treating exact score projections as high-confidence outcomes.

The latest genuine 10-match dry run has 5 Best Angles, 2 Leans, and 3 Watchlists for Match Result. Across all 40 tracked markets it has 5 Best Angles, 2 Leans, 9 Watchlists, 24 No Plays, and 0 Cautions. Double Chance contributes 3 Watchlists, Total 2, and BTTS 1; all six derived-market Watchlists are non-actionable. This avoids a flat informational board without inventing a bet or demoting a production EPL selection, because no production EPL board exists.

Operational completion in r2:

- the only candidate writer uses the shared `prediction_pipeline` lease;
- a database-only minute sweep calls providers only when an unlocked game enters T-60, then preserves the first lock;
- completed current-season games re-enter the fit within 15 minutes;
- historical 2022–25 data is persistently cached after one approved prewarm, eliminating repeated multi-season paid requests on cold workers;
- the hourly/15-minute writer produces one stored weekly member snapshot; member requests make no provider calls;
- EPL team/game IDs use a competition-specific offset, and snapshots stamp `english_premier_league`, preventing World Cup collision;
- score ingestion and existing soccer grading settle regulation 1X2, totals, and BTTS; competition-scoped admin tracking is available and the public World Cup lifetime excludes EPL rows;
- publication, cron, lock cron, database writes, foundation-cache writes, settlement, and member visibility have independent environment gates and are all disabled; neither EPL route is present in `vercel.json`.

Opening lines remain provider-pending when BALLDONTLIE has not populated its dedicated opening endpoint. Consecutive audits ranged from 37/40 to 39/40 coherent selected current prices, with 0/40 dedicated provider openings; missing current rows were volatile Sharp Double Chance duplicate-event buckets. Sharp's odds-delta endpoint can efficiently capture forward changes but cannot reconstruct prices from before OddSphere began observing them. The first captured quote is never relabeled as an opener. Splits now use one cached league-wide Sharp request and parse the documented moneyline/total shape plus a defensive generic shape; the live EPL league and Arsenal probes currently return zero rows. Playbook EPL aliases returned NFL data and are rejected rather than treated as EPL coverage.

Status: local founder preview; shadow-only; no writer, actionable grade, stake, cron, or production route

## Scope and release contract

- Sport / competition: English Premier League only
- Markets modeled for diagnostic display: regulation 1X2, total 2.5, BTTS, and score distribution
- Model release: `epl_club_dixon_coles_shadow_2026_08_18_r1`
- Display-grade / calibration release: `epl_grade_policy_shadow_2026_08_18_v4`
- Authoritative writer: none
- Shared `prediction_pipeline` lease: not used because the candidate performs no writes
- Reader: development-only `/dev/premier-league-preview`; it uses the real Daily Edge app shell, slate cards, market tabs, and expandable reader, and returns 404 in production
- Actionable board impact: 0 promotions, 0 demotions, net 0

This release cannot emit an actionable decision. `actionable` is a literal `false` in the prediction contract. It does not reuse the World Cup grade ladder, calibration, national-team Elo snapshot, neutral-venue rules, host-country adjustment, mismatch boost, writer, or cron.

## What is reused from the World Cup foundation

Only competition-neutral components are reused:

1. the Dixon–Coles-corrected joint score distribution;
2. coherent derivation of 1X2, totals, and BTTS from one distribution; and
3. the existing provider-normalization principle that unsupported or missing markets remain unavailable.

The EPL strength layer is new. It estimates time-decayed home/away club attack and defense from the prior two completed seasons, blends observed xG with goals when xG is present, shrinks small samples toward league rates, and gives clubs without EPL history an explicitly limited bottom-quartile proxy.

### World Cup lessons retained, tested, or rejected

The successful World Cup implementation is most useful as an architecture, not as a source of EPL constants.

- **Retained now:** one Dixon–Coles joint score distribution owns the 1X2, total, BTTS, and projected score. This prevents three unrelated mini-models from telling incompatible stories.
- **Retained as a product contract:** forecast side and value side are different facts. A likely Arsenal win can remain a strong forecast while a prohibitive price receives Caution; price must not rewrite the projected winner.
- **Next safe addition:** run the World Cup cross-market coherence guard over every EPL fixture before any market can become actionable. It detects combinations such as home win + Under 2.5 + BTTS Yes that cannot coexist on meaningful score probability. In r1 totals and BTTS are No Play, so this is not yet an actionable-board change.
- **Next safe market improvement:** compare a robust de-vigged median across coherent books while still displaying and grading against one exact offered book. The World Cup adapter already separates consensus from execution price; EPL currently selects one priority book. No bookmaker sides may be cross-mixed into a synthetic executable price.
- **Rejected for direct transfer:** national-team Elo, neutral-site logic, host-country and altitude adjustments, group/knockout draw handling, the World Cup mismatch boost, and the World Cup public grade thresholds. EPL needs club home/away strength, promotion handling, transfers/managers, rest and European congestion.
- **Rejected by this audit:** directly importing the World Cup's 35% market anchoring or a fitted temperature adjustment. Both were tested as audit-only challengers below; neither earned a runtime promotion on the untouched final half.

The World Cup model also blends market information into its scoring prior. That can improve pure forecast calibration, but it makes the model less independent from the same market used to calculate edge. Any future EPL market-anchored model must preserve an unanchored club estimate, use timestamp-locked prices, and prove that its residual edge has out-of-sample value rather than double-counting the bookmaker.

## Research basis

- Dixon and Coles established the low-score-adjusted Poisson framework and time weighting for football score modeling: https://doi.org/10.1111/1467-9876.00065
- Dynamic English-football work supports allowing team strength to change over time rather than treating a whole era as exchangeable: https://academic.oup.com/jrsssd/article/51/2/157/7120674
- A multi-league event-data study found xG useful for football performance modeling and documents shot, situation, home/away, position, form, and gameweek features: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0282295
- A 24-season English-league study found statistically significant home advantage across divisions and team abilities, supporting a domestic home/away treatment rather than World Cup neutral-venue logic: https://pmc.ncbi.nlm.nih.gov/articles/PMC8152196/
- BALLDONTLIE's official EPL V2 contract provides 2010-current matches plus teams, standings, injuries, lineups, team/player match stats, xG, opening odds, current 1X2 odds, shots, and pregame form: https://epl.balldontlie.io/

These sources justify the candidate family, not its production promotion. Hyperparameters remain candidates until the tournament described below selects them on chronological evidence.

## Live provider audit on 2026-08-18

- BALLDONTLIE GOAT authentication succeeded.
- The 2026–27 competition returned 20 teams, 380 scheduled matches, and a complete 10-match Gameweek 1 from Friday August 21 through Monday August 24.
- BALLDONTLIE current and opening odds returned no rows for Gameweek 1 at probe time. Its EPL odds contract is 1X2 only.
- SharpAPI returned multiple sportsbook-bucket identities for the same Premier League fixture. The complete Arsenal–Coventry identity had the correct 19:00Z kickoff, 12 sportsbook identifiers, and 74 market groups. The Daily Edge adapter now resolves by both teams, kickoff, and provider depth before loading exact-event prices, preventing a thin duplicate event from winning by slug alone.
- SharpAPI's `/splits` and `/splits/history` endpoints both accept the complete EPL event identity and return zero rows at probe time. This is classified as supported-but-not-yet-populated, not unsupported. The reader uses the standard Daily Edge split module: populated rows appear when present and an explicit unavailable state appears when absent. Split coverage never changes the club grade.
- The local reader successfully assembled all 10 current fixtures with real model probabilities. The final UI audit found a coherent current selected-side price for all 10 Match Result cards, all 10 Total cards, and all 10 BTTS cards (30/30). Each reader now exposes every outcome from that same sportsbook—not only the selected side—with model probability, de-vigged market probability, and gap. Opening rows remain separately marked `Provider pending` because BALLDONTLIE had not populated Gameweek 1 openers; current prices are never relabeled as openers.
- Current-form stat coverage is disclosed per team instead of inferred. Across the 20 displayed last-10 club contexts, 188 of 200 possible match-level xG observations were present (94%). Coventry and Hull had no EPL recent sample, Ipswich's available recent sample had no xG, and two established-club samples had 9/10 xG observations. The two-season historical training coverage remains much lower at 49.87%, so the current reader cannot be used to overstate training quality.
- Playbook does not have a verified EPL league contract. Invalid EPL-like league values returned NFL rows, so Playbook is fail-closed and excluded.

## Chronological holdout

The audit trained from the 380 completed 2024–25 matches and evaluated all 380 2025–26 matches chronologically. Before each holdout match, the fit used only the completed development season and earlier holdout matches.

| Metric | r1 result |
| --- | ---: |
| 1X2 accuracy | 50.0% |
| Multiclass Brier (three squared terms) | 0.6271 |
| Log loss | 1.0423 |
| Uniform baseline log loss | 1.0986 |
| Prior-season league-rate baseline log loss | 1.0847 |
| Team-score MAE | 0.9068 goals |
| Both-team xG coverage across 760 matches | 49.87% |
| Limited-history holdout fixtures | 3 |
| Actionable promotions / demotions | 0 / 0 |

The candidate beat both the uniform and prior-season league-rate baselines on the untouched chronological season. That clears a useful-foundation gate, but not a betting-quality gate.

### Historical opening-price grade audit

The 2025–26 holdout was joined to genuine BALLDONTLIE opening 1X2 prices. Of 380 matches, 350 had a coherent selected-side opening price. The season was split chronologically at match 190: the first half was used only to inspect candidate edge floors and the second half remained untouched for the decision. Price coverage was 190 matches in the first half and 160 in the final half. Prices shorter than -300 were excluded from the candidate edge test.

| Model edge floor | Calibration ROI | Final-holdout ROI | Final plays |
| --- | ---: | ---: | ---: |
| 2 percentage points | +22.18% | -10.63% | 32 |
| 3 percentage points | +24.44% | -8.65% | 26 |
| 4 percentage points | +29.58% | -9.35% | 23 |
| 5 percentage points | +19.89% | -14.05% | 21 |
| 6 percentage points | +16.00% | -11.47% | 17 |
| 8 percentage points | +13.62% | -5.45% | 11 |

Every tested positive-edge floor lost on the final holdout. Consequently v4 deliberately emits no actionable Lean or Best Angle. Public labels are restricted to the shared Daily Edge ladder: No Play, Caution, Watchlist, Lean, and Best Angle. Candidate/research classifications remain internal audit fields and never replace the play grade. Prices at -300 or shorter and model/market gaps above 20 points grade Caution; incomplete prices and sub-Watchlist gaps grade No Play.

### World Cup-derived challenger audit

Two ideas were tested without changing r1. Match 1–190 of the 2025–26 holdout selected each parameter; matches 191–380 were untouched. Market comparisons use the 160 final-half fixtures with coherent opening 1X2 prices.

| Challenger | Calibration selection | Final log loss | Final Brier | Final accuracy | Decision |
| --- | --- | ---: | ---: | ---: | --- |
| Raw club r1, all matches | none | 1.0627 | 0.6422 | 46.3% | incumbent |
| Temperature-scaled | T = 0.65 | 1.0781 | 0.6532 | 46.3% | reject |
| Raw club r1, priced subset | 0% market | 1.0771 | 0.6527 | 45.0% | priced comparator |
| World Cup-style 35% market blend | fixed comparison | 1.0749 | 0.6511 | 45.0% | tiny loss improvement; no promotion |
| Calibration-selected market blend | 100% market | 1.0858 | 0.6594 | 43.1% | reject |

The calibration half selected a sharper temperature and a 100% market weight, but both degraded on the untouched final half. A fixed 35% market blend made a very small final-half scoring improvement over raw r1 on the priced subset but did not improve accuracy and was not the calibration-selected champion. It therefore supplies a future hypothesis, not permission to change probabilities or grades. This failure is itself useful: World Cup market weighting is not automatically portable to league play.

### Forecast reliability and derived markets

The win outlook and the price-aware play grade are separate. For the model's most likely 1X2 result, final-half reliability was:

| Model probability band | Final-half matches | Actual result rate |
| --- | ---: | ---: |
| 33–40% | 47 | 46.8% |
| 40–50% | 96 | 40.6% |
| 50–60% | 42 | 57.1% |
| 60%+ | 5 | 60.0% |

The 60%+ band is explicitly marked small-sample. A heavy favorite can therefore receive a strong forecast label while retaining the standard `Caution` play grade when its price is prohibitive; neither label means lock or parlay recommendation.

Totals and BTTS are mathematically genuine outputs of the same score distribution, but they failed the incremental-skill gate and therefore receive the standard Daily Edge `No Play` grade:

| Derived market | Model Brier | League-rate baseline Brier | Model log loss | Baseline log loss |
| --- | ---: | ---: | ---: | ---: |
| Over 2.5 | 0.2494 | 0.2477 | 0.6921 | 0.6886 |
| BTTS Yes | 0.2469 | 0.2465 | 0.6871 | 0.6862 |

Lower is better for both metrics. Neither derived market beat the prior-season constant-rate baseline, so v4 grades coherent Total and BTTS outputs `No Play` with zero actionability. Their research status remains explanatory evidence, not a substitute public grade.

## r1 inputs and limitations

- Recency: exponential half-life of 180 days.
- Signal: 70% xG and 30% actual goals where both are available; actual goals otherwise.
- Shrinkage: eight-match league-average pseudo-sample.
- Home advantage: learned through separate league and club home/away rates.
- Promoted clubs: bottom-quartile EPL strength proxy, visibly labeled limited history.
- Dixon–Coles tau: `-0.10`, still a candidate rather than a calibrated EPL champion.
- Lineups, injuries, transfers, managers, rest/congestion, European matches, and pregame-form fields are not projection inputs in r1.
- xG is present for only about half of the two-season training sample.
- No bookmaker probability is blended into the club projection in r1. The local Daily Edge reader displays model probability, coherent de-vigged SharpAPI probability, current price, and their gap as separate evidence. V4 uses that evidence only to choose a non-actionable display state; it cannot produce a stake or betting action.

## Provider load and cost guardrails

- The two-season model foundation is loaded once per server process. A round's opening odds, form, injuries, lineups, and standings are promise-deduplicated and cached for five minutes, including simultaneous preview requests. The single BALLDONTLIE odds request now targets its opening endpoint; the previously requested current-odds payload was unused because SharpAPI owns the current board, so this adds no net provider call.
- Sharp event discovery is shared by calendar date instead of repeated for every fixture. Per five-minute 10-match slate, the hard request ceiling is 28 calls: at most four dated event catalogs, ten primary odds calls, four alternate-event fallback odds calls across the entire slate, and ten split calls. A normal complete slate is at most 24.
- Fixture enrichment runs with a concurrency ceiling of three. Missing odds fail closed after the bounded fallback budget; no polling loop, database writer, cron, client-side provider request, or paid production refresh exists.
- The preview's five-minute cache bounds repeated browser refreshes. This is a local safety limit, not permission to deploy; production scheduling and budget alarms remain separate promotion gates.
- A live identity audit found that Sharp had coherent odds for Crystal Palace–Everton and Tottenham–Brentford while the preview showed holds. BALLDONTLIE used `C Palace` and `Spurs`; Sharp used the full club names. V3 adds tested aliases and restores those real prices rather than synthesizing replacements.

## Required tournament before any production promotion

1. Compare score-only, xG-only, and multiple xG/goal blends.
2. Compare recency half-lives and dynamic-update forms on rolling-origin folds.
3. Compare separate home/away attack-defense, pooled attack-defense, Elo, and market-anchored challengers.
4. Calibrate Dixon–Coles tau and test score-grid tail sensitivity.
5. Build an evidence-based promoted-club prior, preferably with Championship strength and transfer information; until then retain the limited-history flag.
6. Join exact timestamped SharpAPI and BALLDONTLIE prices without cross-event contamination; report Brier, log loss, calibration gap, CLV where available, units/ROI, and board counts by immutable release.
7. Test actionable promotions and demotions as paired replacements. If evidence remains insufficient, keep every output shadow-only.
8. Only after a candidate passes may it receive a new release, a single leased writer path, stored snapshots, tracking settlement, and a production reader flag.

## Weekly Daily Edge product contract

- Daily Edge remains the product surface; EPL is not a standalone dashboard.
- Soccer is the top-level sport and a second bar selects Premier League, World Cup, or Champions League.
- One Gameweek is loaded at a time with explicit previous/next controls and the full Friday–Monday fixture set retained on the board, grouped under visible day/date headers.
- Every fixture uses the existing Daily Edge card and expandable reader with Match Result, Total, and BTTS tabs.
- Model, de-vigged market, provider opening price, first tracked price, current price, observed in-process price history, and optional splits are separate reader evidence. Missing data is never silently synthesized: a provider opener that has not populated is labeled `Provider pending`, never rendered as a fake first observation. The standard Daily Edge split module remains visible with an explicit unavailable state when the provider returns no rows.
- The expanded EPL reader retains the Daily Edge three-column structure with explicit ownership: Forecast & Grade, Market & Price, and Matchup Advantages. This keeps W-D-L form, advantage-marked team comparisons, price provenance, and grade logic simultaneously visible instead of placing soccer stats in a detached full-width row.
- The reader also surfaces genuine club crests, recent W-D-L form, injuries, current/recent xG for and against, shots, shots on target, possession, lineup availability, and provider sample coverage where reported. Prior-season finish is not a primary comparison stat because its relevance decays quickly once the current season develops. These are reader evidence only and do not change r3 projections.
- Public play grades use only the shared Daily Edge ladder. Secondary explanation identifies whether a 1X2 read is market-aligned, worth monitoring, price-prohibitive, unusually far from market, or missing data. A separate three-way panel shows away win, draw, and home win probabilities plus the applicable forecast-reliability band. Strong coherent Double Chance, Total, and BTTS forecasts may receive a non-actionable `Watchlist`; no derived market can receive `Lean` or `Best Angle` until its betting threshold is validated. Because the final historical holdout rejected every derived-market edge floor, actionable derived-market board impact remains exactly zero.
