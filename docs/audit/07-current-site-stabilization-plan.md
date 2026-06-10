# Current-Site Stabilization Plan

**Date:** 2026-06-10
**Author:** Engineering planning document synthesized from Phases 0–6 of the site-wide reliability audit
**Status:** PLANNING ONLY. No code changes in this document. Pause for approval before any P0/P1 fix begins.
**Scope:** CURRENT live/near-live areas only — MLB, NBA, NHL, Daily Edge shell/card/reader, tracking, grading, lock snapshots, refresh cycle, operator visibility, auditor/fixer foundation. NOT World Cup, NFL, or Player Props (those are future roadmap; referenced only for sequencing).

---

## 1. Executive summary

The site-wide reliability audit (Phases 0–6) is complete. It produced six committed deliverables (`docs/audit/00-*.md` through `docs/audit/06-*.md`) and surfaced concrete production / product-trust gaps across MLB, NBA, and NHL.

**The audit did NOT fully certify the platform as TRUSTED.** Each phase explicitly flagged that "trusted" required follow-up work that did not land in the audit itself. The MLB benchmark is "PARTIAL-near-TRUSTED." NBA is "PARTIAL — BLOCKED." NHL is "PARTIAL — Stanley Cup only, tracking verified for one game."

**World Cup is paused.** Soccer is the next major build but does not begin until the current site is verifiably stable and the gaps documented in Phases 2–6 are addressed.

**The immediate goal of this plan:**
- Correct inputs (every input is fresh, source-attributed, or honestly marked unavailable).
- Correct predictions (model outputs flow into prediction_records with the right substrate).
- Correct lock (snapshot freezes everything the card displays).
- Honest cards (the reader does not claim CLV / market movement / sharp signals it does not have).
- Correct grading and tracking (only officially-launched markets count toward public tracking; final scores ingest correctly; pending grades resolve).
- Clear operator visibility (Daniel can see slate status by sport without clicking every card).

This plan turns Phase 6 §L Buckets 1–3 into the immediate fix list for the current site, with explicit per-sport actions in §3, a prioritized fix table in §8, and a stop condition in §10. Implementation does NOT start until this plan is approved.

---

## 2. Current platform status (per sport)

### 2.1 MLB

**Live status:** PARTIAL-near-TRUSTED (Phase 3 verdict).

**What works:**
- Daily slate-cycle cron pipeline (16 invocations/day per `vercel.json`).
- V2.2 model in production (158 of 217 prediction_records, per Phase 3 §K.1 DB probe).
- Lock snapshot rich substrate on newer records (`signal_rows_at_lock`, `lines_at_lock`, `framework_grades_at_lock`, `predicted_scores_at_lock`, `data_integrity` per `predictionRecordService.ts:649-707`).
- Five layers of post-lock write protection (Phase 3 §A.5).
- Real sharp_signals writer with per-(game, market, side) DELETE scope + history append + `lastKnownGoodReader` fallback (Phase 3 §B).
- Real auditor (`scripts/operator/audit-daily-edge-integrity.ts`) with 5 categories + `--strict` mode (Phase 3 §J).
- 7-category grade derivation (`gradeDerivationService.ts`).
- First-inning lock + grading (FI WHIP integration; 5-zone classification).

**What is partial:**
- Lock snapshot contract is implicit, not codified in a shared module (Phase 3 §A.4).
- Older locked records (e.g., pr.id 109, 112) lack the rich substrate that newer records (pr.id 553+) carry (Phase 3 §A.3).
- Three model versions coexist in `prediction_records`: V2.2 (158), V2.1 (33), V1.0 (26). Calibration consumers must filter by version (Phase 3 §M.4).
- MLB Total accuracy is 47.4% (n=38) in the V2.2 sample — underwater on a binary market (Phase 3 §K.2).
- ML 60-70% band hits 58.1% vs 65% expected (n=181 from `calibration_buckets`) — ~6.9pp overconfident (Phase 3 §K.6).

**What is not trusted:**
- CLV is not measured (no closing-line snapshot job; no CLV column on `prediction_records`).
- Market movement (open→current delta) is not a model input despite the structurally-present `snapshot_json.line_movement` block being populated null (Phase 3 §C.2).

**What is currently user-visible:**
- MLB ML / Total / FI cards with predicted scores, lines, odds, grade pills, rationale, sharp/public chips when data available.

**What could mislead users:**
- The `line_movement` block, if ever surfaced in a reader, would convey "movement tracked" when it isn't.
- "Sharp signals" verbiage might overclaim influence — sharp signals affect grade tier only, NOT the independent baseball projection (Phase 3 §B.4). Reader copy needs auditing.
- Implicit assumption from MLB confidence pills that 60-70% means 65% hit rate — actually 58.1% in the n=181 sample (Phase 3 §K.6).

**What must be fixed before MLB is "stable":**
- Reader copy audit: no overclaim of CLV, no overclaim of market movement, no overclaim of sharp-signal influence on projection.
- Substrate completeness check in auditor (rollout-date-aware) so older records don't false-positive.
- Calibration consumers filter by `model_version`.
- Document the ML overconfidence finding for product (either apply shrinkage, re-label confidence bands, or surface honestly to members).

### 2.2 NBA

**Live status:** PARTIAL — Finals only.

**What works (post `cba9ea5` from 2026-06-10):**
- ML + Total render with predicted scores (`predicted_home_score`, `predicted_away_score`, `predicted_total`, `predicted_spread_home` now persisted to `snapshot_json` per `cba9ea5`).
- Tier honesty: `data_quality_tier="high"` is demoted to `"medium"` when public splits unavailable (Phase 2 fix A, commit `cba9ea5`).
- `current_price` block replaces the misleading `line_movement` block (Phase 2 fix C).
- `splits_state` categorical added (`"available"` / `"unavailable"`).
- NBA spread chip HIDDEN from `marketKeysFor("nba")` (returns ML + Total only per `cba9ea5`).

**What is partial:**
- Sharp_signals writer exists in code path but 0 rows for the current NBA Finals game (Phase 2 §H + Phase 4 §D parallel).
- SharpAPI NBA coverage gap (vendor-side; see `project_sharpapi_nba_coverage_gap.md` memory).
- NBA spread is generated by the model but neither persisted to public tracking nor captured in any internal substrate (per public-tracking-vs-internal-audit rule); currently hidden via Option B (`cba9ea5`).
- NBA prediction_records sample = 2 records (pr.id 899, 900 — tonight's Game 4); calibration impossible at this scale.

**What is not trusted:**
- NBA calibration is NOT VALIDATED (sample too small).
- NBA sharp signals affect grade tier when present but signal data is largely absent for Finals games.

**What is currently user-visible:**
- NBA Finals slate card with ML + Total markets, predicted scores, tier label, current price (with explicit "open-to-current line movement is not tracked" note per `buildNbaPredictionRecords.ts`).

**What could mislead users:**
- Pre-`cba9ea5` records might still surface with old field names if cached or queried by an older client. Verify production is reading the fresh substrate.
- Confidence values for NBA likely overconfident (mirrors MLB pattern; sample too thin to confirm).

**What must be fixed before NBA is "stable":**
- Verify `cba9ea5` is fully deployed to production (Phase 2 follow-up #449 verification — DTO probe via curl returned HTML because of Whop session gate; need authenticated production probe).
- Decide NBA spread future: keep hidden (Option B current state) or restore with Option A — internal `displayed_market_snapshot` + UI "Model context" label.
- Investigate why sharp_signals returned 0 rows for pr.id 899, 900 — vendor gap vs pipeline bug (pending task #448).
- Confirm hardcoded sharp/public copy in `app/api/lab/daily-edge/route.ts` NBA branch is honest given empty sharp_signals.

### 2.3 NHL

**Live status:** PARTIAL — Stanley Cup only, tracking verified end-to-end for 1 game.

**What works:**
- `/api/cron/nhl-daily-refresh` cron at 13:45 UTC daily, gated `NHL_CRON_ENABLED` (Phase 4 §B.1-B.2).
- Slate seed via NHL.com `/v1/schedule/{date}` (Phase 4 §B.4).
- Line ingest for ML + Total + Spread (puck-line) per `refreshNhlLinesService.ts:17-18`.
- Score ingest via `nhlScoreIngestService.ts` with ET-timezone handling (Phase 4 §G).
- Grading via `gradeNhlPredictions.ts` — VERIFIED for CAR@VGK 2026-06-09: CAR ML WIN, OVER 5.5 WIN, both correctly recorded in `prediction_grades` (Phase 4 §H.2).
- Label-style picks ("CAR ML", "OVER 5.5") parse and grade correctly.

**What is partial:**
- Snapshot substrate is THIN: 7 top-level keys vs MLB's 47 (Phase 4 §E.4).
- Missing flat `predicted_home_score`, `predicted_away_score`, `predicted_total` (NHL stores under `market_at_lock.lines_snapshot` and model output, not the MLB-flat shape).
- Missing `signal_rows_at_lock`, `lines_at_lock`, `data_integrity`, `framework_grades_at_lock` substrate.
- `sharp_signals` returned 0 rows for the verified game (vendor gap or pipeline bug — Phase 4 §D.2).
- Goalie selection is heuristic (`default_most_playoff_gp`), not confirmed starters (Phase 4 §E.5).
- Puck-line is generated by model AND displayed in UI's `first_inning` slot but NOT internally captured AND NOT UI-labeled as context-only — violates the public-tracking-vs-internal-audit rule (Phase 4 §F.3.d, §A.4 corrected framing post `f9998c6`).

**What is not trusted:**
- NHL calibration is NOT VALIDATED (n=1 game).
- NHL DTO has THREE hardcoded honesty gaps (Phase 4 §F.3):
  - `sharpSignals: []` always (`adaptNhlToDailyEdgeResponse.ts:512`).
  - `result.markets.{pickResult, gradeUnits}: null` even on graded games (`adaptNhlToDailyEdgeResponse.ts:522-526`).
  - `breakdown.sharpRead.key: "wait_no_edge_clean"` always (`adaptNhlToDailyEdgeResponse.ts:531-533`).

**What is currently user-visible:**
- NHL Stanley Cup slate card with ML + Total + Puck-line cards.
- Final scores rendered after game ends.

**What could mislead users:**
- The puck-line card shows a recommendation with the SAME visual treatment as ML and Total — but it's not tracked, not graded, not in public tracking. Members reasonably assume the same audit trail applies. This is the largest live-user trust issue per Phase 4.
- After grading, users see final scores but `result.markets.pickResult: null` means the UI shows no win/loss outcome even though `prediction_grades.win = true` (verified for CAR ML + OVER 5.5). Users can't tell their pick won.
- `sharpRead` text in the breakdown narrative says "no decisive sharp signal" for every game, regardless of whether sharp data was absent or present.

**What must be fixed before NHL is "stable":**
- Decide puck-line fate immediately: Option A (internal capture + "Model context · Not part of official tracking" label) or Option B (hide from `marketKeysFor("nhl")` mirroring NBA spread).
- Wire real `prediction_grades` join into NHL DTO `result.markets.pickResult` + `gradeUnits` so users see WIN/LOSS after games.
- Replace hardcoded `sharpSignals: []` with real fetch (returns empty when no data, but path is honest).
- Replace hardcoded `sharpRead: "wait_no_edge_clean"` with derived value (use `"no_sharp_data_available"` when sharp data absent).
- Surface goalie assumption ("Carter Hart starts" — heuristic, not confirmed) so members know the model is guessing.

---

## 3. Immediate live-card truthfulness fixes

This section turns each per-sport "what must be fixed" list into the smallest concrete verification or change.

### 3.1 NBA

| # | Action | Verification | Type |
|---|--------|--------------|------|
| 3.1.1 | Confirm `marketKeysFor("nba")` returns ML + Total only (post `cba9ea5`) | Read `app/lab/components/daily-edge/DailyEdgeShell.tsx`; grep for `marketKeysFor`; expect `["moneyline", "total"]` for sport `"nba"` | Verification (read-only) |
| 3.1.2 | Confirm NBA ML/Total still show correctly on production | Authenticated production probe of `/api/lab/daily-edge?sport=nba&date=<today>` and visual card review | Verification (requires Whop session) |
| 3.1.3 | Confirm `predicted_home_score`, `predicted_away_score`, `predicted_total`, `predicted_spread_home` persisted in `snapshot_json` for pr.id 899 + 900 | DB query: `SELECT id, snapshot_json->'predicted_home_score' FROM prediction_records WHERE id IN (899, 900)` | Verification (read-only) |
| 3.1.4 | Confirm `line_movement` block replaced with `current_price` (renamed in `cba9ea5`) | DB query: snapshot_json keys; verify `current_price` present, `line_movement` block absent OR rendered honest | Verification (read-only) |
| 3.1.5 | Confirm `splits_state` and `data_quality_tier` honest (tier "medium" when `has_splits=false`) | DB query: `SELECT splits_state, data_quality_tier FROM <snapshot keys> WHERE id IN (899, 900)`; expect `splits_state="unavailable"` and tier="medium" | Verification (read-only) |
| 3.1.6 | Audit NBA DTO + reader copy for unsupported sharp/public/movement claims | Read `app/api/lab/daily-edge/route.ts` NBA branch and `nbaMarketReview.ts` rationale text; grep for "sharp", "public", "movement"; confirm any claim survives the empty-sharp_signals reality | Audit (read-only) |

If 3.1.1–3.1.5 are already confirmed by `cba9ea5` verification (which earlier session noted as PASSED with snapshot probes for pr.id 899/900), only 3.1.2 (production probe) and 3.1.6 (copy audit) remain.

### 3.2 NHL

| # | Action | Verification | Type |
|---|--------|--------------|------|
| 3.2.1 | Decide puck-line fate: Option A (internal capture + context label) vs Option B (hide) | Product decision; preferred recommendation in §8 | Decision needed |
| 3.2.2 | Confirm NHL ML/Total render correctly | Authenticated production probe; visual card review for CAR ML / OVER 5.5 if still showing, or for the next NHL Finals game | Verification |
| 3.2.3 | Confirm NHL final scores ingested correctly for game.id=15204 | DB query: `SELECT status, home_score, away_score FROM games WHERE id = 15204` — expect status="OFF", home=3, away=5 | Verification (already confirmed in Phase 4 §H.2) |
| 3.2.4 | Confirm `prediction_grades` rows exist + correct for pr.id 946, 947 | DB query: `SELECT result, win, loss FROM prediction_grades WHERE prediction_record_id IN (946, 947)` — expect both `result="win"`, `win=true` | Verification (already confirmed in Phase 4 §H.2) |
| 3.2.5 | Confirm NHL DTO returns `result.markets.pickResult` populated (not null) after grading | Production probe; check DTO response for graded NHL games — expected `pickResult: "win"` for pr.id 946, 947 | Verification (LIVELY-VISIBLE — currently NULL per Phase 4 §F.3.b) |
| 3.2.6 | Confirm hardcoded `sharpRead` and `sharpSignals` copy is not misleading | Read `app/api/lab/daily-edge/route.ts` NHL branch and `adaptNhlToDailyEdgeResponse.ts:512,531-533` — confirm what users see and whether it overclaims | Audit (read-only) |
| 3.2.7 | Decide whether to surface goalie assumption attribution | Recommend YES — show "Assumed starters: Andersen (CAR), Hart (VGK) — heuristic, not confirmed" so members aren't misled | Product decision + small UI change |

**3.2.1 recommendation (per the public-tracking-vs-internal-audit rule + Phase 4 §A.4):**
- **Option A (recommended)** if we want members to see puck-line analysis: add `snapshot_json.displayed_context_markets.puck_line` with pick/line/edge/projection/source AT LOCK, and add a "Model context · Not part of official tracking" label to the puck-line chip with visually-distinct styling.
- **Option B (conservative)** if we want zero risk during the rest of the Stanley Cup: hide puck-line from `marketKeysFor("nhl")` mirroring NBA spread. No display, no audit substrate needed.
- Decision should land before next NHL Finals game.

### 3.3 MLB

| # | Action | Verification | Type |
|---|--------|--------------|------|
| 3.3.1 | Confirm MLB card/reader does not overclaim CLV | Grep `app/lab/components/daily-edge/*.tsx` and `app/api/lab/daily-edge/route.ts` MLB branch for "CLV", "closing line", "beat the close"; confirm no member-facing claims | Audit (read-only) |
| 3.3.2 | Confirm MLB card/reader does not overclaim true market movement | Grep for "movement", "moved", "open→current", "line moved"; confirm any claim is accurate (e.g., shows actual steam/RLM signal, not invented movement) | Audit (read-only) |
| 3.3.3 | Confirm sharp/public wording accurately reflects how signals affect picks vs grade | Read reader copy generators (e.g., `pickBreakdownGenerator.ts`, `signalSummaryGenerator.ts`); per Phase 3 §B.4, sharp signals affect GRADE TIER, not the independent baseball projection. Copy should not say "sharp money agrees with our model" if that implies projection-level agreement | Audit (read-only) |
| 3.3.4 | Confirm totals calibration concern (47.4% V2.2 in n=38 sample) is INTERNAL — not surfaced as overconfident reader copy | Audit reader copy for Total picks; confirm no language like "our model is sharp on totals" or "we're hot on totals" given the underwater sample | Audit (read-only) |
| 3.3.5 | Confirm lock snapshot substrate exists on current/future rows (not just backfilled historical ones) | DB probe: today's locked MLB records — verify `signal_rows_at_lock`, `lines_at_lock`, `predicted_scores_at_lock`, `data_integrity` all present | Verification (read-only) |

---

## 4. Current tracking / grading stabilization

### 4.1 What must be fixed or verified

| # | Item | Current state | Action |
|---|------|---------------|--------|
| 4.1.1 | **Final score ingest** for MLB / NBA / NHL | MLB: working (slate-cycle + tracking-refresh). NBA: working via tracking-refresh. NHL: working (verified for game.id=15204) | Verify weekly: cron logs show successful ingest for each sport; no games stuck in "live"/"scheduled" after kickoff + 6 hours |
| 4.1.2 | **Pending grades after final** | MLB: working. NBA: thin sample. NHL: working for 2 graded records | Add regression test that simulates pending → ingest → UPDATE for NHL specifically (per Phase 4 §H.4, no test exists today) |
| 4.1.3 | **Result display in DTO/card** | MLB: working. NBA: thin sample to verify. NHL: BROKEN — `result.markets.{pickResult, gradeUnits}: null` per Phase 4 §F.3.b. Even though grading is correct in DB, users see no WIN/LOSS on the card | **P0 fix:** wire `prediction_grades` join into NHL DTO `result.markets` |
| 4.1.4 | **Tracking page correctness** | MLB: 217 records, calibration_buckets populated. NBA: 2 records (Finals). NHL: 2 records (Finals) | Confirm tracking page filters by `model_version`; today's MLB calibration is contaminated by V2.2 + V2.1 + V1.0 mixing |
| 4.1.5 | **Label-style pick grading** (e.g., "CAR ML", "OVER 5.5") | NHL: working per `gradeNhlPredictions.ts`; verified Phase 4 §H | No fix needed; document in operator runbook |
| 4.1.6 | **ML and Total grading for NBA/NHL** | NBA: working (gradeNbaMarket). NHL: working (gradeNhlPredictions) | Confirm via the next graded game's `prediction_grades` row matches the actual game result |
| 4.1.7 | **MLB ML/Total/FI grading** | Working (217 graded records; FI grader fixed in #391 to resolve once 1st inning complete) | Confirm: no regressions on recent slates; verify FI grader still runs at correct time |
| 4.1.8 | **Official public tracking market registry** | DOES NOT EXIST | **P0 build:** create `lib/config/officialTrackingMarkets.ts` with: MLB=[ML, Total, FI], NBA=[ML, Total], NHL=[ML, Total], all future sports=[]. Centralizes the public-tracking decision |
| 4.1.9 | **No accidental tracking pollution from context-only markets** | RISK: NHL puck-line currently displayed but if any future code path were to write a `prediction_records.market="spread"` row for NHL, it would silently extend public tracking | **P0 build:** add a `predictionRecordService` guard that calls `isOfficiallyTracked(sport, market)` before any insert. Throws (or routes to context-only substrate) on rejection |

### 4.2 Binding rule (do NOT do)

Per the public-tracking-vs-internal-audit rule:
- Do NOT add NBA spread to `prediction_records` (would auto-pollute public tracking).
- Do NOT add NHL puck-line to `prediction_records`.
- If displayed, they require **internal audit snapshot** (`displayed_market_snapshot` substrate) AND **context-only UI labeling**, NOT public tracking inclusion.

---

## 5. Lock snapshot stabilization

### 5.1 Minimum shared lock requirements (current site, before future sports)

Every user-visible field on a locked card must satisfy ONE of:

1. **Sourced from the locked snapshot** (frozen at lock time per the sport-specific substrate).
2. **Clearly live / non-prediction context** (e.g., "Final score" is live; not a prediction).
3. **Not displayed** (if neither (1) nor (2) holds, the field must be removed from the reader).

### 5.2 Per-field requirements

| Field | Must be in snapshot? | Notes |
|-------|---------------------|-------|
| Pick (e.g., "CAR ML") | YES | All sports today |
| Side (home/away/over/under) | YES | All sports today |
| Market (moneyline/total/first_inning) | YES | All sports today |
| Line value | YES | Total markets; null for ML |
| Odds (American) | YES | Per pickListedTotal contract |
| Confidence (0-100) | YES | All sports today |
| Play_grade (best_angle/lean/watchlist/caution) | YES | All sports today |
| Predicted scores (home/away) | YES | MLB: in `predicted_scores_at_lock` post-substrate-rollout. NBA: flat top-level post-`cba9ea5`. NHL: derived from `model_output.expected_goal_diff` + `expected_total_goals`; **NOT stored as flat top-level** — gap |
| Predicted total | YES | MLB: `v2_2_audit.posterior_total`. NBA: flat top-level. NHL: `expected_total_goals` in model_output |
| Predicted spread (where applicable) | YES (if displayed) | NBA: `predicted_spread_home` post-`cba9ea5` (but spread is hidden so currently moot). NHL: derived |
| Model probability | YES | All sports |
| Market probability | YES | All sports when market data available |
| Edge percentage | YES | All sports |
| Source evidence (line books, signal rows) | YES (rich) | MLB: `signal_rows_at_lock` + `lines_at_lock`. NBA: `current_price` block. NHL: `market_at_lock.lines_snapshot` |
| Line / source quality | YES | MLB: `data_integrity.market_source_quality`. NBA: tier label. NHL: book count |
| Public / sharp state | YES (categorical) | MLB: `public_splits` + signal rows. NBA: `splits_state` post-`cba9ea5`. NHL: GAP — no equivalent |
| Input freshness timestamps | YES | MLB: present. NBA: `data_quality_tier` reflects. NHL: GAP |
| Model version | YES | All sports |
| Provenance / rationale | YES | All sports |
| Lock timestamp | YES | All sports (`locked_at`) |
| Context-only displayed markets | YES (if displayed) | New substrate per Phase 6 §D; NHL puck-line + (future) NBA spread go here, NOT in `prediction_records` |

### 5.3 Post-lock mutation rules

After lock, the following MUST NOT change:
- Pick
- Side
- Line / odds
- Confidence
- Play_grade
- Model probability / market probability / edge
- Source evidence
- Rationale

Only outcome / result / grading / tracking repair fields may update, with operator attribution (per Phase 6 §I.3).

### 5.4 Immediate gaps by sport

**MLB:**
- ✅ Substrate complete on records locked after 2026-06-08 rollout.
- ⚠️ Older records (pr.id 109, 112) lack substrate; auditor must be rollout-date-aware.
- ✅ Five layers of post-lock write protection in place.

**NBA:**
- ✅ Post-`cba9ea5`: `predicted_*_score`, `splits_state`, `current_price` persisted.
- ⚠️ Sample is small (pr.id 899, 900); confirm new records continue to write the substrate.
- ⚠️ If spread ever re-enabled, requires `displayed_market_snapshot` substrate.

**NHL:**
- ❌ Substrate THIN: 7 keys vs MLB's 47 (Phase 4 §E.4).
- ❌ Missing `predicted_home_score` / `predicted_away_score` / `predicted_total` flat top-level fields.
- ❌ Missing `data_integrity` block, `framework_grades_at_lock`, `public_splits` substrate.
- ❌ Puck-line displayed without `displayed_market_snapshot` substrate (per Phase 4 §F.3.d).

### 5.5 Immediate stabilization actions for §5

- **P1 — Add `displayed_market_snapshot` substrate** (Phase 6 §D) for NHL puck-line (or hide puck-line per Option B). One or the other; status quo is wrong.
- **P1 — Extend NHL substrate** to include `predicted_home_score`, `predicted_away_score`, `predicted_total`, `data_integrity`, `public_splits` (when SharpAPI returns data) so the auditor can verify lock completeness.
- **P2 — Centralize lock snapshot writer guard:** today the post-lock protection is distributed across 5 files (Phase 3 §A.5). Add a shared `assertNotLocked(predictionRecordId, field)` helper used by all writers. DB-level trigger as belt-and-suspenders.

---

## 6. Refresh-cycle stabilization

### 6.1 Required behavior

**Before lock (per-cron-cycle, sport-parameterized):**
1. Refresh source data (lines, sharp_signals, schedule, scores).
2. Repair deterministic stale/missing inputs when source-backed (per [[project-auditor-fixer-design-contract]]).
3. Refresh `prediction_records` if pre-lock AND inputs changed (this is GOOD — corrected model output may produce a different pick).
4. Degrade/block if required inputs are missing (slate gate per Phase 6 §G.3).
5. Update card honestly (no stale display; no "we have data" claims when we don't).

**At lock:**
- Freeze the COMPLETE snapshot per §5.

**After lock:**
- Do NOT alter prediction decision (pick, confidence, line, odds, grade, etc. per §5.3).
- Only update final score / result / grading / tracking with source-backed attribution.

### 6.2 Current state per sport

**MLB:**
- ✅ Slate-cycle cron runs 16×/day; intraday refreshes from 12:00 onward.
- ✅ Pregame-sweep every 15 min handles lock + last-mile refresh.
- ✅ Tracking-refresh hourly handles post-game ingest + grading.
- ⚠️ Repair behavior is operator-script-driven, not auto-applied in-cron. Phase 6 §G turns this into a refresh-cycle auditor/fixer.

**NBA:**
- ✅ `/api/cron/nba-daily-refresh` at 13:30 UTC daily.
- ✅ Stale-skip bug fixed in `createNbaPredictionRecords` (task #447 completed).
- ⚠️ Sample too small (2 records) to verify mid-day refresh behavior.

**NHL:**
- ✅ `/api/cron/nhl-daily-refresh` at 13:45 UTC daily.
- ✅ Pre-lock refresh happens inside the shared hourly tracking-refresh + 15-min pregame-sweep.
- ❌ No NHL-specific pre-lock refresh on the same cadence as MLB; adequate for 1 game/day but inadequate at scale.

### 6.3 Smallest near-term steps to get correct behavior

| # | Step | Sport | Phase 6 ref |
|---|------|-------|-------------|
| 6.3.1 | Shared `assertNotLocked()` helper to consolidate 5 distributed guards | All | §F |
| 6.3.2 | Refresh-cycle auditor/fixer 10-step pass (skeleton, MLB-only first) | MLB | §G |
| 6.3.3 | Add MLB substrate-completeness check (rollout-date-aware) | MLB | §H.1 H-13 derivative |
| 6.3.4 | Generalize the auditor for sport adapter input (small step toward task #453) | All | §H |
| 6.3.5 | Define what "BLOCKED" looks like in the DTO when required inputs missing | All | §G.3 |

The full Phase 6 §G 10-step pass is Bucket-4 work. For current-site stabilization, the minimum is steps 6.3.1 + 6.3.3 + 6.3.4.

---

## 7. Operator visibility

Daniel needs to see slate state by sport daily without clicking every card. This is a LIGHTWEIGHT first version of the Phase 6 §J operator dashboard — not the full final version.

### 7.1 First operator report contents

| Section | Per-sport rows | Fields per row |
|---------|----------------|---------------|
| **Slate status** | MLB, NBA, NHL | sport, slate_date, slate_status (TRUSTED / PARTIAL / BLOCKED), exact blocker reason if not TRUSTED |
| **Refresh freshness** | Per sport | last cron run timestamp, last successful provider refresh, time since last refresh, expected next refresh |
| **Market data coverage** | Per sport, per market | book count per market, oldest book row's `recorded_at`, "thin" / "available" / "unavailable" |
| **Sharp / public coverage** | Per sport | sharp_signals row count, percentage of games with at least one signal row, vendor status (available / known-gap) |
| **Prediction freshness** | Per sport | prediction_records count, oldest pre-lock record's `updated_at`, count of records with stale inputs |
| **Lock status** | Per sport | locked count / total count, time until next lock |
| **Grade / tracking status** | Per sport | final-status games count, graded count, pending-grade count, any anomalies |
| **Safe repairs available** | Per sport | count of repairs that can run automatically (e.g., backfill `_source_recorded_at` for incomplete rows) |
| **Repairs needing approval** | Per sport | count + reasons (e.g., unmatched provider rows, post-lock invalidation candidates) |
| **User-facing impact** | Per sport | "X games shown" / "Y games blocked from user view" / "Z games TRUSTED status" |

### 7.2 Implementation form

**First version (recommended):** a single operator script that runs on demand and prints a structured report to stdout (or writes to a `docs/operator/<date>.md` file). Cron-runnable later.

**Second version:** an `/admin/operator` (or `/lab/operator`) page (per Phase 6 §J full dashboard).

**Third version:** real-time updates via a long-running cron + webhook to Daniel's Slack / email.

Current-site stabilization needs at minimum the **first version** — operator script + structured output.

### 7.3 Implementation files (recommended)

| File | Purpose |
|------|---------|
| `scripts/operator/daily-status-report.ts` (new) | Reads from `prediction_records`, `prediction_grades`, `lines`, `sharp_signals`, `games`; produces structured per-sport report |
| `scripts/operator/run-status-report.sh` (new) | Wrapper that runs the report and prints / writes to file |

### 7.4 What this report does NOT do

- Does NOT mutate any data (read-only).
- Does NOT replace the per-sport auditor (`audit-daily-edge-integrity.ts`) — runs alongside it.
- Does NOT decide repair approval — surfaces queue for Daniel.

---

## 8. Prioritized fix list — current site only

Buckets:
- **P0** — live user-facing trust issue (must fix before next live slate is acceptable)
- **P1** — current production reliability issue (must fix this week)
- **P2** — auditability / operator visibility issue (must fix this sprint)
- **P3** — future hardening (referenced for sequencing but not blocking)

| # | Priority | Severity | Sport | Issue | User-facing impact | Affected files | Affected DB tables | Recommended fix | Auto-fixable? | Needs product approval? | Blocks "site stable"? | Est. risk |
|---|----------|----------|-------|-------|-------------------|----------------|-------------------|-----------------|---------------|------------------------|----------------------|----------|
| F1 | P0 | HIGH | NHL | `result.markets.{pickResult, gradeUnits}: null` even on graded games — users can't see WIN/LOSS after final | LIVE: members see final score but no "your pick won" | `adaptNhlToDailyEdgeResponse.ts:522-526` | reads `prediction_grades` | Wire `prediction_grades` join into DTO `result.markets`; populate `pickResult` ∈ {win/loss/push/void/pending} and `gradeUnits` | NO (needs code change) | NO | YES | LOW (read-only DTO change) |
| F2 | P0 | HIGH | NHL+NBA | Context-only markets (NBA Spread, NHL Puck Line) displayed without context-only label | LIVE: members see chip with no indication it's not officially tracked | `marketKeysFor` + `marketShortLabelFor` + chip rendering in `DailyEdgeShell.tsx` | none (UI-only) | **2026-06-10 corrected direction: Option A** — keep visible as context, append `*` to short label, add slight opacity de-emphasis, render footnote `* Model context · Not part of official tracking` below market chips. Option B (hide) was the wrong direction; rolled back in commit `29dc76e`. Internal `displayed_market_snapshot` deferred to P1. | NO | NO (decided) | YES | LOW (UI-only) |
| F3 | P0 | HIGH | NHL | Hardcoded `sharpSignals: []` always | LIVE: UI silently ignores any future sharp data | `adaptNhlToDailyEdgeResponse.ts:512` | reads `sharp_signals` | Replace hardcoded empty array with real fetch (returns [] when empty, populated when data lands) | NO | NO | YES | LOW |
| F4 | P0 | HIGH | NHL | Hardcoded `breakdown.sharpRead.key: "wait_no_edge_clean"` | LIVE: narrative defaults to "no decisive signal" regardless of reality | `adaptNhlToDailyEdgeResponse.ts:531-533` | reads `sharp_signals` | Derive from actual signal state; use `"no_sharp_data_available"` when data absent | NO | NO | YES | LOW |
| F5 | P0 | MEDIUM | NBA | Verify `cba9ea5` (NBA UI honesty fixes) is fully deployed and rendering correctly on production | LIVE: NBA card hygiene depends on this commit | n/a (deployment verification) | reads `prediction_records.snapshot_json` | Authenticated production probe; visual review for pr.id 899, 900 | YES (verification only) | NO | YES | LOW |
| F6 | P0 | MEDIUM | NBA | Audit NBA DTO/reader copy for unsupported sharp/public/movement claims | LIVE: copy may overclaim signal influence | `app/api/lab/daily-edge/route.ts` NBA branch + rationale generators | n/a (copy audit) | Read + grep; flag any overclaim; rewrite | YES (audit) → NO (rewrites) | NO | YES | LOW |
| F7 | P0 | MEDIUM | MLB | Audit MLB DTO/reader for CLV / market-movement / sharp-projection overclaims | LIVE: copy must not say CLV is tracked, sharp drives projection, or movement is ingested | `app/lab/components/daily-edge/*.tsx`, `pickBreakdownGenerator.ts`, `signalSummaryGenerator.ts` | n/a (copy audit) | Read + grep; rewrite any overclaim | YES (audit) → NO (rewrites) | NO | YES | LOW |
| F8 | P1 | HIGH | All | Official public tracking market registry does not exist | INTERNAL: any future write to `prediction_records` could silently pollute tracking | new: `lib/config/officialTrackingMarkets.ts` | reads only | Create registry; add `isOfficiallyTracked()` helper; integrate into writer paths | NO | NO | YES | LOW |
| F9 | P1 | HIGH | NHL | Snapshot THIN: missing flat `predicted_home_score`, `predicted_away_score`, `predicted_total` | INTERNAL: auditor blind to lock completeness; future calibration cannot use NHL records | `buildNhlPredictionRecords.ts`, `adaptNhlToDailyEdgeResponse.ts` | snapshot_json | Add flat predicted_* fields at top of snapshot_json (re-shape from `model_output`) | NO | NO | YES | LOW (additive) |
| F10 | P1 | MEDIUM | NHL | Sharp_signals 0 rows for verified game — vendor gap vs pipeline bug | INTERNAL: signal pipeline status unclear | `automationOrchestrator.ts:941-951`, `_sharpApiNhlClient.ts` | reads `sharp_signals` | Diagnostic dry-run for next NHL game; classify vendor gap vs bug | YES (diagnostic) | NO | NO | LOW |
| F11 | P1 | MEDIUM | NHL | NHL goalie selection heuristic (`default_most_playoff_gp`), not confirmed | LIVE: model uses guessed goalies | `buildNhlPredictionRecords.ts`, `_nhlApiClient.ts` | reads NHL.com API | Build confirmed-goalie ingest; surface attribution in UI | NO | NO | NO | MEDIUM |
| F12 | P1 | MEDIUM | All | 5 distributed post-lock write guards; no single trip-wire | INTERNAL: bug in any layer could bypass others | `predictionRecordService.ts:1404-1421`, `automodelService.ts:291-314`, `trackingRefreshService.ts:245-248`, `automationOrchestrator.ts:1145`, `daily-edge/route.ts:137-150` | none | Create `lib/db/assertNotLocked.ts` shared helper; refactor all writers to call it | NO | NO | YES | MEDIUM (cross-file refactor) |
| F13 | P2 | MEDIUM | All | No operator status report — Daniel must click cards to see slate state | INTERNAL: operator visibility | new: `scripts/operator/daily-status-report.ts` | reads from many | Build first-version operator report per §7 | NO | NO | NO | LOW |
| F14 | P2 | MEDIUM | All | Auditor MLB-only; no cross-sport adapter | INTERNAL: NBA/NHL have no auditor coverage | `scripts/operator/audit-daily-edge-integrity.ts:32-38` (task #453) | reads many | Add sport-adapter parameter; implement NBA + NHL audit rule sets | NO | NO | NO | MEDIUM |
| F15 | P2 | LOW | MLB | Calibration consumers don't filter by `model_version` | INTERNAL: 158 V2.2 + 33 V2.1 + 26 V1.0 mixed in reports | calibration writers + readers | reads `prediction_records` + `prediction_grades` | Add `model_version` filter; surface per-version metrics | NO | NO | NO | LOW |
| F16 | P2 | LOW | MLB | ML 60-70% band 58.1% vs 65% expected (n=181) — overconfident | INTERNAL: confidence pills overstate accuracy | model post-blend stage | none | Decide: apply shrinkage post-blend OR re-label confidence bands OR surface honestly | NO | YES | NO | MEDIUM (model behavior change) |
| F17 | P2 | LOW | MLB | Total accuracy 47.4% (n=38) — underwater on binary market | INTERNAL: small sample, but a concern | feature builder + model | none | Investigate posterior_total guardrail, weather is_notable gate, dual-source line picker | NO | NO | NO | MEDIUM (research) |
| F18 | P3 | LOW | All | No CLV measurement infrastructure | NONE today (we don't claim CLV) | future | future | Build closing-line snapshot job, CLV computation, reporting | NO | YES | NO | HIGH |
| F19 | P3 | LOW | All | No true market movement ingestion (open→current delta) as model input | NONE today (we don't claim movement) | future | future | Build movement ingestion or formally remove the `line_movement` scaffold | NO | YES | NO | MEDIUM |
| F20 | P3 | LOW | All | NHL pending-grade UPDATE regression test missing | NONE today (current sample = 2 graded) | new test script | none | Add regression test simulating pending → final → grade | NO | NO | NO | LOW |

---

## 9. Recommended execution sequence

| Step | Action | Type | Approval needed? |
|------|--------|------|------------------|
| 1 | Push Phase 6 (`cb5e050`) if not pushed | Operations | ALREADY DONE (confirmed `cb5e050` on origin/main) |
| 2 | Commit this stabilization plan | Doc commit | Self-approved per "commit only this planning doc" |
| 3 | Pause for Daniel's approval of §3 + §8 fix list | DECISION POINT | Daniel approves which P0/P1 fixes proceed, which need product approval first (e.g., F2 puck-line Option A vs B) |
| 4 | Fix any P0 live-card truthfulness issues (F1–F7) | Code change | Per-fix approval |
| 5 | Add official public tracking registry (F8) | Code change | Approve scope |
| 6 | Add context-only `displayed_market_snapshot` OR hide remaining context-only markets (F2) | Code change | Product decision Option A vs Option B |
| 7 | Add current-site lock snapshot minimums (F9 + F12) | Code change | Approve refactor scope |
| 8 | Add current-site auditor checks (F14) | Code change | Approve cross-sport adapter scope |
| 9 | Add operator daily status report (F13) | Code change | Approve report format |
| 10 | Smoke test MLB / NBA / NHL slates end-to-end | Verification | Daily verification |
| 11 | Stop condition check (§10) | Verification | Daniel confirms |
| 12 | Decide when to reopen World Cup | DECISION POINT | Daniel decides after §10 passes |

**Critical:** steps 4–9 are sequential checkpoints. Each ends with Daniel verifying before the next begins. No bundled implementation.

---

## 10. Stop condition — "current site stabilized enough to move on"

The site is considered stabilized when ALL of the following are true:

| # | Stop criterion | Verification |
|---|----------------|-------------|
| S1 | NBA card verified honest | F5 + F6 PASSED; production NBA card shows ML + Total with honest copy (no overclaim of CLV / movement / sharp projection); pr.id 899, 900 substrate confirmed |
| S2 | NHL card verified honest | F1 + F2 + F3 + F4 PASSED; puck-line either captured in `displayed_market_snapshot` with context label OR hidden; result.markets shows WIN/LOSS post-grade; hardcoded sharp copy replaced with honest derivation |
| S3 | MLB card verified honest | F7 PASSED; production MLB reader shows no overclaim of CLV / true movement / sharp-on-projection |
| S4 | No displayed market lacks either official tracking OR context-only labeling + internal snapshot | **Corrected 2026-06-10:** NBA spread + NHL puck-line restored as context-only (`*` label + footnote + de-emphasis) in commit `29dc76e`. Public tracking remains ML+Total only for NBA/NHL. Internal `displayed_market_snapshot` substrate is P1 follow-up. |
| S5 | Public tracking scope is centralized | F8 PASSED; `OFFICIAL_TRACKING_REGISTRY` exists; `isOfficiallyTracked()` helper used by all `prediction_records` writers |
| S6 | Current ML / Total / FI markets grade correctly | F1 PASSED for NHL; MLB regression tests pass; NBA grading verified for the next graded game |
| S7 | Final scores ingest correctly for active sports | MLB / NBA / NHL final-score ingest verified for sample slate; no stuck "live" or "scheduled" games after kickoff + 6 hours |
| S8 | Lock snapshots contain all displayed prediction fields | F9 PASSED for NHL; F12 PASSED for all sports; auditor confirms substrate completeness on records locked post-rollout-date |
| S9 | Operator can see slate status / blockers | F13 PASSED; daily status report runs and prints per-sport state |
| S10 | No current HIGH issues remain unresolved | Auditor cross-sport (F14) runs and returns zero HIGH; manual sweep confirms |

When all 10 criteria pass, the current site is "stabilized." World Cup work can be reopened. Until then, World Cup is paused per Daniel's 2026-06-10 directive.

---

## 11. What this plan does NOT do

- Does NOT start the World Cup / Soccer implementation. Per Daniel's 2026-06-10 directive: paused until §10 stop condition passes.
- Does NOT plan / purchase BDL World Cup data.
- Does NOT begin code changes. This is a planning document; each fix in §8 needs separate approval before implementation.
- Does NOT replace the per-sport audit reports (Phases 2–4). Those remain the source of evidence.
- Does NOT introduce new architectural patterns (e.g., `SportAdapter` interface from Phase 6 §B). That foundation work is sequenced AFTER current-site stabilization, as Bucket 4 of Phase 6 §L. The current site stabilizes within the existing architecture.

---

## 12. Status

**PLANNING ONLY.** Pause for Daniel's approval before any P0/P1 fix in §8 begins.

Suggested approval order:
1. Approve the P0 list (F1–F7) as the immediate trust-fix batch.
2. Decide F2 puck-line: Option A or Option B.
3. Decide F11 NHL goalie surfacing: required at launch or later.
4. Decide F16 ML overconfidence response: shrinkage / re-label / surface honestly.
5. Approve P1 list (F8–F12) for the second batch.
6. Approve P2 list (F13–F17) for the third batch.

The site is currently OPERATIONAL but not yet STABILIZED. This plan is the bridge to STABILIZED. World Cup proceeds after STABILIZED.

---

## Cross-references

- Phase 0 inventory: `docs/audit/00-inventory.md`
- Phase 1 critical path: `docs/audit/01-active-sports-critical-path.md`
- Phase 2 NBA deep dive: `docs/audit/02-nba-model-logic-calibration.md`
- Phase 3 MLB benchmark: `docs/audit/03-mlb-benchmark-audit.md`
- Phase 4 NHL automation + tracking: `docs/audit/04-nhl-automation-tracking-audit.md`
- Phase 5 future sports readiness: `docs/audit/05-future-sports-readiness.md`
- Phase 6 auditor/fixer/operator roadmap: `docs/audit/06-auditor-fixer-operator-roadmap.md`
- Public-tracking-vs-internal-audit rule: `~/.claude/.../memory/feedback_public_tracking_vs_internal_audit.md`
- Auditor / fixer design contract: `~/.claude/.../memory/project_auditor_fixer_design_contract.md`
