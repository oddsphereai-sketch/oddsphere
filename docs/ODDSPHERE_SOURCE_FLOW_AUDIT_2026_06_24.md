# OddSphere Whole-Site Source-Flow Audit (Operating Map)

Status: read-only audit — NO code changes proposed inside this document
Date: 2026-06-24
Author: Claude
Scope: MLB, WNBA, World Cup/soccer across 6 lanes: displayed odds/lines, line movement, public splits, sharp signals, model inputs/predictions, grades/ROI tracking.

This is the operating map for finishing the site cleanly. It separates **MODEL/GRADE/TRACKING** lanes (changing these changes picks/ROI) from **DISPLAY-ONLY** lanes (safe to change without touching outcomes), and lists fixes in priority order by blast radius.

## Hard source policy (restated)
- SharpAPI / odds tables own odds, current lines, `line_history`, movement, and +EV/sharp-style signals where available.
- Playbook owns **public splits + context only**; never used as +EV, CLV, steam, RLM, Pinnacle/fair-probability, or sportsbook-specific movement.
- World Cup/soccer stays on its existing provider path (BDL-FIFA + SharpAPI); no Playbook unless coverage is proven.
- Same-source movement only; first-observed must never be labeled "opener."

---

## 1. The single most important finding: public-splits consumption differs by sport

| Sport | Public-splits source | Feeds grades/model/tracking? |
| --- | --- | --- |
| **MLB** | SharpAPI `/splits` → `sharp_signals.public_*` | **YES** — public_smoke, sharp-divergence, opposing-money demotion, model alignment |
| **WNBA** | **Playbook** → `sharp_signals.public_*` | **NO — strictly display-only** (verified: model never reads `sharp_signals`) |
| **Soccer/WC** | SharpAPI `/splits` = `empty_as_of_probe` | N/A (no rows; card shows "unavailable") |

**Implication:** WNBA (Playbook) is correctly isolated. MLB public splits are deeply wired into the grade/tracking path — which is fine *today* (SharpAPI-sourced, pre-existing), but it is the exact surface the `o-playbook-model-impact-audit` and `o-market-signal-correctness-audit` gates must clear **before** Playbook ever becomes MLB's splits source. Do not swap MLB's splits provider without that gate.

---

## 2. MLB source-flow

| Lane | Source → store | File:function | Tag |
| --- | --- | --- | --- |
| Displayed odds/lines | SharpAPI `/odds` → `lines` | `SharpAPIOddsProvider.getGameLinesV2`; daily-edge route `LineRow` | DISPLAY |
| Line movement | `line_history` MIN(recorded_at) vs current `lines`, **same sportsbook** | daily-edge route `LineHistoryRow` | DISPLAY (no mixing) |
| Public splits | SharpAPI `/splits` → `sharp_signals.public_betting_pct/public_money_pct` | `SharpAPISignalProvider.getSharpSignals` (+ splits-only second pass) | **MODEL/GRADE/TRACKING** |
| Sharp signals | `/opportunities/ev` → fair-prob/+EV/ev_pct (REAL); steam/RLM **hardcoded false/null** | `SharpAPISignalProvider` | GRADE (real EV); steam/RLM inert |
| Model inputs | `sharp_signals` public_* read for **alignment detection only**, not direct edge | `featureSnapshot.buildFeatureSnapshots` → `mlbAutoModelV2*.extractMarketReadSummary` | MODEL (alignment) |
| Grades/tracking | public splits → grade flips; opposing-money demotes locked best_angle→lean | `marketSignalDerivationService.deriveMarketSignal`, `signalEvidenceClassifier`, `gradeDerivationService`, `predictionRecordService.hasOpposingPublicMoneyConflict` | **GRADE/TRACKING** |

**Public-splits consumers (the list that matters):**
- `deriveMarketSignal` → emits `public_smoke` (tickets ≥ threshold + flat money gap).
- `signalEvidenceClassifier.classifySharpDivergenceTier` → moderate/strong/very_strong from `|money% − bets%|`.
- `signalEvidenceClassifier.classifyRlm` → reads `public_betting_pct` for an **RLM tier** (⚠ see Risk R1 — direction is null so it never fires, but it is semantically an RLM mislabel).
- `gradeDerivationService` (`meetsPublicSmokeBar`, divergence bars) → grade/verdict.
- `predictionRecordService.hasOpposingPublicMoneyConflict` → **post-lock** best_angle→lean demotion.
- `featureSnapshot` → model alignment summary (not direct edge math).

**Mixing risk:** none on movement (same-book open→current). Public-split gaps are same-row/same-source. Date guard prevents cross-slate contamination.

---

## 3. WNBA source-flow (post-merge `c0c16aa`)

| Lane | Source → store | File:function | Tag |
| --- | --- | --- | --- |
| Displayed odds/lines | SharpAPI `/odds?league=wnba` → `lines` | `refreshWnbaLines.fetchSharpWnbaOdds`; `buildWnbaDailyEdgeAdapted` (consensus picker) | DISPLAY |
| Line movement | `line_history` (`is_opener:false` always) → first-observed vs current price trail | `refreshWnbaLines`; `buildWnbaDailyEdgeAdapted` priceTrail | DISPLAY (⚠ R2 label) |
| Public splits | **Playbook** `/splits?league=wnba` → `sharp_signals.public_*` (pregame, ML+total) | `refreshWnbaPlaybookSplits` → `buildWnbaPublicSplits` | **DISPLAY-ONLY ✓** |
| Sharp signals | consensus median de-vig → `sharp_signals.pinnacle_fair_probability` (⚠ R3 name); steam/RLM false | `refreshWnbaLines` | DISPLAY |
| Model inputs | Elo+Platt + SharpAPI market odds blend; **reads neither `sharp_signals` nor public_*** | `buildWnbaDailyEdgePreview.computeWnbaPrediction`; `runWnbaModel` reads only `lines` | MODEL |
| Grades/tracking | grades derived in-model; `buildWnbaPredictionRecords` **defined but NOT called** | `buildWnbaDailyEdgePreview.gradeMarket`; cron has no records call | GRADE display; **TRACKING NOT LIVE** |

**Verified isolation:** `runWnbaModel` / `buildWnbaDailyEdgePreview` never read `sharp_signals` or `public_*`. The Playbook lane cannot influence model/grade/tracking. ✓ (matches policy.)

**Gaps:** WNBA is not in ROI tracking yet (`buildWnbaPredictionRecords` unwired); WNBA movement has no true opener baseline.

---

## 4. World Cup / soccer source-flow

| Lane | Source → store | File:function | Tag |
| --- | --- | --- | --- |
| Slate/games | BDL-FIFA `/matches` → `games`/`teams` (ET-anchored) | `seedSoccerGamesService.seedSoccerGames` | MODEL |
| Displayed odds/lines | BDL `/odds` + SharpAPI `/odds` merged (SharpAPI wins ties) → `lines` | `SharpApiSoccerOddsProvider.normalizeOdds`; `writeSoccerLines.mergeProviderRows`; `_soccerMarketNormalizer` (whitelist: match_result/double_chance/total/btts) | DISPLAY + MODEL |
| Line movement | opener from `line_history` earliest vs current de-vig, **same market/side/line/book** | `writeSoccerPredictionRecords` (opener load) → `soccerAutoModelV1` (`market_moving_against_pick`) → `soccerConfidenceGrade` haircut | **MODEL → GRADE** |
| Public splits | SharpAPI `/splits?league=fifa_world_cup_matches` = **empty_as_of_probe**; **Playbook NOT wired (0 hits)** | `SharpApiSoccerOddsProvider.probeSplits` | DISPLAY (unavailable) |
| Sharp signals | `normalizeOpportunities` exists but **dead code** (never called); pre-calibration gate | `SharpApiSoccerOddsProvider` | none (deferred) |
| Model/predictions | Dixon-Coles Poisson + Elo prior + line movement → `prediction_records` (4 markets) | `soccerAutoModelV1.runSoccerAutoModelV1`; `writeSoccerPredictionRecords` | MODEL/TRACKING |
| Grades/tracking | pre-game grade in snapshot; post-score grading active | `soccerConfidenceGrade.deriveSoccerGrade`; `soccerGrading` + `trackingRefreshService.gradePredictionsForSlate` | **TRACKING LIVE** |

**Confirmed:** zero Playbook references in any soccer file. Soccer stays on BDL-FIFA + SharpAPI. Pre-calibration whitelist publishes only `total` + `btts`.

**Gaps:** EV/Kelly is dead code (could be mistaken for active +EV); movement audit trail lives only in `snapshot_json` (no standalone movement table).

---

## 5. Cross-sport consistency matrix

| Dimension | MLB | WNBA | Soccer/WC | Consistent? |
| --- | --- | --- | --- | --- |
| Odds/lines provider | SharpAPI | SharpAPI | BDL+SharpAPI | ✓ (SharpAPI owns odds) |
| Movement basis | same-book opener | first-observed (no true opener) | same-key opener | ⚠ label/basis differs |
| Public splits source | SharpAPI | **Playbook** | none | mixed by design |
| Public splits → grades | **YES** | no (display-only) | n/a | ⚠ asymmetric (intentional now) |
| Sharp/EV real | yes (Pinnacle EV) | no (consensus only, misnamed) | no (deferred) | ⚠ naming |
| Tracking/ROI live | yes | **no (deferred)** | yes | ⚠ WNBA gap |

---

## 6. Risks (ranked)

- **R1 (correctness, MLB):** `classifyRlm` derives an "RLM tier" from `public_betting_pct`. RLM requires same-source line movement *against* the public side — not public % alone. Inert today (`rlm_direction` null → never fires), but it is a latent mislabel that violates the RLM policy. Belongs to `o-market-signal-correctness-audit`.
- **R2 (display label, WNBA):** movement is **first-observed vs current** (`is_opener:false` always), not a true opener. Must be surfaced as "first observed," never "opener" (canonical policy). Verify the WNBA card copy.
- **R3 (naming, WNBA):** column `pinnacle_fair_probability` stores a **consensus median de-vig**, not Pinnacle. Storage name + any UI derived from it must not imply Pinnacle/fair-probability.
- **R4 (tracking gap, WNBA):** no ROI tracking yet (`buildWnbaPredictionRecords` unwired). Picks shown but not graded/tracked.
- **R5 (dead code, soccer):** EV/Kelly `normalizeOpportunities` present but unused — remove or clearly quarantine so it can't be mistaken for an active +EV lane.
- **R6 (future, MLB):** public splits are wired into grades/tracking. If Playbook becomes MLB's splits source, the model-impact + correctness gates MUST clear first (no blind swap).

---

## 7. Prioritized safe fixes (by blast radius)

### A. Read-only / audit (no product change)
1. `o-market-signal-correctness-audit` — settle R1 (RLM-from-public%), confirm public_smoke/divergence semantics match the policy, document the exact public-split→grade rules.
2. Confirm WNBA card movement copy (R2) and any "Pinnacle" wording (R3) — pure inspection.
3. Confirm WNBA is not yet in the public tracker read path (expected — R4).

### B. Display fixes (UI/label only; no model/grade/tracking change)
4. WNBA movement label → "first observed" (not "opener") if mislabeled (R2).
5. Relabel consensus-vs-Pinnacle wording wherever the WNBA/MLB card implies Pinnacle from a consensus de-vig (R3).
6. (Step B already queued) WNBA Playbook splits: add `booksUsed` + explicit "Playbook" source label + freshness clarity.

### C. Model-impacting (require model-impact audit + tests before merge)
7. Decide whether MLB's `classifyRlm`/public_smoke use of public % is correct or should be narrowed (R1) — changes grades.
8. Any move to bring WNBA public splits into grades — gated by `o-playbook-model-impact-audit` (WNBA branch). Default: stay display-only.
9. Soccer EV/Kelly on-ramp when `/splits`/opportunities populate — new calibration cycle (R5).

### D. Tracking / ROI-impacting (separate, explicit ticket)
10. WNBA tracking activation: wire `buildWnbaPredictionRecords` into the cron + grading + tracker (R4). This is the path to WNBA ROI — model/tracking-impacting, needs its own gate.
11. Review MLB opposing-money post-lock demotion (`hasOpposingPublicMoneyConflict`) for correctness/consistency once R1 is settled.

---

## 8. Ratified decisions (Daniel + Codex, 2026-06-24)
- **D1 (R1) — RLM definition.** Public-% alone is NOT RLM. RLM requires real **same-source line movement against the public side**. Public splits may support **public-smoke / sharp-divergence** signals, but must never produce an RLM signal by themselves. → `o-market-signal-correctness-audit` owns the code change to `classifyRlm` (model/grade-impacting; gated).
- **D2 (R4) — WNBA ROI tracking is IN SCOPE for this push**, as its own ticket, sequenced **after** the current WNBA display/line/splits work is stable. Goal: WNBA picks tracked + graded, not just shown. → new ticket `o-wnba-tracking-activation`.
- **D3 — Movement standard (all sports): movement must be same-source.** If a true opener is not proven, label it **"first seen" / "first observed," never "Open"/"opener."** → display fix landing via Codex branch `codex/display-source-label-honesty` (Open→First seen; Pinnacle EV→Market EV / fair price). Reviewed 2026-06-24: 4 UI files only, zero model/grade/tracking/provider/cron, tsc clean, line-tracker test + cross-sport route smoke pass; basis unchanged (label-only). Remaining gate: sport-switching browser smoke before merge.

No hot files were edited by this audit. Code changes implementing D1/D2 proceed only under their named tickets; D3 lands via the display-only branch above.

---

## 9. D1 read-only impact — RLM (ticket `o-market-signal-correctness-audit`)

**Question:** does public-% produce fake RLM today, and what is the before/after of removing it?

**Exact consumers of RLM / `public_betting_pct`:**
- `marketSignalDerivationService.deriveMarketSignal` (branch 2, lines 138–145): emits an RLM market_signal ONLY when `signal.has_reverse_line_movement && rlm_direction !== null`. `public_betting_pct` is NOT in this trigger.
- `signalEvidenceClassifier.classifyRlm` (lines 176–192): **returns null unless `has_rlm && rlm_direction !== null`**. `public_betting_pct` is used ONLY as the tier magnitude *after* that gate (≥70 very_strong / ≥STRONG / ≥MODERATE).
- `gradeDerivationService` RLM bars (best_signal, sharp_confirmed, sharp_conflict, caution; lines 292–294, 339–341, 505, 538–540, 571, 634–665): all gated on `evidence.rlm !== null`.
- `predictionRecordService.buildLineMovementSnapshot` (line 658): `has_reverse_line_movement` is a **pass-through** of `sharp_signals.has_reverse_line_movement` — it does NOT derive RLM from public-%. (It separately computes REAL same-source movement `direction`/`magnitude_pp` from `line_history` openers vs current, which is currently a snapshot field, not wired to an RLM signal.)

**Producer:** `SharpAPISignalProvider` hardcodes `has_reverse_line_movement: false` / `rlm_direction: null` (tier doesn't expose RLM). No code path sets these from public-%.

**Empirical before/after — MLB 2026-06-24** (92 signals / 16 games):
- `has_reverse_line_movement=true`: **0**; `rlm_direction` not null: **0** → `classifyRlm` = null for all rows; `deriveMarketSignal` RLM branch never taken.
- Therefore: **market_signal Δ = 0, grade Δ = 0, Best Angle Δ = 0, tracking Δ = 0** from removing/narrowing the public-% RLM tier. Structural, not slate-specific (the trigger flag is hardcoded false everywhere).
- Public splits remain active only in legitimate lanes: 90/92 rows carry public %, 4 public_smoke-eligible, 6 real +EV — **unaffected** by a RLM-only change.

**Conclusion:** there is **no fake RLM firing today** — RLM is already gated on a real movement flag, and public-% is only a gated tier magnitude. The D1 hardening is therefore **provably zero-impact** and should be a minimal, safe change:
1. Decouple `public_betting_pct` from `classifyRlm`'s tier so RLM strength derives from real movement magnitude (not public-%), preserving the gate. (Zero current impact.)
2. Add a regression test asserting "public-% alone never yields RLM" (lock the contract).
3. Keep `has_reverse_line_movement` settable ONLY from real same-source movement; document the contract. Wiring *real* RLM from `buildLineMovementSnapshot.direction === "against_pick"` + public-on-pick is a separate FEATURE, not part of D1.

This is a safe, gated edit (no slate change). It still requires the model-impact replay as a guard before merge per policy, but the expected delta is zero.
