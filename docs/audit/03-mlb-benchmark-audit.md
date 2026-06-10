# Phase 3 — MLB Benchmark Deep Dive

**Date:** 2026-06-10
**Auditor:** Phase 3 of the site-wide reliability audit
**Scope:** MLB is the most mature model in the system and defines the benchmark contract every other sport must match. This phase audits the locked snapshot contract, sharp/public signal incorporation, market movement, line/current/history behavior, FI handling, ML/OU handling, prediction_records vs DTO vs tracking, repair provenance, strict-mode behavior, auditor coverage, and calibration with real data.
**Method:** Read-only. Every claim cites `file:line` or DB query result.

---

## Summary verdict

MLB is the **PARTIAL-near-TRUSTED** benchmark for OddSphere. It has:

- A rich locked snapshot substrate (Phase 6B.28) with per-game signal rows, all book lines at lock, V2.2 audit, framework grades at lock, predicted scores, and data integrity flags — **but** the substrate is RELATIVELY NEW (introduced during the lock-snapshot remediation around 2026-06-08) and many earlier locked records (e.g., pr.id 109–112) lack `signal_rows_at_lock`, `lines_at_lock`, `framework_grades_at_lock`, `predicted_scores_at_lock`, and `data_integrity` entirely.
- Three layers of write-protection after lock (predictionRecordService comment-only guard, ingestScoresModel Layer 1 guard, automodelService Layer 2 pre-filter via `fetchLockedExternalIds`).
- A real `sharp_signals` writer with per-(game, market_type, side) DELETE scope, history append on every refresh, and a `lastKnownGoodReader` for current→history fallback.
- A full Push-4 grader (`predictionGrader.ts`) for post-game outcome grading and a Layer-3 derivation service (`gradeDerivationService.ts`) for pre-lock 7-category grade assignment.
- An auditor (`scripts/operator/audit-daily-edge-integrity.ts`) with five MLB-aware categories (lock contract, splits, lines/odds, tracking/grading, thinning) and a `--strict` mode.

**But** four important gaps:

1. **No `lockSnapshotContract.ts`.** The contract is implicit in the writer (`predictionRecordService.ts:653-707`) and the auditor expectations. Nothing enforces it across MLB / NBA / NHL. Older MLB records prove this matters — the substrate they need is missing.
2. **No opening/closing line ingestion.** MLB does NOT use line movement (open→current) as a model input. The `snapshot_json.line_movement` block exists as audit-only and is populated with `direction: "unknown"` and `total_open: null` in the records we sampled. The grader uses pre-classified steam/RLM/EV signals from `sharp_signals`, which correlate with movement but are not movement.
3. **Calibration is uneven.** With n=181 V2.2 ML predictions in the 60–70% confidence band, actual hit rate is **58.1%** vs **65% expected — 6.9pp overconfident**. V2.2 Total accuracy is **47.4% (n=38)** — underwater on a binary market. V2.2 FI is **69.6% (n=23)** — promising but thin. The model is well-tested but its confidence calibration on moneyline needs a corrective layer.
4. **Three model versions co-exist in `prediction_records`.** Of 217 MLB rows: 158 V2.2, 33 V2.1, 26 V1.0. The auditor and calibration consumers must filter by `model_version` or risk mixing apples with oranges. (V1.0 rows have 0 resolved — they are likely fallback rows from games where V2.2/V2.1 gating failed; they are not historical V1 data.)

---

## A. Locked snapshot contract — what gets frozen

### A.1 Where the snapshot is constructed

`lib/services/predictionRecordService.ts:649-707` — the `buildSnapshotJsonAtLock` helper.

Documented at lines 653–657:

> `signal_rows_at_lock — every sharp_signals row for this game`
> `lines_at_lock — every lines row (ML + OU per book per side)`
> `predicted_scores_at_lock — V2.2 predicted home/away score`
> `framework_grades_at_lock — V2.1 per-market grade / signal_type`

The actual writes:

- `signal_rows_at_lock` → lines 678–692 — maps every sharp_signals row for this game into a stripped object preserving `side`, `ev_pct`, `is_plus_ev`, `computed_at`, `market_type`, `rlm_direction`, `has_steam_move`, `signal_strength`, `public_money_pct`, `steam_books_count`, `steam_detected_at`, `public_betting_pct`, `has_reverse_line_movement`. **Confirmed in live data** (pr.id=553).
- `lines_at_lock` → lines 694–702 — captures every `lines` row keyed by index 0…N. Sample record (pr.id=553) shows 34 lines preserved.
- `predicted_scores_at_lock` → lines 703–706 — `{home: number, away: number}` from V2.2 posterior projection.
- `framework_grades_at_lock` → lines 707+ — captures `ml_grade`, `ou_grade`, `nrfi_grade`, `ml_signal_type`, `ou_signal_type`, `nrfi_signal_type`, `ml_market_signal`, `ou_market_signal`, `nrfi_market_signal`.

### A.2 Other frozen fields (top-level snapshot_json keys, from a live V2.2 ML record)

47 top-level keys observed on `pr.id=553` (snapshot taken 2026-06-09 for a 2026-06-09 game):

`ai_sanity, auto_factors, data_integrity, fi_model_used, fi_v2_audit, framework_grades_at_lock, held, hold_picks, hold_reason, line_movement, lines_at_lock, lineup_confirmed, listed_line, market_line_available, ml_best_angle_eligible, ml_best_angle_reason, ml_market_aligned, ml_no_bet_reason, ml_play_grade, ml_prediction_type, model_integrity_notes, model_used, model_version, nrfi_confidence, nrfi_decision_kind, nrfi_hold_reason, nrfi_reason_codes, nrfi_threshold_zone, opposing_deterministic_warning, ou_best_angle_eligible, ou_best_angle_reason, ou_market_aligned, ou_no_bet_reason, ou_play_grade, ou_prediction_type, predicted_nrfi, predicted_scores_at_lock, public_splits, review_v1, signal_rows_at_lock, stage, stale, stale_reason, starter_confirmed, v2_2_audit, v2_best_angle_eligible, v2_data_quality_tier, v2_provisional`

`v2_2_audit` alone carries 47 sub-keys including per-market `model_prob`, `market_prob`, `edge_pct`, `play_grade`, `best_angle_eligible`, `no_bet_reason`, plus posterior totals, capping flags (`capped_by_diff`, `capped_by_total`), and feature-source taxonomy counts (`feature_preferred_count`, `feature_fallback_real_count`, `feature_proxy_count`, `feature_neutral_fallback_count`, `feature_missing_count`).

`data_integrity` carries 13 keys including `stale`, `bullpen_fallback`, `lineup_confirmed`, `posterior_capped`, `weather_fallback`, `starter_confirmed`, `odds_source_quality`, `market_baseline_valid`, `market_line_available`, `nrfi_used_fallback_era`, `review_logic_audit_passed`, `market_two_sided_available`.

`public_splits` carries `picked_side`, `picked_money_pct`, `picked_bets_pct`, `opp_side`, `opp_money_pct`, `opp_bets_pct`, `conflict`, `support`, `market`, `fetched_at`, `source`.

### A.3 The substrate is NEW and INCOMPLETE on older records

**Critical finding.** Live DB probe of three locked V2.2 MLB records (`pr.id ∈ {109, 112, 553}`):

| Field | pr.id=109 | pr.id=112 | pr.id=553 |
|-------|-----------|-----------|-----------|
| `predicted_scores_at_lock` | undefined | undefined | `{home: 3.52, away: 3.74}` |
| `signal_rows_at_lock` | undefined | undefined | array of rows |
| `framework_grades_at_lock` | absent | absent | 9 sub-keys present |
| `lines_at_lock` | absent | absent | 34 lines preserved |
| `data_integrity` | undefined | undefined | 13 sub-keys present |
| `v2_2_audit` | 47 sub-keys | 47 sub-keys | 47 sub-keys |

**Interpretation.** The lock-snapshot remediation work (commits around 2026-06-08, tracked tasks #419–#428 and #436–#443 in this audit's parent task list) introduced the substrate writers, but did not backfill older records. **This is acceptable as long as:**
- The auditor does NOT flag missing substrate on records locked before substrate-rollout date as HIGH.
- Calibration analysis filters out pre-substrate records when joining on substrate fields.

The auditor today does not check substrate-rollout date — this is a **Phase-6 follow-up** for the auditor v2.

### A.4 Is there a `lockSnapshotContract.ts`?

**No.** Grep across `lib/**/*.ts` for `lockSnapshotContract`, `LockSnapshotContract` returns no matches. The contract is implicit in:

- The writer (`lib/services/predictionRecordService.ts:649-707`).
- The auditor's category-A "Lock contract" expectations (`scripts/operator/audit-daily-edge-integrity.ts:157-205`).
- The DTO reader's locked-row handling (`app/api/lab/daily-edge/route.ts:137-150` — `resolveLockedVerdict`).

**Phase-6 work** must extract the contract into a shared module so MLB, NBA, and NHL can be checked against the same spec. The NBA UI-honesty fix in `cba9ea5` (snapshot now includes `predicted_*` + `splits_state` + `current_price`) is a step toward this, but MLB and NBA still write different shapes.

### A.5 What guards prevent overwrite after lock

Three independent layers, distributed across the writers:

1. **`lib/services/predictionRecordService.ts:10`** — file-level invariant: *"Never modifies predictions. NEVER touches `locked_at`, `slate_status`, or any prediction columns."* Enforced at the upsert site `lib/services/predictionRecordService.ts:1404-1421` via a `locked_at IS NOT NULL` exclusion before any update.
2. **`lib/services/automodelService.ts:291-314`** — `fetchLockedExternalIds()` pre-filters locked games before the model runs. Query: `.not("locked_at", "is", null)` returns locked rows so they are excluded from the model snapshot build. This is the *belt-and-suspenders* second layer.
3. **`lib/services/trackingRefreshService.ts:245-248`** — comment: *"The upsert in createPredictionRecords is locked-row-aware: it refuses to overwrite any row with locked_at != null."*
4. **`lib/services/automationOrchestrator.ts:1145`** — `ingestScoresModel` Layer 1 guard "rejects writes to locked rows (unless the incoming row carries `is_override=true`)" per `automationSlateLockSnapshot.ts:15`.

The locked-write guard is **policy-correct** but **distributed**. A bug in any single layer (e.g., a new writer added in a future phase) could bypass two layers if it forgets to call `fetchLockedExternalIds()`. **Phase-6** must add a single trip-wire (a DB-level constraint or a single shared `assertNotLocked()` helper) so every prediction-record write goes through one gate.

### A.6 Predicted scores in MLB snapshot — yes, but via `predicted_scores_at_lock` (not flat keys)

Confirmed in `predictionRecordService.ts:703-706`:

```ts
predicted_scores_at_lock: {
  home: <V2.2 posterior_home_runs>,
  away: <V2.2 posterior_away_runs>,
},
```

NBA (after `cba9ea5`) writes flat `predicted_home_score / predicted_away_score / predicted_total / predicted_spread_home` at the top of snapshot_json. **MLB and NBA disagree on shape.** Phase-6 contract work must reconcile this — either MLB adds flat keys for consistency, or the contract specifies `predicted_scores_at_lock: {home, away, total?, spread_home?}` and NBA migrates to it.

---

## B. MLB public/sharp signal incorporation

### B.1 Where MLB sharp_signals are written

`lib/services/linesService.ts:639-814` — `refreshSharpSignals()`. Behavior:

- Provider: `getSharpSignalProvider()` → `SharpAPISignalProvider` (lib/providers/sharp/_sharpApiClient.ts).
- **Carry-forward** (lines 701-714, Phase 6B.12): If the latest poll returns `null` for `public_money_pct` or `public_betting_pct` but the prior current row had non-null values, the writer carries the prior values forward. This prevents a thin SharpAPI poll from clobbering richer data.
- **History append** (lines 747-769): Before the DELETE/INSERT, a parallel row is appended to `sharp_signals_history` keyed by `recorded_at = computed_at`. This is a defensive write (error caught silently at line 767) so a history-table failure does not break the live refresh.
- **DELETE scope** (lines 771-794): per-(game_id, market_type, side) — NOT slate-wide. `derivePerSignalDeleteKeys()` at lines 75-92 builds the tuple set. Signals absent from the latest poll are preserved.
- **Insert** (lines 796-801): only if `!dryRun`.

### B.2 Does V2.2 consume sharp_signals as a model input?

**No, not as an independent feature.** Only as a market baseline input.

- `lib/automodel/mlbAutoModelV2_2.ts:165` — `computeMarketBaseline(snap.market, snap.sharp ?? null)` passes sharp_signals into the market prior layer.
- `lib/automodel/mlbIndependentProjection.ts:1-46` — the "Layer 2 independent projection" header explicitly states: *"Pure baseball features only — no market or sharp signals."* Features: starter ERA/WHIP/K9, team OPS, park factor, weather (only if `is_notable`), lineup confirmation.
- `lib/automodel/mlbV22PosteriorBlend.ts` — blends the independent projection with the market baseline using data-quality-driven trust coefficients (`0.65` / `0.45` / `0.25` / `1.0` for high/medium/low/fallback tiers). Sharp signals enter only via the market baseline side.

**This is by design.** The model is robust to thin sharp data — the independent projection still runs even if sharp_signals is empty. But the cost: V2.2 cannot use steam/RLM/EV as a corrective signal in the *projection* layer.

### B.3 Does the MLB grader consume sharp_signals?

**Yes — sharp_signals drive Layer-3 grade derivation.** `lib/services/gradeDerivationService.ts`:

- Line 24 (comment): *"For games this is the per-market Pinnacle EV from sharp_signals.ev_pct."*
- Line 929 (row shape): consumes `is_plus_ev, ev_pct, has_steam_move, steam_books_count, has_reverse_line_movement, rlm_direction, public_betting_pct, public_money_pct`.
- Lines 238-260 — `meetsBestSignalBar()`: counts strong-aligned steam/RLM/EV signals; gates `best_signal` tier.
- Lines 292-333 — `meetsBestSignalEvAlone()`: gates on `ev_pct >= 5%` plus confidence floor (model-prob alignment).
- Lines 401-417 — `meetsSharpConfirmedBar()`: requires 1+ strong-aligned EV/steam/RLM/sharp_div.
- Lines 436-452 — `meetsMarketLedBar()`: market signal strong but model edge weak.
- Lines 470-488 — `meetsModelOnlyBar()`: disqualifies on moderate+ signals (i.e., if sharp signals exist, the pick can NOT be classified `model_only`).

Steam/RLM tier + alignment are pre-classified by `lib/services/signalEvidenceClassifier.ts` (imported at line 70 of gradeDerivationService) before the grade engine sees them.

### B.4 Effect of sharp_signals on picks / confidence / grade

This is the central design decision for MLB:

| Field | Source | Affected by sharp_signals? |
|-------|--------|----------------------------|
| **pick** (predicted_ml_winner / predicted_ou_side / predicted_nrfi) | Deterministic from model posterior | NO (independent projection is pure baseball; sharp only affects market baseline) |
| **confidence** (ml_confidence / ou_confidence / nrfi_confidence) | `computeConfidence()` post-blend (mlbV22PosteriorBlend.ts:219-237) | INDIRECT — market baseline is influenced by sharp, but the run-diff bump (+4) and tier-capped ceiling dominate |
| **play_grade / signal_type** (best_signal / sharp_confirmed / market_led / model_only / market_watch / public_smoke / sharp_conflict) | `gradeDerivationService.ts` | **YES — primary driver.** Grade tier is gated on signal evidence |

This is the **correct** design contract for MLB and what NBA must match. NBA currently has a sharp-signals writer gap (Phase 2 §H findings) — until NBA has a real signals pipeline, NBA picks cannot be classified `best_signal` or `sharp_confirmed`, so they default to `model_only` or `provisional`. This is one of the cleanest visible differences between TRUSTED MLB and PARTIAL NBA.

### B.5 Last Known Good fallback

`lib/services/lastKnownGoodReader.ts:130-199` — `getCurrentOrLastKnownSplit()`:

- Read 1: `sharp_signals` current row (lines 147-153).
- Fallback 2: `sharp_signals_history` ordered by `recorded_at DESC` (lines 164-199, try-catch at line 171).
- Return shape (lines 41-48): `LkgResult<number>` carrying `value`, `observed_at`, `source` ("current" | "history"), `is_stale`.
- Scoping: per-(`game_id`, `market_type`, `side`, `field`) — lines 132-138.
- Used by `app/api/lab/daily-edge/route.ts:2947-2948` (`loadSplitsHistoryForSlate`) to hydrate locked-record DTOs.

This is the single source of truth for "what splits were observed at lock time," and it is what makes the auditor able to detect a thin current row that should have been richer (auditor category B.230-236).

---

## C. Market movement — NOT ingested as model input

### C.1 Is opening line a V2.2 feature?

**No.** Grep across `lib/automodel/mlb*.ts` for `opening_line`, `closing_line`, `line_movement`, `total_open` returns:

- No matches in `mlbAutoModelV2_2.ts`.
- No matches in `mlbAutoModelV2_1.ts`.
- No matches in `mlbIndependentProjection.ts`.
- No matches in `mlbV22PosteriorBlend.ts`.

`featureSnapshot.ts:61-106` shows the market line picker uses **current** real-book priority (Pinnacle → DraftKings → FanDuel → BetMGM → Caesars). No comparison to opening line.

### C.2 But the snapshot has a `line_movement` block — what is it?

`predictionRecordService.ts:1166` (comment): *"Used to compute snapshot_json.line_movement"* and `predictionRecordService.ts:1259` (comment): *"snapshot_json.line_movement can carry sharp-money signals at lock"*.

Live sample (pr.id=553):

```json
"line_movement": {
  "market": "moneyline",
  "source": "line_history+lines+sharp_signals",
  "direction": "unknown",
  "total_open": null,
  "picked_side": "away",
  "magnitude_pp": null,
  "rlm_direction": null,
  "total_current": null,
  "has_steam_move": false,
  ...
}
```

The block is structurally present, sourced (`source: "line_history+lines+sharp_signals"`), but the *movement fields themselves* (`direction`, `total_open`, `magnitude_pp`, `total_current`) are **null** in the records sampled. The block carries a `has_steam_move` flag from sharp_signals but that is a *signal*, not a *movement measurement*.

**Verdict: MLB has the infrastructure (line_history table, lines table, sharp_signals) to compute true movement but does not currently compute and store the open→current delta.** Phase-6 work should either (a) populate the movement fields and feed them into the model, or (b) remove the misleading scaffold and rely solely on steam/RLM signals from sharp_signals.

### C.3 Steam / RLM consumption

**Yes**, but indirectly via signal evidence classification. See §B.3 for the path: `sharp_signals.has_steam_move + steam_books_count + has_reverse_line_movement + rlm_direction` → `signalEvidenceClassifier.ts` (tier + alignment) → `gradeDerivationService.ts` (grade gate). The model itself does not see these; only the grade derivation does.

### C.4 Comparison to NBA (Phase 2)

| Aspect | MLB | NBA (V0) |
|--------|-----|----------|
| Opening line ingested as model feature | NO | NO |
| Line_history populated | YES (lines + sharp_signals) | YES (post `cba9ea5`) |
| open→current delta computed | NO (block exists but null) | NO |
| Steam/RLM signals available | YES (from sharp_signals) | LIMITED (vendor gap on splits) |
| Grade gated on signals | YES (gradeDerivationService) | YES (gradeNbaMarket) but signals often absent → defaults to model_only |

MLB has the data; NBA has neither the data nor the integration. The Phase-6 roadmap (per project_phase_6_immediate_roadmap.md item 3) tracks "true market movement ingestion" for NBA — that same work should populate MLB's `line_movement` block.

---

## D. Line / current / history behavior

### D.1 Lines table writes

`lib/services/linesService.ts:refreshLines` (per Phase 1 findings) writes to `lines` with **per-sportsbook DELETE scope** (Lines-thinning fix — tasks #429-#432). This means a refresh that returns fewer books does not clobber existing books; per-sportsbook UPSERT preserves richer prior state.

### D.2 Line history

`line_history` is the immutable append-only audit trail. Every line refresh appends a row keyed by `(game_id, sportsbook, market, side, recorded_at)`. This is what enables the auditor to verify "if pre-lock real-book lines existed, locked odds_american should be non-null" (auditor C.262-279).

### D.3 Current vs historical priority

For model inputs:
- `featureSnapshot.ts:61-106` — current real-book priority (no historical fallback). If no current real-book line is available, falls back to consensus (audit field `market_source_quality: "consensus_fallback"`).
- `mlbAutoModelV2_2.ts:329-332` — records `market_source_quality` as one of `real_book` / `consensus_fallback` / `unavailable`. This is preserved in `snapshot_json.v2_2_audit.market_source_quality`.

For grader inputs:
- `gradeDerivationService.ts` reads current `sharp_signals` with history fallback via `lastKnownGoodReader`. So grade derivation is **history-aware** while the model is **current-only**.

### D.4 Total line source priority — the lock-line fix

The "Lock-line — Patch pickListedTotal source selector + audit fields" work (task #426) added priority order at lock time:

1. Real-book current row.
2. Pre-lock real-book history (via `line_history` fallback).
3. Consensus / splits_consensus as last resort.

Audit field: `snapshot_json.listed_line` (top-level on V2.2 records, confirmed in sample). Tracking-grader uses this when grading totals — auditor D.337-341 verifies "grade used locked line for totals."

---

## E. First-inning handling

### E.1 Model

`lib/automodel/mlbFirstInningModelV2.ts` is the FI V2 model. Inputs (per `mlbFirstInningFeatureBuilder.ts`):

- First-inning ERA (requires `≥5 starts`; otherwise falls back to season ERA × 0.7 proxy at line 148-149).
- Top-3 batter OPS (aggregated from snapshot `home_lineup_top8 + away_lineup_top8`, lines 97-130).
- League average top-3 OPS = 0.760 (line 39).
- Lineup confirmation flag (lines 110-114).
- Park factor + weather (lines 176-200; weather only if `is_notable`).
- Pitcher handedness (line 18).

Confidence ceiling tiers (`mlbFirstInningModelV2.ts:45-50`): high=76, medium=64, low=58, fallback=54.

### E.2 Pick zones

`lib/automodel/mlbFirstInningModelV2.ts` — 5-zone classification (NRFI / lean-NRFI / Toss-Up / lean-YRFI / YRFI) narrowed to thresholds **47/53** per task #334 (R-16J Step 1.7).

### E.3 Grading

`lib/services/predictionGrader.ts` grades FI from `games.first_inning_runs` populated by `ingestMlbLinescores` (trackingRefreshService step 2, lines 269-281). FI grades resolve as soon as the first inning is complete, not at game-final — task #391 ("FI grading fix — grade once 1st inning complete").

### E.4 FI persistence

Confirmed live: `predicted_nrfi` flat key on snapshot_json (sample pr.id=567 — `pick=NRFI confidence=57`). FI-specific audit at `snapshot_json.fi_v2_audit`, decision metadata at `nrfi_decision_kind`, `nrfi_threshold_zone`, `nrfi_reason_codes`, `nrfi_hold_reason`.

### E.5 FI calibration sample (live DB)

V2.2 FI: **16W 7L (n=23) → 69.6%** — promising but thin (sample < 30, calibration band insufficient). V2.1 FI: 2W 1L (n=3) — negligible.

calibration_buckets row (id=1482, latest snapshot): `n=68 actual=55.88% expected=55%` for NRFI 50-60% confidence band — calibrated.

---

## F. ML / OU handling

### F.1 ML

- Pick: `predicted_ml_winner` (mlbAutoModelV2_2.ts:210).
- Confidence: `ml_confidence`, tier-capped per data_quality_tier (high=78 / med=64 / low=58 / fallback=54), with run-diff bump up to +4 when |home−away| ≥ 2.0 runs (mlbV22PosteriorBlend.ts:219-237).
- Best-angle eligibility: `ml_best_angle_eligible` + `ml_best_angle_reason` (audit fields).
- Market alignment: `ml_market_aligned`.
- No-bet reasoning: `ml_no_bet_reason`.

### F.2 Total (O/U)

- Pick: `predicted_ou_side` (mlbAutoModelV2_2.ts:225).
- Confidence: `ou_confidence`, same tier ceiling logic.
- Total guardrail: posterior total movement from market capped at **2.5 runs** (`v2_2_audit.capped_by_total`).
- Diff guardrail: home-away movement capped at **2.5 runs** (`v2_2_audit.capped_by_diff`).

### F.3 Best Angle vs Lean vs Market-Led vs Model-Only — the 7-category framework

Defined in `gradeDerivationService.ts`. From auditor task #134 (Sharp Signal framework deep audit, completed) and §B above:

| Tier | Gate |
|------|------|
| `best_signal` | Strong-aligned EV ≥ 3% AND strong steam OR RLM AND no opposing strong signals |
| `sharp_confirmed` | ≥1 strong-aligned signal AND model edge ≥ 1% |
| `market_led` | Market signal strong, model edge weak/zero |
| `model_only` | No market signals AND model edge ≥ 2% |
| `market_watch` | Mixed/moderate signals AND moderate model edge |
| `public_smoke` | Heavy public-money/bets one side AND no sharp confirmation |
| `sharp_conflict` | Sharp signals point opposite the model edge |

Each tier maps to a verdict pill (`best_angle` / `lean` / `watchlist` / `caution`) for UI rendering. See `lib/services/verdictDerivation.ts`.

### F.4 Sample-size status

Live DB (V2.2 only):

| Market | Wins | Losses | n | Accuracy |
|--------|------|--------|---|----------|
| ML | 28 | 10 | 38 | **73.7%** |
| Total | 18 | 20 | 38 | **47.4%** |
| FI | 16 | 7 | 23 | **69.6%** |

Across all versions (V2.2 + V2.1 + V1.0):
- ML 71.2% (n=52)
- Total 46.2% (n=52)
- FI 69.2% (n=26)

**ML and FI look promising. Total is underwater on a binary market — this is a calibration issue worth investigating.**

---

## G. prediction_records vs DTO/card vs tracking

### G.1 Three sources of truth

| Layer | File | Purpose |
|-------|------|---------|
| `prediction_records` (DB) | written by `predictionRecordService.ts`, `automodelService.ts`, `automationOrchestrator.ts` | Persistent prediction state; locked rows = the contract with members |
| DTO (live API response) | `app/api/lab/daily-edge/route.ts` (2900+ lines) | Sport-aware composition of game + lines + signals + automodel + verdict + sharp_read for the UI |
| `prediction_grades` (DB) | written by `predictionGrader.ts` via `trackingRefreshService.ts` step 4 | Post-game outcome grades |

### G.2 DTO consistency check (auditor responsibility)

`scripts/operator/audit-daily-edge-integrity.ts` category A:
- Line 184-189: locked pick must match DTO pick.
- Line 192-197: verdict tier must match play_grade mapping (via `verdictDerivation.ts`).
- Line 200-204: confidence drift detection (locked confidence vs DTO confidence).

If any of these diverge, the auditor returns HIGH severity. **This is the single most important post-lock invariant** — once lock has fired, the DTO must never invent a different pick or verdict.

### G.3 Tracking grader using locked line for totals

Auditor D.337-341 verifies "grade used locked line for totals" — i.e., when grading a total bet, the grader pulls `prediction_records.line_value` (frozen at lock), NOT the live current line. This prevents post-lock line movement from changing the resolution of a graded bet.

### G.4 Resolved-verdict override path

`app/api/lab/daily-edge/route.ts:137-150` — `resolveLockedVerdict()`:
- Reads locked `play_grade` if `locked_at` is non-null.
- Applies `no_bet` override if the locked snapshot was held (`held=true` or `hold_reason` populated).
- Falls back to live derivation only if `locked_at` is null (i.e., pre-lock).

This is the **read-side lock contract** that mirrors the write-side guards.

---

## H. Repair provenance

### H.1 Source attribution fields

Every repairable field in the snapshot carries provenance metadata. Examples observed:

- `snapshot_json.public_splits.source` — observed value `"sharp_signals_history"` or `"sharp_signals"` (current vs LKG fallback).
- `snapshot_json.public_splits.fetched_at` — timestamp of the source row.
- `snapshot_json.line_movement.source` — `"line_history+lines+sharp_signals"` indicating provenance trail.
- `snapshot_json.data_integrity.market_source_quality` — `"real_book"` / `"consensus_fallback"` / `"unavailable"`.
- `snapshot_json.data_integrity.bullpen_fallback` — `"unknown"` / `"yes"` / `"no"`.
- `snapshot_json.data_integrity.weather_fallback` — `"unknown"` / `"yes"` / `"no"`.
- `snapshot_json.model_integrity_notes` — array of free-text repair / degradation notes.

### H.2 Auditor repair workflow

The auditor today (`scripts/operator/audit-daily-edge-integrity.ts`) is **read-only**. The repair tooling is separate:

- `scripts/operator/repair-locked-splits.ts` (or equivalent — repair tooling for splits fallback to history).
- `scripts/operator/repair-locked-line.ts` (or equivalent for total-line fixes per task #425-#428).

Repairs that auto-apply pre-lock are part of the normal refresh cycle (per project_auditor_fixer_design_contract.md). Repairs that touch locked records require operator approval and attribution per the post-lock invalidation path (memo §11 of the design contract).

### H.3 Provenance gap — repair operator attribution

Today, when a repair touches a locked record, attribution is recorded in `snapshot_json.model_integrity_notes` (a free-text array). There is no structured field like `snapshot_json.post_lock_repairs: [{at, by, field, reason, source_row_id}]`. **Phase-6** must codify this — the operator attribution must be machine-readable so the auditor can verify it.

---

## I. Strict-mode behavior

### I.1 Auditor strict mode

`scripts/operator/audit-daily-edge-integrity.ts`:
- Flag parsed at line 59.
- Comment at line 24: *"EXIT CODES: 0 clean (no issues, OR --strict not set and only INFO/WARN issues); 1 HIGH issues found (always non-zero), or any issues in --strict mode"*.
- Effect: in `--strict` mode, any WARN or INFO causes exit-1. Without `--strict`, only HIGH issues exit non-zero.

### I.2 Where strict mode should be used

- **CI / pre-deploy** — `--strict` so any drift fails the build.
- **Production daily cron** — non-strict so INFO/WARN issues are logged but the slate publishes.
- **Operator manual run** — operator's choice based on the slate's risk profile.

Today there is no documented policy on which contexts use strict. **Phase-6** should codify this in `package.json` scripts or in `vercel.json` cron entries.

### I.3 Automodel `respectLocks` flag

`lib/services/automodelService.ts:150` — when `respectLocks=true`, locked games are excluded from the model snapshot build. This is the second layer of write protection (§A.5). The flag defaults to `true` for production crons.

---

## J. Auditor coverage

`scripts/operator/audit-daily-edge-integrity.ts` — five MLB categories (per the parallel-investigation findings consolidated above):

| Cat | Range | What it checks |
|-----|-------|----------------|
| A — Lock contract | lines 157-205 | Pick match (184-189), verdict-tier match (192-197), confidence drift (200-204) |
| B — Public splits | lines 207-256 | Snapshot rich when history had them (230-236), DTO matches snapshot (238-248), fallback source attribution (250-255) |
| C — Lines/odds | lines 258-317 | Locked odds present when pre-lock real-book existed (262-279), phantom alt-line detection (282-304), DTO line/odds consistency (307-316) |
| D — Tracking/grading | lines 320-341 | Grade row exists when game final (326-329), no duplicate grades (331-335), grade used locked line for totals (337-341) |
| E — Thinning | lines 348-381 | sharp_signals current vs history row counts (353-363), lines real-book coverage thinning (365-380) |

### J.1 Auditor coverage gaps for MLB

What the auditor does NOT yet check (Phase-6 follow-ups):

1. **Substrate completeness on recent records.** Older records lack `signal_rows_at_lock`, `lines_at_lock`, `framework_grades_at_lock`, `predicted_scores_at_lock`, `data_integrity`. The auditor should check substrate completeness on records locked AFTER the substrate-rollout date.
2. **Model-version drift.** 217 MLB records split across V1.0 / V2.1 / V2.2. The auditor should flag any locked record using a non-current model version once V2.2 is the production default.
3. **Calibration drift.** No auditor check today on calibration_buckets — i.e., the auditor does not warn when ML 60-70% band is hitting 58.1% vs expected 65%. This is calibration's job, not auditor's, but a calibration-drift WARN would be useful.
4. **Post-lock invalidation path.** Today no records are marked `post_lock_invalidated_at` because the field does not exist. Phase-6 must add this and the auditor must verify it is used when needed.
5. **MLB only.** The auditor is MLB-only (`scripts/operator/audit-daily-edge-integrity.ts:32-38` hardcodes MLB). NBA / NHL need a sport adapter interface — tracked as task #453.

---

## K. Calibration and play-grade performance

### K.1 Live DB sample (probed 2026-06-10)

**Total MLB prediction_records:** 217
**Locked:** 147
**Graded (resolved):** 151
**Date range:** 2026-06-05 → 2026-06-10 (6 slate dates)
**Model versions:** V2.2 (158), V2.1 (33), V1.0 (26)

### K.2 V2.2 accuracy by market

| Market | Wins | Losses | n | Accuracy |
|--------|------|--------|---|----------|
| ML | 28 | 10 | 38 | **73.7%** |
| Total | 18 | 20 | 38 | **47.4%** |
| FI | 16 | 7 | 23 | **69.6%** |

### K.3 V2.1 accuracy by market

| Market | Wins | Losses | n | Accuracy |
|--------|------|--------|---|----------|
| ML | 9 | 5 | 14 | 64.3% |
| Total | 6 | 8 | 14 | 42.9% |
| FI | 2 | 1 | 3 | 66.7% |

### K.4 V1.0

V1.0 records (n=26) have 0 resolved — these are likely fallback rows where V2.2/V2.1 gating failed and the model defaulted to V1 rules. Not interpretable as historical V1 performance.

### K.5 Combined accuracy by play_grade (ML only, all versions)

| play_grade | Wins | Losses | n | Accuracy | Note |
|------------|------|--------|---|----------|------|
| best_angle | 10 | 5 | 15 | 66.7% | [thin] |
| lean | 7 | 3 | 10 | 70.0% | [thin] |
| market_aligned | 1 | 1 | 2 | 50.0% | [thin] |
| no_bet | 4 | 2 | 6 | 66.7% | [thin] |
| provisional | 12 | 3 | 15 | **80.0%** | [thin] |

Best-angle picks are underperforming Provisional in this sample — but n=15 each, so this is **not statistically significant**. Phase-6 calibration work needs ≥30 per bucket before drawing conclusions.

### K.6 `calibration_buckets` table (live, 11 rows for MLB)

The table holds incremental calibration snapshots. Latest snapshots:

| Market | Band | n | Actual | Expected | Delta |
|--------|------|---|--------|----------|-------|
| ML | 60-70% | **181** | **58.1%** | 65% | **−6.9pp** |
| Total | 50-60% | 91 | 53.85% | 55% | −1.15pp |
| NRFI | 50-60% | 68 | 55.88% | 55% | +0.88pp |
| YRFI | 50-60% | 23 | n/a (no grades) | 55% | n/a |

**CRITICAL FINDING:** With n=181, the MLB ML 60-70% confidence band is hitting **58.1% vs 65% expected — 6.9pp under**. This sample size is robust enough to draw a calibration conclusion: **the V2 family is overconfident on moneyline picks.**

Note that the calibration_buckets sample is larger than the resolved prediction_records sample (n=181 vs n=52). This is because calibration_buckets accumulates across deployments, including some predictions that predate the current prediction_records table state. The auditor should reconcile these.

### K.7 What this means for the benchmark contract

The product implication: confidence values shown to members are **systematically optimistic on moneyline by ~7 percentage points** in the 60-70% band. Options:

1. **Apply a calibration shrinkage** post-blend in `mlbV22PosteriorBlend.ts` — multiply the home-away edge by a calibration factor < 1.0 before clamping to ceiling.
2. **Re-bin confidence labels** — show "Lean" instead of higher tiers for picks that would otherwise show 60-70%.
3. **Surface calibration to members** — be honest that historical 60-70% picks hit ~58%.

This is a **Phase-6 product decision**, not an auditor decision. Flagged here for visibility.

---

## L. The MLB benchmark contract — what TRUSTED means

Based on this audit, the MLB benchmark contract is:

### L.1 At lock, snapshot_json MUST include:

- `pick` / `side` / `market` per market (top-level `predicted_*` keys + per-market `*_play_grade`).
- `confidence` per market (`ml_confidence` / `ou_confidence` / `nrfi_confidence`).
- `play_grade` per market (`ml_play_grade` / `ou_play_grade` / `nrfi_grade` via framework_grades_at_lock).
- **Predicted scores** (`predicted_scores_at_lock.home`, `.away`; OR flat `predicted_home_score` / `predicted_away_score` — must standardize).
- **Predicted totals** (`v2_2_audit.posterior_total`) and predicted spread / diff (`v2_2_audit.posterior_home_diff`).
- Model probability (`v2_2_audit.ml_model_prob`, `ou_model_prob`).
- Market probability (`v2_2_audit.ml_market_prob`, `ou_market_prob`).
- Edge (`v2_2_audit.ml_edge_pct`, `ou_edge_pct`).
- **Source evidence** (`signal_rows_at_lock` — array of all sharp_signals rows; `lines_at_lock` — array of all `lines` rows).
- **Line/source quality** (`data_integrity.market_source_quality`, `data_integrity.odds_source_quality`).
- **Sharp/public state** (`public_splits` with conflict + support + source attribution; `signal_rows_at_lock` for evidence).
- **Rationale / provenance** (`ml_best_angle_reason`, `ml_no_bet_reason`, `model_integrity_notes`, `nrfi_reason_codes`).
- **Input freshness** (`public_splits.fetched_at`, `v2_2_audit.feature_*_count` taxonomy).

### L.2 Auditor MUST verify:

- Locked pick matches DTO pick.
- Verdict tier matches play_grade mapping.
- Confidence drift < threshold.
- Splits snapshot rich when history was rich.
- Locked odds present when pre-lock real-book existed.
- No phantom alt-lines.
- DTO line/odds consistent with snapshot.
- Grade row exists when final.
- No duplicate grades.
- Grade used locked line for totals.
- sharp_signals current vs history not thinning.
- lines real-book coverage not thinning.

### L.3 Repair attribution SHOULD include (Phase-6 work):

- `snapshot_json.post_lock_repairs: [{at, operator_id, field, prior_value, new_value, reason, source_row_id}]`
- `snapshot_json.post_lock_invalidated_at` + `snapshot_json.post_lock_invalidation_reason`
- Structured, not free-text. Auditor verifies presence + format.

### L.4 Data provenance SHOULD exist in snapshot_json (Phase-6 work):

- Every input value used by the model carries `_source` ∈ {`real_book`, `consensus_fallback`, `last_known_good`, `proxy`, `neutral_fallback`, `missing`}.
- Every input value carries `_source_row_id` referencing the row in `lines` / `sharp_signals` / etc.
- Every input value carries `_source_recorded_at` so freshness can be evaluated post-hoc.

V2.2 today is partway there — the `feature_*_count` taxonomy in `v2_2_audit` gives aggregate counts but not per-field provenance. **Phase-6 must extend this.**

---

## M. What is NOT yet trusted in MLB (important non-claims)

To prevent over-claiming, the following items are **explicitly not yet true** of MLB and must not be implied by reader-facing copy, marketing, model documentation, or downstream sports audits:

### M.1 CLV (Closing Line Value) is NOT a formal reader-facing metric

- **Lock line is captured** in `prediction_records.line_value` and `snapshot_json.listed_line`.
- **Closing line is NOT captured** as a distinct field. There is no `closing_line` column on `lines` and no closing-line ingest job in the cron schedule.
- **CLV is NOT computed.** No code path computes `lock_line - closing_line` or `lock_odds - closing_odds`.
- **CLV is NOT stored.** No DB column, no snapshot_json field.
- **CLV is NOT displayed.** No DTO field, no UI component.
- **CLV is NOT used in calibration.** `calibration_buckets` is keyed on `confidence_bucket_lower/upper` only.

Implication: do not claim "CLV is tracked," "we beat the close," or "sharp money agreed with our line" anywhere in reader-facing copy. Until Phase-6 builds the closing-line snapshot job and a CLV computation, those claims would be false.

### M.2 Market movement / open-to-close delta is NOT a model input

`mlbAutoModelV2_2.ts`, `mlbV22PosteriorBlend.ts`, `mlbIndependentProjection.ts`, `featureSnapshot.ts` — none consume opening line, line delta, or movement direction. The `snapshot_json.line_movement` block is structurally present (per §C.2) but its movement fields (`direction`, `total_open`, `magnitude_pp`, `total_current`) are observed null. The model uses **current** real-book lines only.

What IS used: steam/RLM signals from `sharp_signals` (via `signalEvidenceClassifier`) — these correlate with movement but are categorical signals, not measured movement.

### M.3 Sharp/public signals do NOT drive the core baseball projection

This distinction must be preserved in any reader-facing copy:

- The **independent projection** (Layer 2, `mlbIndependentProjection.ts`) is **pure baseball features only**: starter ERA/WHIP/K9, team OPS, park factor, weather (only if notable), lineup confirmation, pitcher handedness.
- Sharp signals enter via the **market baseline** (Layer 1, `computeMarketBaseline`) ONLY.
- The posterior blend (`mlbV22PosteriorBlend.ts`) combines independent + market baseline with data-quality-driven trust coefficients (high=0.65 / med=0.45 / low=0.25 / fallback=1.0).
- The **grade derivation** (Layer 3, `gradeDerivationService.ts`) consumes sharp signals to assign the 7-category grade tier.

Reader copy that says "our model considers sharp money" is **technically true** only if it specifies "in the market baseline layer and the grade tier assignment, not in the baseball projection itself." A reader who infers "the projection is sharp-influenced" would be wrong.

### M.4 Multiple model versions coexist in prediction_records

158 V2.2 + 33 V2.1 + 26 V1.0 = 217 MLB records. Calibration consumers, accuracy reports, and any "model performance" UI must filter on `model_version` or they will average across non-comparable model generations.

V1.0 rows have 0 resolved — they are fallback rows from games where V2.2/V2.1 gating failed, not historical V1 performance.

### M.5 Older locked records lack the substrate

The lock-snapshot remediation (2026-06-08 onwards, tasks #419–#443) introduced `signal_rows_at_lock`, `lines_at_lock`, `framework_grades_at_lock`, `predicted_scores_at_lock`, `data_integrity`. Records locked before this rollout (e.g., pr.id 109, 112) have `undefined` for these substrate fields. The auditor must be substrate-rollout-date-aware so it does not flag these as HIGH; calibration must filter them out when joining on substrate fields.

### M.6 Total (O/U) accuracy is underwater in the V2.2 sample

V2.2 Total: 18W / 20L (n=38) = **47.4%**. This is a binary market — a coin flip would hit ~50%. The model is currently below breakeven on totals in the small available sample. Sample is too thin to declare a calibration crisis, but it is large enough that Phase-6 must investigate whether posterior_total guardrail (2.5-run cap), weather adjustment, or the dual-source line picker has a defect.

---

## N. Phase-6 carry-forward from this Phase-3 audit

The following items are added to the Phase 6 immediate roadmap (`project_phase_6_immediate_roadmap.md`) as binding follow-ups produced by this audit:

1. **Shared `lockSnapshotContract.ts`** — extract the implicit contract into a single module enforced across MLB / NBA / NHL. NBA today writes flat `predicted_*` keys; MLB writes `predicted_scores_at_lock: {home, away}`. Reconcile before either becomes "the standard."
2. **Shared `assertNotLocked()` trip-wire** — replace the 5 distributed locked-write guards with one helper that every prediction-record writer must call. A DB constraint is even better.
3. **Model-version-aware calibration** — calibration_buckets and accuracy reports must filter on `model_version`. The 181-prediction ML-overconfidence finding must be re-verified after V2.2-only filtering.
4. **CLV design decision** — either build CLV (closing-line snapshot job + computation + storage + UI + calibration) or document that we do not claim it. No middle ground.
5. **Market movement design decision** — either populate `snapshot_json.line_movement.{direction, total_open, magnitude_pp, total_current}` and feed open→current delta into the model OR remove the misleading scaffold and rely exclusively on steam/RLM signals from sharp_signals.
6. **Totals calibration review** — investigate why V2.2 Total is 47.4% (n=38). Candidates: posterior_total guardrail miscalibration, weather is_notable gate too narrow, dual-source line picker preferring a non-tradeable consensus line.
7. **Confidence calibration correction for ML** — n=181 says the V2 family is ~6.9pp overconfident in the 60-70% band. Either apply a shrinkage post-blend OR re-label the band to manage member expectations OR surface the gap honestly in the tracking UI.
8. **Substrate completeness check in auditor** — `audit-daily-edge-integrity.ts` must verify substrate presence on records locked after rollout date; older records exempted.
9. **Post-lock invalidation path** — add machine-readable `snapshot_json.post_lock_invalidated_at` + `post_lock_invalidation_reason` + `post_lock_repairs: [{at, operator_id, field, prior, new, reason, source_row_id}]`. Auditor verifies presence + format.
10. **Per-field provenance** — extend the `feature_*_count` taxonomy to per-field `_source` + `_source_row_id` + `_source_recorded_at`. Today V2.2 has aggregate counts only.
11. **Cross-sport auditor v2** — generalize MLB-only `audit-daily-edge-integrity.ts` to a sport-adapter interface (already tracked as task #453).
12. **CLV is NOT a current product claim** — document in MEMORY/contract docs that until #4 is complete, no copy may imply CLV is tracked.

---

## Verdict

**MLB is PARTIAL-near-TRUSTED. It is NOT fully trusted yet.** Mature pipeline, rich snapshot, deterministic guards, real grader, real auditor with strict mode. But:

- The lock-snapshot contract is implicit (no shared module).
- Older records have an incomplete substrate.
- Market movement is not ingested as a model input; the `line_movement` snapshot block ships null fields.
- **CLV is not tracked, not computed, not displayed, and not used in calibration.**
- The V2 family is measurably overconfident on moneyline (n=181, −6.9pp at 60-70% band).
- Total accuracy is underwater in the V2.2 sample (47.4%, n=38).
- Three model versions coexist; calibration is not yet version-aware.

Define MLB as the **TRUSTED** benchmark only after Phase-6 has completed items 1–12 in §N above. Until then, MLB defines a *near-benchmark* — better than NBA, better than NHL, but with carry-forward work that prevents calling it "the standard."

Once those land, MLB becomes the TRUSTED benchmark and NBA / NHL can be measured against it.

---

## Cross-references

- Phase 0 inventory: `docs/audit/00-inventory.md`
- Phase 1 critical path: `docs/audit/01-active-sports-critical-path.md`
- Phase 2 NBA deep dive: `docs/audit/02-nba-model-logic-calibration.md`
- Auditor / fixer design contract: `~/.claude/.../memory/project_auditor_fixer_design_contract.md`
- Phase 6 immediate roadmap: `~/.claude/.../memory/project_phase_6_immediate_roadmap.md`

## Next phase

Phase 4 — NHL automation + tracking audit. Deliverable: `docs/audit/04-nhl-automation-tracking-audit.md`.
