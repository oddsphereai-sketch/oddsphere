# Phase 2 — NBA Model Logic / Sharp Signal / Calibration Deep Dive

**Audit:** Daily Edge platform site/model-wide reliability audit
**Date:** 2026-06-10
**Phase:** 2 — NBA-specific model logic + truthfulness audit (read-only)
**Predecessors:** [Phase 0 inventory](./00-inventory.md), [Phase 1 critical path](./01-active-sports-critical-path.md)
**Standards:** evidence-backed only; no "should work"; cite `file_path:line_number` for every claim.

---

## TL;DR — NBA production status

| Surface | Status | Why |
|---|---|---|
| **NBA ML** | PARTIAL | Model output coherent post-sign-fix (`e53bba2`). Predicted score NOT persisted to DB. Calibration sample: 1 graded ML record. NOT VALIDATED. |
| **NBA Total** | PARTIAL | Model uses team ratings + pace + posterior blend. 1 graded Total record. NOT VALIDATED. |
| **NBA Spread** | **BLOCKED** | Rendered on card with grade labels but NOT persisted as `prediction_record`. Auditor blind. Tracking impossible. |
| **NBA sharp/public signal display** | **PARTIAL — HIGH UI honesty issue** | Splits fetched live, displayed on card, **NOT modeled** (zero model consumption), **NOT persisted to sharp_signals table** (writer doesn't exist). `data_quality_tier="high"` ignores `has_splits` — card overstates data confidence when splits are absent. |
| **NBA predicted score** | **BLOCKED** | Model produces predicted_home_score/away_score/total/spread_home, but these values are NEVER persisted to `prediction_records.snapshot_json`. They only exist in the live DTO. Tracking + auditor + calibration cannot reference them. |
| **NBA play grades** | PARTIAL | Logic is explainable from `gradeNbaMarket` (cite-able). But `data_quality_tier` overstates because `has_splits` not in tier calc. Rationale text honestly doesn't claim sharp/movement is used. |
| **NBA tracking/grading** | UNVERIFIABLE | Only 1 NBA game has completed with graded predictions (game 15047, 2026-06-08). Sample = 1 ML loss + 1 Total win. NOT VALIDATED. |
| **NBA auditor coverage** | **BLOCKED** | Auditor is MLB-only by default (`scripts/operator/audit-daily-edge-integrity.ts:63`). It accepts `--sport nba` but cannot detect NBA-specific gaps. |

**Overall NBA verdict: PARTIAL — BLOCKED for full TRUSTED status.** Tonight's NBA Finals Game 4 (Knicks @ Spurs, 8:30 PM ET) renders with internally-coherent picks (post-spread sign-fix), but four structural gaps prevent classification as TRUSTED.

---

## A. NBA model inputs — actually used vs merely available

### Full classification table

| Input | predicted_score | ml_prob | total | spread_grade | play_grade | rationale/UI | unused / unavailable | Evidence |
|---|---|---|---|---|---|---|---|---|
| `team.off_rating` | ✅ | ✅ | ✅ | ✅ (via posterior_spread) | ✅ (via confidence) | — | — | `lib/services/nba/featureSnapshot.ts:69` → `lib/automodel/nba/projectIndependent.ts:83-86,103-104` (`offH/offA` consumed in homePer100/awayPer100) → `lib/automodel/nba/blendPosterior.ts:60-98` → `lib/automodel/nba/nbaAutoModelV1.ts:169-178` |
| `team.def_rating` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | Same chain; `projectIndependent.ts:84-85` |
| `team.net_rating` | — | — | — | — | — | — | **AVAILABLE BUT UNUSED** | Stored in snapshot at `featureSnapshot.ts:71`. Never read by `projectIndependent`. (Off + Def are consumed instead, so this is redundant.) |
| `pace` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | `featureSnapshot.ts:72` → `projectIndependent.ts:87-88,98` (paceAvg used for possessionsPerGame) |
| Four Factors (`off_efg_pct`, `off_tov_pct`, `off_orb_pct`, `off_ft_rate`, etc.) | — | — | — | — | — | — | **AVAILABLE BUT UNUSED in V0** | `featureSnapshot.ts:356-375,436-460` packs Four Factors into snapshot. `nbaAutoModelV1.ts` makes no reference. `lib/automodel/nba/nbaFeatureWeights.ts` documents intended V1 usage; V0 (current) doesn't consume. |
| Current market moneyline (odds, implied prob) | — | — | — | — | — | ✅ (grade comparison) | — | `nbaMarketIntelligence.ts:289-314` (buildMl) consumes current odds for `noVigPick` + `classifyMlConflict`. Used for *grade* not *score projection*. |
| Current market spread line | — | — | — | ✅ | ✅ | ✅ | — | `nbaMarketIntelligence.ts:400-422` (buildSpread): `marketSpreadHome` passed into `classifySpreadConflict` for band derivation. |
| Current market total line | — | — | — | ✅ | ✅ | ✅ | — | `nbaMarketIntelligence.ts:528-541` (buildTotal): `marketTotal` passed to `classifyTotalConflict`. |
| Market implied probability (no-vig) | — | — | — | ✅ | ✅ | ✅ | — | `nbaMarketReview.ts:40-50` (`noVigPair`) used by `nbaMarketIntelligence.ts:295-313,402-403,530-531`. Used in grade band, NOT in score. |
| **Market movement** (opener vs current, or poll-to-poll deltas) | — | — | — | — | — | ✅ (static label only) | **NOT AVAILABLE** | See §B for full audit. Hardcoded label `movement_note="First observed tracking only — no opener available"` at `nbaMarketIntelligence.ts:179,383,511,615`. The `line_movement` block in `snapshot_json` stores **current_price only**, not deltas. |
| Opening line | — | — | — | — | — | — | **NOT AVAILABLE** | `nbaMarketIntelligence.ts:2-16` (file comment): "No fake openers. No fake RLM. No fake steam." |
| Current line (any market) | — | — | — | ✅ | ✅ | ✅ | — | `nbaMarketIntelligence.ts:400,406,476,528` (`pickLine`, `lineHomeFromMarket`, `consensus_line` consumed) |
| Public splits (`bets_pct`, `handle_pct`) | — | — | — | — | — | ✅ (display + divergence label) | — | `nbaMarketIntelligence.ts:328-342,448-462,558-572` — splits flow through `classifyDivergence` to produce a `sharp_signal_side` label. **The model itself never reads splits.** See §C for full audit. |
| Sharp signals (steam, RLM, signal_strength) | — | — | — | — | — | — | **NOT INGESTED FOR NBA** | No NBA writer exists. SharpAPI returns thin/no data for NBA tonight. See §C. |
| `line_history` depth/recency | — | — | — | — | — | ✅ (`first_observed_at` for UI) | — | `nbaMarketIntelligence.ts:177,224-231` |
| Source quality (book_count, limited_book_coverage) | — | — | — | ✅ (via tier) | ✅ (via tier cap) | ✅ | — | `nbaMarketIntelligence.ts:97-100,232-237` (book counting) → `nbaAutoModelV1.ts:77-86` (`deriveTier`) → `nbaMarketReview.ts:249` (tier in `gradeNbaMarket`) — affects confidence ceiling, not score |
| home/away | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | `featureSnapshot.ts:429-461` → `projectIndependent.ts:83-86` (offH/defH vs offA/defA, asymmetric) |
| Rest (days_off, back-to-back) | — | — | — | — | — | ✅ (surfaced) | **AVAILABLE BUT UNUSED in V0** | `featureSnapshot.ts:540-543` + `lib/automodel/nba/seriesContext.ts:124-131` (`daysRestHome/Away`). `nbaAutoModelV1.ts:243-252` documents: "v0 surfaces but does NOT adjust projection." |
| Injuries / player availability | — | — | — | — | ✅ (cap on tier/confidence) | ✅ (reason text) | — | `featureSnapshot.ts:464-493` (ESPN fetch) → `nbaAutoModelV1.ts:63-75,181-192` → `nbaMarketReview.ts:273-286` (`injuriesKnown` gates Best Angle eligibility). Affects confidence/tier only, never score. |
| Playoff/series context (game number, leading/trailing) | — | — | — | — | — | ✅ (audit trail) | **AVAILABLE BUT UNUSED for projection** | `featureSnapshot.ts:510-516` (`deriveSeriesContext`) → `nbaAutoModelV1.ts:243-252` ("v0 surfaces but does NOT adjust projection"). |
| Prior game results (last game outcome, momentum) | — | — | — | — | — | — | **UNVERIFIABLE / not modeled** | `featureSnapshot.ts:287-306` + `seriesContext.ts:76-103` only filter prior games to derive series state (3-0, 2-1, etc.). No momentum/last-game-outcome input enters the model. |

### Summary

- **Modeled (active):** off_rating, def_rating, pace, home/away
- **Available but unused:** net_rating (redundant), Four Factors (eFG/TOV/ORB/FT), rest, playoff/series context, prior game results
- **Display only:** public splits, sharp_signal_side, market lines (for grade comparison), line_movement (mislabeled), source quality affects only tier/confidence cap
- **Not available:** opening line, market movement deltas, NBA sharp_signals

---

## B. Market movement audit — VERDICT

**Market movement is NOT INGESTED by the NBA model.**

| Question | Answer | Evidence |
|---|---|---|
| Does line movement affect predicted score? | **NO** | `projectIndependent.ts:76-131` accepts only `snapshot.home_team`, `snapshot.away_team`, `isPlayoffs`. Zero market inputs. `marketPrior.ts:64-126` reads `snapshot.market` (current only). `blendPosterior.ts:60-98` blends independent + market_baseline where market_baseline is current line, not historical. |
| Does line movement affect ML probability? | **NO** | `classifyMlConflict` uses current odds only. `nbaMarketIntelligence.ts:289-313` computes `noVigPick` from current odds only. |
| Does line movement affect spread grade? | **NO** | `nbaMarketReview.ts:126-144` (`classifySpreadConflict`) consumes `modelSpreadHome, marketSpreadHome, pickSide` — `marketSpreadHome` is `pickLine.line_value` (current). |
| Does line movement affect total grade? | **NO** | `classifyTotalConflict` consumes current `marketTotal` only. |
| Does line movement affect confidence? | **NO** | `nbaAutoModelV1.ts:102-127` (`computeMarketConfidence`) inputs: posterior + current market + tier. No movement input. |
| Does line movement affect play_grade/verdict? | **NO** | `gradeNbaMarket` inputs are `pick, confidence, band, edge, dataQualityTier, injuriesKnown`. No movement parameter. |
| Does line movement affect rationale/copy text? | **No (only static label)** | `nbaMarketIntelligence.ts:179,383,511,615` hardcoded `movement_note="First observed tracking only — no opener available"`. Static label, not derived. |
| Does the DTO display a `line_movement` block? | **YES, but misleadingly named** | `nbaMarketIntelligence.ts:179` defines `movement_note`. `buildNbaPredictionRecords.ts:166-169` writes `snapshot_json.line_movement = { current_price_american, current_book }`. This is current state, NOT movement. |
| Is movement computed open-to-current / poll-to-poll / other? | **Not computed** | `nbaMarketIntelligence.ts:2-16`: "No fake openers. No fake RLM. No fake steam." |
| Is source quality considered for movement? | **N/A** | Movement not modeled. |
| Is movement frozen into snapshot_json on lock? | **N/A** | Only `current_price_american` + `current_book` are frozen. |

### Recommendation (HIGH for UI honesty)

`snapshot_json.line_movement` is mislabeled. Two options:
1. **Rename** to `snapshot_json.current_price` (small change, big clarity gain).
2. **Implement** real movement tracking (opener-to-current delta) using `line_history`; feed into grader.

---

## C. NBA sharp/public signals — VERDICT

### Final verdict: **NBA SHARP/PUBLIC SIGNALS ARE DISPLAY-ONLY**

- **NOT persisted to DB** (`sharp_signals` rows for NBA: **0** ever)
- **NOT consumed by the model** (`gradeNbaMarket` has no splits input)
- **Fetched live from SharpAPI at DTO render time** via `lib/services/nba/nbaSplitsClient.ts`
- **Rendered on the card** in the public_splits block
- **Used for a "sharp_signal_side" UI label** derived from splits divergence (display only)

### Evidence table

| Question | Answer | Evidence |
|---|---|---|
| Does NBA have a `sharp_signals` writer? | **NO** | Grep `lib/services/nba/**` for `from("sharp_signals").insert/upsert` returns zero hits. |
| Does NBA have a `sharp_signals_history` writer? | **NO** | Same — zero NBA writes. |
| What does `nbaSplitsClient.ts` do? | **Read-only fetch + parse** | Fetches SharpAPI `/splits?league=nba`, returns `NbaSplitsRow[]`. Zero DB writes. Output consumed by `buildNbaDailyEdgeAdapted.ts` and `nbaMarketIntelligence.ts` at render time only. |
| What does `nbaOpportunitiesClient.ts` do? | **Read-only fetch + parse** | Same pattern. Reads SharpAPI `/opportunities/ev?league=nba`. Zero DB writes. |
| Does NBA model logic read `sharp_signals` table? | **NO** | Grep `lib/automodel/nba/**` and `lib/services/nba/**` for `.from("sharp_signals")` returns zero hits. |
| Does NBA card/rationale read `sharp_signals` table? | **NO** | Card sources data from `buildNbaDailyEdgePipeline` (calls splits fetcher live), never from `sharp_signals` table. |
| Does NBA `snapshot_json` store sharp/splits state? | **YES — but as opaque state, not modeled** | `buildNbaPredictionRecords.ts:132-179` stores `public_splits` + `data_integrity.has_splits` flag. **The model never reads back from these fields. They're for UI replay only.** |
| Does NBA distinguish unavailable / missing / stale / thin / unmatched? | **Partially** | Booleans only: `has_splits`, `has_opportunities`, `market_present`, `limited_book_coverage`, `injuries_known_home/away`. No "splits_stale" or "thin coverage" reason code. Verified day-to-day variability: game 15047 (06-08) `has_splits=true`; game 15188 (tonight) `has_splits=false`. |
| If late-arriving NBA splits appear before lock, will they be captured? | **NO** | No cron polls NBA splits between morning refresh and lock. `pregame-sweep` does not call `nbaSplitsClient`. Snapshot freezes at DTO render time. |
| If they are captured, will `prediction_records` refresh? | **N/A** | They won't be captured. |
| If they are captured, will the model use them? | **N/A** | Model doesn't read splits regardless. |
| Can the current auditor detect provider splits that existed but were not ingested? | **NO** | `scripts/operator/audit-daily-edge-integrity.ts` Check B validates internal snapshot consistency, not provider completeness. |

### Live-visible HIGH UI honesty issue

Confirmed in pr.id=899 snapshot tonight: `data_quality_tier="high"` despite `has_splits=false`. Code reference: `lib/automodel/nba/nbaAutoModelV1.ts:77-86` (`deriveTier`):

```ts
if (!ratings_present) return "fallback";
if (homeKnown && awayKnown && market_present) return "high";
if ((homeKnown && awayKnown) || market_present) return "medium";
return "low";
```

`has_splits` is NOT a factor. A card with zero splits still gets "high" tier as long as ratings + market lines + injuries are present. The "high data quality" label on a card with no splits implies sharper analysis than the model actually delivers.

---

## D. NBA predicted score sanity — sample too small but structural gap surfaced

### Sample available

| Game | Date | Matchup (home @ away) | Locked at | ML pick | Total pick | ML grade | Total grade |
|---|---|---|---|---|---|---|---|
| 15049 | 2026-06-04 | SA home (NY visiting) — Game 1 | NO PREDICTION RECORDS | — | — | — | — |
| 15048 | 2026-06-06 | SA home — Game 2 | NO PREDICTION RECORDS | — | — | — | — |
| 15047 | 2026-06-08 | NY home — Game 3 | 2026-06-09T00:57:12Z | home (NY) -120 / `lean` / conf 56.5 / edge 0.035 | over 215.5 -115 / `market_aligned` / conf 50.6 / edge 0.001 | **LOSS** (final 111-115, NY lost) | **WIN** (total 226 > 215.5) |
| 15188 | 2026-06-10 (tonight) | NY home — Game 4 | not yet locked | home (NY) -125 / `lean` / conf 55.4 / edge 0.016 | over 216.5 -109 / `market_aligned` / conf 50.6 / edge 0.007 | pending | pending |

### Critical structural finding

**Predicted scores are NOT in `prediction_records.snapshot_json`** — verified by reading every NBA snapshot. Fields in snapshot: `as_of, sport, market, matchup, rationale, pick_label, line_movement, model_version, public_splits, data_integrity`. There is **NO `predicted_home_score`, `predicted_away_score`, `predicted_total`, or `predicted_spread_home`** in the persisted snapshot.

Implications:
- Game 3 (06-08) — model picked NY ML at -120. We do NOT know what predicted score the model produced. It is lost to history.
- Tonight Game 4 (06-10) — model picks NY ML at -125. The DTO probe earlier showed `projection.home_score=111.2, away_score=105.6, total=216.8, spread_home=+5.6`. **These will not be persisted at lock either.**
- Tracking + auditor + calibration cannot reconcile predicted vs actual score.

### Game 3 vs Game 4 (the small sample we have)

| Field | Game 3 (06-08) | Game 4 (06-10) | Delta |
|---|---|---|---|
| ML pick | NY home | NY home | same |
| ML odds | -120 (fliff) | -125 (fliff) | -5 cents |
| ML confidence | 56.5 | 55.4 | -1.1pp |
| ML edge | 3.5pp | 1.6pp | -1.9pp |
| ML play_grade | lean | lean | same |
| Total pick | over 215.5 | over 216.5 | line +1.0 |
| Total confidence | 50.6 | 50.6 | identical |
| Total edge | 0.1pp | 0.7pp | +0.6pp |
| `has_splits` | true | false | flipped |
| `data_quality_tier` | high | high | same despite splits flip |

**Static prediction risk:**
- Both ML picks are "NY home lean" with confidence ~55-57. Same call game-to-game.
- Total confidence **identical** (50.6) despite different lines (215.5 → 216.5) and different `has_splits` states.
- The model is **likely producing static predictions across games** when the matchup is the same, because the only inputs that change game-to-game in a Finals series are: home/away (flipped between games 1-2 and 3-4), market line, splits availability — and the model only consumes home/away + market line.
- This is **mathematically expected** for a V0 model that depends almost entirely on team ratings + pace + home/away.
- A V1+ model that consumed rest, series momentum, Four Factors, sharp signal direction would produce more varied projections.

### Recommendation (HIGH for tracking truthfulness)

**Persist `predicted_home_score`, `predicted_away_score`, `predicted_total`, `predicted_spread_home` into `prediction_records.snapshot_json`.** ~10-line change in `lib/services/nba/buildNbaPredictionRecords.ts:buildSnapshot`. Should ride in Phase 6 immediate roadmap.

---

## E. NBA play-grade explainability trace

### Grade label → logic (file:line)

Source: `lib/services/nba/nbaMarketReview.ts:gradeNbaMarket` (lines 221-299).

| Grade | Condition (line) | Confidence cap | Best Angle eligible? | Rationale text |
|---|---|---|---|---|
| `held` | `pick === null` (223-229) | 0 | no | "Model isn't picking a side here tonight." |
| `no_market` | `band === "market_unavailable"` (231-240) | min(raw, 55) | no | "Market data isn't available for this read yet — the model has a lean, but there's nothing to confirm against." |
| `caution` | `band === "strong_conflict"` (242-247) | min(raw, 55) | no | "Market is pushing the other way hard — this stays a cautious read, not a play." |
| `watch` | `tier ∈ {fallback, low}` (249-258) | min(raw, 52) | no | "Limited data on this market tonight — treat as informational, not a top play." |
| `watch` | `confidence < 55` (260-262) | raw | no | "Thin model edge — worth monitoring, not a top play." |
| `watch` | `band === "mild_conflict"` (264-266) | raw | no | "Market is hedging against the model lean — keeping this on the watchlist." |
| `best_angle` | `confidence ≥ 62 AND edge ≥ 0.04 AND injuriesKnown=true AND tier="high"` (270-277) | raw | YES | "Strong model read with market support — a clean edge worth playing." |
| `lean` | default (band neutral/support, conf ≥ 55, tier ≥ medium) (279-298) | raw | no | Dynamic reason — "Model lean with [market support/quiet market], but conviction isn't strong enough — held below Best Angle." |

### Data quality tier — the HIGH UI honesty issue

`lib/automodel/nba/nbaAutoModelV1.ts:77-86` (`deriveTier`):

```ts
if (!ratings_present) return "fallback";
if (homeKnown && awayKnown && market_present) return "high";
if ((homeKnown && awayKnown) || market_present) return "medium";
return "low";
```

**`has_splits` is NOT in this calculation.** Tonight's pr.id=899/900 are `tier="high"` with `has_splits=false`. The card surfaces "high data quality" while splits are absent.

### Spread grade — auditor blind spot

| Path | Persisted? |
|---|---|
| `nbaMarketIntelligence.ts:buildSpread` returns `MarketIntelligence` with `grade` field | computed at render time |
| DTO includes `intel.spread.grade` for rendering | NOT in `prediction_records` |
| `buildNbaPredictionRecords.ts:261` iterates `["moneyline", "total"]` ONLY | **spread is excluded by design** |

NBA cards render a spread label (e.g. tonight's "NY -2 lean" after the sign-fix), but there's no `prediction_record.market="spread"` row. Auditor + tracking cannot validate this label.

### Rationale text — verified honest

`gradeNbaMarket` rationale strings (lines 232-298) **do NOT claim** sharp/public signals or market movement influenced the grade. They use "the market" generically (correct, since current line IS used) and "model lean / Best Angle" (also correct).

Positive finding: the UI rationale isn't claiming inputs the model doesn't use.

### Confidence/effectiveConfidence

Persisted at `buildNbaPredictionRecords.ts:323` as `confidence: intel.effective_confidence`. Caps applied per band/tier are documented in the table above. Card never claims more confidence than the framework allows.

---

## F. Persisted prediction vs displayed card

### Field map for tonight's NBA card

| DTO field | Persisted? | Where |
|---|---|---|
| ML pick (side/odds) | ✅ | `prediction_records` ML row |
| ML confidence | ✅ | `prediction_records.confidence` |
| ML edge | ✅ | `prediction_records.edge` |
| ML play_grade | ✅ | `prediction_records.play_grade` |
| Total pick (line/odds) | ✅ | `prediction_records` Total row |
| Total confidence | ✅ | `prediction_records.confidence` |
| Total play_grade | ✅ | `prediction_records.play_grade` |
| **Spread pick (line/odds)** | ❌ | **DTO-only** — `nbaMarketIntelligence.ts:387-512` (`buildSpread`) — no prediction_record exists |
| **Spread grade label** | ❌ | **DTO-only** — auditor blind |
| **Predicted home score** | ❌ | **DTO-only** — `projection.home_score` field, never written to snapshot |
| **Predicted away score** | ❌ | **DTO-only** |
| **Predicted total** | ❌ | **DTO-only** |
| **Predicted spread home** | ❌ | **DTO-only** |
| `public_splits` (if any) | ⚠ partially | Persisted in `snapshot_json.public_splits` BUT only used for UI render, not for any verification |
| `line_movement` block | ⚠ misnamed | Persisted but only as `current_price_american + current_book` (not movement) |
| `data_integrity` (has_lines / has_splits / etc.) | ✅ | `snapshot_json.data_integrity` |
| `data_quality_tier` | ✅ | `snapshot_json.data_integrity.data_quality_tier` — see UI honesty issue |
| Pick rationale text | ✅ | `snapshot_json.rationale` |
| series context (game number, leading/trailing) | display only | rendered live; not persisted |

### Critical gaps

1. **Predicted scores not persisted** — cannot reconcile predicted vs actual after game ends.
2. **Spread market not persisted** — cannot track or grade or audit spread recommendations.
3. **Line movement field is misnamed** — stores current price, not movement.

---

## G. Calibration / accuracy — NOT VALIDATED

### Sample size

| Metric | Count |
|---|---|
| Total NBA `prediction_records` | **4** (2 from game 15047 on 06-08, 2 from game 15188 tonight) |
| Locked NBA `prediction_records` | 2 (game 15047 — locked 2026-06-09T00:57Z) |
| Graded NBA records | 2 (game 15047) |
| ML graded | 1 (pr.id=528 — LOSS) |
| Total graded | 1 (pr.id=529 — WIN) |
| Spread graded | 0 (never persisted) |
| Unique completed games | 1 (game 15047) |
| Date range | 2026-06-08 → 2026-06-10 (3 days) |

### Verdict

**NBA calibration is NOT VALIDATED. Sample size is statistically meaningless.**

Required minimum for any meaningful calibration estimate:
- ~20+ graded ML records to estimate basic accuracy
- ~30+ to bucket by confidence band
- ~50+ to test against an honest baseline

NBA currently has 1 graded ML record. Cannot calibrate.

### What's needed before calibration is possible

- A full NBA regular season (~82 games × multiple teams worth of model coverage). The current 4-team Finals series is too narrow.
- Persisting predicted scores so we can measure predicted-vs-actual residuals.
- Persisting NBA spread as a prediction_record so spread-cover accuracy can be measured.

**Classification: NBA model is NOT FULLY VALIDATED. Cannot recommend customer-facing trust until calibration sample exists.**

---

## H. Production status verdict — per market

| Surface | Status | HIGH/WARN/INFO | User-facing risk | Recommendation | Auto-fixable? | Operator approval? |
|---|---|---|---|---|---|---|
| **NBA ML** | PARTIAL | INFO: post-sign-fix model is coherent. HIGH: predicted score not persisted. WARN: calibration sample = 1 graded. | Pick may be correct or wrong; model variation unmeasurable. | Persist `predicted_*` fields in snapshot. Wait for ~20 graded ML records before claiming trust. | Yes (small code change) | Yes |
| **NBA Total** | PARTIAL | HIGH: predicted_total not persisted. WARN: 1 graded Total record. | Pick coherence is reasonable; calibration is unknown. | Same persistence fix; same calibration wait. | Yes | Yes |
| **NBA Spread** | **BLOCKED** | HIGH: rendered with grade label but NOT persisted. HIGH: auditor blind. | Card displays a grade that has no audit trail. | Either persist spread as a `prediction_record` (preferred — gives tracking + auditor coverage) OR mark card explicitly "derived, not tracked." | Yes (medium code change) | Yes |
| **NBA sharp/public signal display** | **PARTIAL — HIGH UI honesty** | HIGH: `data_quality_tier="high"` while `has_splits=false`. HIGH: `line_movement` block stores current price, not movement. HIGH: no sharp_signals writer for NBA. | Card overstates data quality. UI implies sharp signals are used; model doesn't use them. | Three fixes: (1) downgrade tier when `has_splits=false` OR add `has_splits` to tier calc; (2) rename `line_movement` to `current_price`; (3) build minimal NBA sharp_signals writer for no-skip guarantee. | Yes (small-to-medium) | Yes |
| **NBA predicted score** | **BLOCKED** | HIGH: not persisted. Tracking impossible. Calibration impossible. | Members see a "model projection" on the card with no audit trail. | Persist `predicted_home_score`, `predicted_away_score`, `predicted_total`, `predicted_spread_home` to `snapshot_json`. | Yes (small) | Yes |
| **NBA play grades** | PARTIAL | INFO: logic explainable. HIGH: tier ignores splits. | Tier overstates confidence in absence of splits. | Already covered by sharp/public signal display fix. | Yes | Yes |
| **NBA tracking/grading** | UNVERIFIABLE | INFO: shared grader handles canonical pick tokens (verified for NBA's `pick="home"/"over"`). | Only 1 graded NBA game in DB. Cannot verify pipeline at scale. | Live-test through tonight's Game 4 + future games. No code change needed. | n/a | n/a |
| **NBA auditor coverage** | **BLOCKED** | HIGH: auditor is MLB-only by default. Cannot detect NBA-specific gaps. | Future NBA bugs may not be caught before users see them. | Phase 6 deliverable: cross-sport auditor v2. | No (multi-session build) | Yes |

---

## What this phase does NOT do

- Does NOT propose specific patch code — Phase 6 roadmap synthesizes fixes.
- Does NOT calibrate (sample too small).
- Does NOT investigate whether NBA model V2 (shadow) would be improved by Four Factors / rest / series context. That's a Phase 6+ shadow study.
- Does NOT audit MLB benchmark — Phase 3.

---

## Active production HIGH issues affecting tonight's slate

| # | Issue | Live impact tonight |
|---|---|---|
| 1 | `data_quality_tier="high"` despite `has_splits=false` on tonight's NBA pr.id=899/900 | Card overstates data confidence. Doesn't change picks (post-spread-fix), but misleads users. **Recommend fix before next NBA slate.** Not an emergency for tonight. |
| 2 | NBA spread rendered with grade label but not persisted | Tonight's NY -2 lean shows correctly post-sign-fix; lack of persistence is a tracking/audit gap, not a tonight-rendering issue. |
| 3 | NBA predicted scores not persisted to snapshot | Card shows `projection: home=111.2 away=105.6 total=216.8 spread_home=+5.6` (verified earlier today). Once locked, this is lost. **Fix should ship before next NBA slate that we expect to grade.** |

**None require emergency intervention tonight.** All three are HIGH for the next round of fixes (Phase 6 roadmap immediate).

---

## Next: Phase 3

`docs/audit/03-mlb-benchmark-audit.md` — full audit of MLB as the mature reference. Should document what TRUSTED looks like across all 19 layers; measure MLB calibration where sample size permits (V2.2 has been live for months — likely calibrable); and define the contract NBA + NHL must meet.

---

## Appendix — references

- Phase 0 inventory: `docs/audit/00-inventory.md` (commit `8473910`)
- Phase 1 critical path: `docs/audit/01-active-sports-critical-path.md` (commit `9ced451`)
- Today's NBA fixes: `c87b20d` (stale-skip + lines parser), `e53bba2` (spread sign convention), `c831489` (NHL cron)
- NBA sharp coverage memo: `memory/project_sharpapi_nba_coverage_gap.md`
- NBA model audit memo (from 2026-06-10): `memory/project_nba_model_audit_2026_06_10.md`

---

## Clarification appended 2026-06-10 (post-commit)

This phase report uses language like *"persist NBA spread as a `prediction_record`"* and *"Either persist spread as a `prediction_record` (preferred — gives tracking + auditor coverage) OR mark card explicitly 'derived, not tracked.'"* (see §I.5 "active HIGH issues" and §J.1 verdict table).

**Per Daniel's clarification 2026-06-10** (codified at `memory/feedback_public_tracking_vs_internal_audit.md` and Phase 4 §A.4), that framing conflates two independent concepts:

1. **Public tracking** — intentional scope, only markets we have historically + deliberately launched. Today: MLB ML+Total+FI, NBA ML+Total, NHL ML+Total. Adding a `prediction_records.market="spread"` row implicitly extends public tracking — which we have NOT historically tracked for NBA — and would pollute the accuracy history.
2. **Internal audit / lock provenance** — universal. Every displayed model output must be captured at lock for auditor verification.

**Corrected framing for the NBA-spread recommendation in this phase:**

The current state (`cba9ea5`: spread hidden from `marketKeysFor("nba")`) is **CONSERVATIVE-COMPATIBLE** with the rule. Hiding = no display = no internal capture needed = no public tracking risk. Valid Option B.

If we ever want to display spread again as model context (Option A), the requirement is:
- Internal lock-time capture in a `displayed_market_snapshot` or `snapshot_json.displayed_context_markets.spread` substrate that does NOT join into public tracking.
- UI label clearly marking it as "Model context · Not part of official tracking", visually distinct from ML/Total.
- This does NOT mean a `prediction_records.market="spread"` row.

Adding spread to PUBLIC tracking (Option C) is a separate, intentional product launch decision — sample-size baseline, calibration disclosure, deliberate copy. Not an engineering default and not what the original Phase 2 language was asking for.

**The Phase 2 audit findings themselves stand** — the gaps identified (no persistence, no audit trail, no calibration substrate, misleading data_quality_tier) are real. Only the proposed remedy needs re-framing per the public-tracking-vs-internal-audit rule.

See also: Phase 3 §N "framing note", Phase 4 §A.4 full rule statement, `project_phase_6_immediate_roadmap.md` "Universal platform rules".
