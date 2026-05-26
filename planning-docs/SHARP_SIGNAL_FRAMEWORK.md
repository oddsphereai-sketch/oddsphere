# Sharp Signal Framework

**OddSphere AI Lab — Daily Edge Product**
**Version:** 1.1
**Status:** Locked, source-of-truth
**Last updated:** May 26, 2026

---

## Purpose

This document defines how OddSphere evaluates sharp market signals and assigns grades to model picks. It is the **single source of truth** for the product's sharp-signal classification logic.

All code (services, evaluators, derivation pipelines) must conform to this framework. When framework and code conflict, the **framework is correct** and the code must be updated.

This document covers:
- The five sharp-signal input types and what each means
- How signals are evaluated per pick (not per game)
- The 7-grade output vocabulary and the rules for assigning each grade
- Specific thresholds for "weak / moderate / strong / very strong"
- Edge case handling and conservative-by-default philosophy
- Field mapping to the upstream sharp-signal API
- Member-facing explanation copy

---

## Core Philosophy

### Conservative by default

OddSphere classifies sharp signals **conservatively**. We would rather under-label than over-label. A `Best Signal` grade should be rare and earned. A `Sharp Conflict` should require genuine opposing sharp action, not just a hint of disagreement.

When in doubt, default to `Market Watch` (movement exists but signal is unclear) or `Model Only` (model has an edge but the market hasn't spoken). These are honest non-commitments. Over-committing on weak signals destroys member trust.

### Per-pick evaluation, never per-game

A baseball game has three independent predictions:
1. **Moneyline** (which team wins)
2. **Total** (combined runs over/under)
3. **1st Inning Total** (NRFI / YRFI)

Each prediction has its own sharp signal evaluation. **A sharp signal on Moneyline does not automatically apply to Total or 1st Inning.** The market views these as separate questions, and so does OddSphere.

Implementation: per-pick grades live on dedicated columns (`ml_grade`, `ou_grade`, `nrfi_grade` etc., per V13 schema). The card-level "headline" grade is derived by ranking the per-pick grades, not by collapsing them into a single read.

### Pinnacle is sharp, but not omniscient

Pinnacle's de-vig fair value is the strongest single sharp signal in the data, because Pinnacle is the smartest book in the world. But Pinnacle alone is **not enough** to confirm full sharp conviction. Markets are noisy. Pinnacle can be slightly off. Other indicators must corroborate before we treat a read as fully confirmed or fully conflicting.

Specifically: **opposing Pinnacle EV alone does not trigger `Sharp Conflict`**. It triggers `Market Watch` with a caution lean. Escalation to `Sharp Conflict` requires confirming sharp action (steam, RLM, or meaningful sharp-money divergence) on top of Pinnacle's EV.

---

## The Five Sharp-Signal Inputs

OddSphere evaluates each per-pick model output against **five categories** of sharp market signals. Every grade output is the result of combining these inputs.

### Signal 1 — Pinnacle / No-Vig Expected Value (EV)

**What it is.** Pinnacle's de-vig fair-value line, compared to the lines available at other books or the implied probability of the model's pick.

**What it tells us.** Pinnacle prices closer to true probability than retail books because they tolerate sharp action. When a retail book offers a better price than Pinnacle's fair value, the bet has positive EV.

**Field source (SharpAPI):** `is_plus_ev`, `ev_pct`, `pinnacle_fair_probability`

**Strength tiers:**

| Tier | EV % | Interpretation |
|---|---|---|
| Weak | < 1.5% | Ignore (within market noise) |
| Moderate | 1.5% – 2.99% | Watch-worthy, not actionable alone |
| Strong | 3.0% – 4.99% | Meaningful, contributes to grade |
| Very strong | 5.0%+ | Significant, can drive grade |

**Alignment with model pick.**
- EV aligned with the model's pick → market confirms the pick
- EV opposing the model's pick → market resists the pick (Pinnacle thinks the OTHER side is the value)

**Important: EV alone is not sufficient to fire `Best Signal` OR `Sharp Conflict`.** It must be paired with at least one other confirming signal for full conviction.

---

### Signal 2 — Steam Movement

**What it is.** Coordinated line movement across multiple sportsbooks within a tight time window. When sharps bet heavily on a side, books defensively move their lines simultaneously to avoid being picked off.

**What it tells us.** Multi-book steam is the highest-conviction sharp signal in the market. It is hard to manufacture and expensive to trigger.

**Field source (SharpAPI):** `has_steam_move`, `steam_books_count`, steam detection timestamps

**Strength tiers:**

| Tier | Books Moving | Interpretation |
|---|---|---|
| Weak / ignore | < 2 books | Not steam, just normal line drift |
| Moderate / watch | 2 books | Possible steam, weak signal |
| Strong | 3 – 4 books | Confirmed steam, meaningful |
| Very strong | 5+ books | High-conviction sharp action |

**Time window:**
- 10-minute window is the standard for "simultaneous"
- 5-minute window indicates **stronger** steam (more coordinated)
- Beyond 30 minutes, treat as normal line drift, not steam

**Alignment with model pick.**
- Steam toward the model's pick → strong market confirmation
- Steam against the model's pick → market resistance, potential `Sharp Conflict`

---

### Signal 3 — Reverse Line Movement (RLM)

**What it is.** The line moves OPPOSITE to where the public is betting. Normally, lines drift toward the public side (books shading to balance action). RLM is when the line moves AWAY from the heavy ticket side.

**What it tells us.** Sharp money is so heavy on the opposing side that books move the line counter-intuitively to attract more public on the heavily-bet side. Pure sharp indicator.

**Field source (SharpAPI):** `has_reverse_line_movement`, `rlm_direction`, plus `public_betting_pct` for context

**Detection criteria:**
- Public tickets ≥ 60% on one side
- Line moves OPPOSITE that side
- Stronger when public ≥ 65% AND sharp money confirms the line-movement direction

**Strength tiers:**

| Tier | Conditions | Interpretation |
|---|---|---|
| Weak | Public 60-64%, modest line move opposite | Possible RLM, watch |
| Strong | Public 65%+, clear line move opposite, sharp money confirms | Confirmed RLM |
| Very strong | Public 70%+, dramatic line move, large sharp money divergence | High-conviction RLM |

**Alignment with model pick.**
- RLM direction matches model's pick → market confirms the pick
- RLM direction opposes model's pick → market resists the pick (sharps fading our read)

---

### Signal 4 — Sharp Money vs Public Ticket Divergence

**What it is.** The percentage gap between **money %** (dollar volume) and **ticket %** (number of bets) on a given side.

**What it tells us.** Public bets small ticket sizes; sharps bet large. When money % significantly diverges from ticket %, big money is concentrated on one side while small money fills the other. The side with the higher money % vs ticket % is the sharp side.

**Field source (SharpAPI):** `public_betting_pct` (tickets), `public_money_pct` (handle/money)

**Strength tiers (absolute percentage-point gap):**

| Tier | Divergence | Interpretation |
|---|---|---|
| Weak | < 10pp | Within normal market noise |
| Moderate | 10 – 14pp | Sharp action present, not decisive |
| Strong | 15 – 24pp | Clear sharp divergence |
| Very strong | 25pp+ | Heavy sharp action, high conviction |

**Alignment with model pick.**
- Sharp money on the model's pick (and public on opposite) → strong confirmation
- Sharp money against model pick (public on model pick) → warning sign, sharps disagree

---

### Signal 5 — Public Smoke

**What it is.** Heavy public action with **no supporting sharp signals**. Money tracks tickets closely (no divergence), no steam, no RLM, no meaningful Pinnacle EV.

**What it tells us.** Pure recreational action. The bet is popular because it's popular — narrative-driven, not value-driven. Public smoke historically loses long-term in the aggregate.

**Detection criteria (ALL must hold):**
- Public tickets ≥ 65%
- Money / ticket gap roughly 5 – 8pp (close to flat)
- No steam
- No RLM
- No meaningful Pinnacle EV (< 1.5%)
- No sharp money divergence ≥ 10pp

**Alignment interpretation:**
- Public smoke aligned with model pick → yellow flag; model agrees with the crowd but sharps are absent
- Public smoke against model pick → mildly supportive of model (fading public is historically positive)

---

## Per-Pick Signal Combination Logic

For each pick (ML / OU / NRFI per game), the evaluator examines all five signal categories, determines alignment with the model's pick, and assigns a grade.

### Step 1: Classify each signal's tier and alignment

For each of the five signals, determine:
- Strength tier (weak / moderate / strong / very strong)
- Alignment (with the pick, against the pick, or neutral / no data)

### Step 2: Identify the market signal category

Based on combined signal evidence, classify the overall market signal into one of five categories (V2.1 `MarketSignal` vocabulary):

| Market Signal | Trigger conditions |
|---|---|
| `steam_alert` | Steam ≥ 3 books toward the model's pick |
| `market_confirmed` | Strong/very-strong aligned EV, RLM aligned with pick, or aligned sharp money divergence ≥ 15pp |
| `market_resistance` | Steam ≥ 3 books opposing pick, RLM opposing pick, or strong/very-strong opposing EV with confirming sharp divergence |
| `public_smoke` | All public smoke criteria met (see Signal 5) |
| `market_neutral` | No signal triggers; default state |

### Step 3: Combine with model edge to assign final grade

Cross the market signal with the model's edge (model_edge_pct, model_confidence) to produce the final 7-grade output:

See the **Grade Output Rules** section below.

---

## Grade Output Rules (7-Grade Vocabulary)

OddSphere uses seven grade labels. Each requires specific conditions. **All thresholds are conservative by design.**

### 🔥 Best Signal

**Definition:** Model edge is meaningful AND multiple strong market indicators agree AND no major risk conflict exists.

**Required conditions:**
- Model edge ≥ +3% (Pinnacle no-vig basis) OR model confidence ≥ 65%
- AT LEAST TWO of the following:
  - Strong/very-strong aligned Pinnacle EV (≥ 3%)
  - Strong steam aligned (≥ 3 books)
  - Strong RLM aligned with pick
  - Strong sharp money divergence aligned (≥ 15pp)
- No opposing signals of strong tier

**Notes:** Should be rare. Member-facing intuition: "this is the strongest read on the slate."

### ✅ Sharp Confirmed

**Definition:** Model likes the pick AND one strong sharp indicator OR multiple moderate indicators support it.

**Required conditions:**
- Model picks the side (positive confidence)
- AT LEAST ONE strong-tier aligned signal (steam, RLM, EV ≥ 3%, or sharp divergence ≥ 15pp), OR
- AT LEAST TWO moderate-tier aligned signals
- No opposing strong signals

**Notes:** Cleanest "sharps agree with us" read. Common but not abundant.

### ⚡ Market-Led

**Definition:** Model edge is light, but sharp/market signal is strong.

**Required conditions:**
- Model edge < +3% or model confidence < 60%
- Strong/very-strong aligned market signal exists (any of the five inputs at strong tier)
- The market is doing the work; model is along for the ride

**Critical:** Market-Led should NOT fire on weak or mixed movement. If the market signal is unclear, conflicting, or below strong tier, use `Market Watch` instead. Market-Led is reserved for cases where the market is genuinely loud and decisive — it must not become a catch-all for "market did something."

**Notes:** "Market knows something the model doesn't see strongly." Worth surfacing but with appropriate framing.

### 📊 Model Only

**Definition:** Model likes the pick, but no major market signal exists.

**Required conditions:**
- Model edge ≥ +2% or model confidence ≥ 58%
- No signal at moderate or stronger tier in any of the five inputs
- Market is silent; model speaks alone

**Notes:** Pure model-driven plays. Honest framing matters — members should know the market hasn't confirmed.

### 👀 Market Watch

**Definition:** Market movement exists, but evidence is weak, mixed, incomplete, or not decisive.

**Required conditions (any one):**
- Moderate-tier signals exist but no strong-tier consensus
- Conflicting signals (one moderate aligned + one moderate opposing)
- Pinnacle EV opposing (any tier) without confirming opposing sharp action — `market_resistance` market signal but doesn't escalate to Sharp Conflict
- Steam at only 2 books (not 3+)

**Notes:** This is the honest "we see something but it's not clear" state. Default when no other grade earns. Common.

### 💨 Public Smoke

**Definition:** Public is heavy, but sharp confirmation is weak or absent.

**Required conditions:**
- All public smoke detection criteria met (Signal 5)
- Model picks the public side (otherwise this signal is supportive, not cautionary)

**Notes:** Yellow flag. Model agrees with public, sharps are absent. Member-facing tone: "the crowd loves this, but no smart money is showing up."

### ⚠️ Sharp Conflict

**Definition:** A confirmed sharp signal opposes the model's pick.

**Required conditions (ALL must hold):**
- Model picks one side
- OPPOSING signals at strong tier from AT LEAST ONE of:
  - Steam ≥ 3 books opposing
  - RLM clearly opposing the model's pick
  - Sharp money divergence ≥ 15pp opposing
- PLUS at least one confirming opposing indicator (typically Pinnacle EV opposing at moderate+ tier)

**Critical:** Pinnacle EV opposing **alone** does NOT trigger Sharp Conflict. It triggers `Market Watch`. Escalation to Sharp Conflict requires steam, RLM, or sharp-money confirmation on top of the EV signal.

**Notes:** Member-facing tone: "the sharps are betting against our pick." Should be rare. Highly trustworthy when it fires.

---

## Headline Grade Selection (Per Game Card)

Each game card displays one **headline grade**. This is derived from the per-pick grades via rank-based selection.

### Grade rank (highest → lowest)

| Grade | Rank |
|---|---|
| Best Signal | 70 |
| Sharp Confirmed | 60 |
| Sharp Conflict | 50 |
| Market-Led | 40 |
| Public Smoke | 30 |
| Model Only | 20 |
| Market Watch | 10 |

### Selection rules

1. Examine all three per-pick grades (ML, OU, NRFI)
2. Filter to non-null grades
3. Select the highest-ranked grade
4. Tiebreaker for equal-rank grades: ML → OU → NRFI precedence (Moneyline wins ties)

### Why Sharp Conflict ranks above Market-Led

Caution signals are **load-bearing UX**. A beginner glancing at the headline must see the fade ahead of the noisier middle-tier grades. Sharp Conflict catches the eye when it matters most.

**Important qualifier:** Sharp Conflict only earns its rank-50 headline-priority position when it is a **fully confirmed** Sharp Conflict under the framework — meaning the conditions in the Sharp Conflict grade rules are ALL met (strong-tier opposing signal + confirming opposing indicator). Weak or borderline cautions fall into `Market Watch` and rank below Market-Led, not above.

This prevents a borderline / under-confirmed caution from hijacking the headline over a genuinely strong Market-Led read on the same card.

---

## Edge Case Handling

### Missing data fields

When SharpAPI returns a row with missing fields (e.g., `public_betting_pct` is null), that specific signal is treated as **absent**, not as zero. Absent ≠ negative.

### Stale data (timestamps)

Sharp signals older than 24 hours should be **flagged** in the UI ("3d ago") and may be down-weighted in evaluation. The framework treats them as valid until SharpAPI provides updated detection or marks them stale.

### Conflicting same-tier signals

When two signals at the same tier disagree (e.g., aligned moderate EV + moderate opposing sharp divergence):
- Steam and RLM win priority over EV
- Sharp money divergence wins priority over EV
- EV ties default to `Market Watch` (conservative)

### Model didn't pick the market

If the model produced no pick for a given market (e.g., no NRFI prediction generated), that pick's grade is `null` and the per-tile UI renders **"No Pick"** or **"Unavailable"** — NOT `Market Watch`.

Rationale: `Market Watch` implies market movement is present but unclear. Rendering Market Watch when no model pick exists falsely implies there IS market activity worth watching. "No Pick" is the honest representation: the model didn't generate a prediction for this market, so there is nothing to evaluate against.

Exception: if there IS active market movement on a market the model didn't pick (i.e., sharp signals exist on the unpicked market), the tile may surface those signals as informational context — but still without a model-aligned grade. The default fallback for "no model pick + no market activity" is `No Pick`. This is rare in V1 MLB (every game should have ML + OU + NRFI predictions).

### Single signal at "very strong" tier

A single signal at very-strong tier (e.g., steam 5+ books) is sufficient to fire `Sharp Confirmed` or `Sharp Conflict` (depending on alignment) WITHOUT needing a second confirming signal. Very-strong tier carries enough conviction alone.

---

## Signal Source Quality

OddSphere ingests sharp signal data from multiple sources. The framework treats them with different eligibility levels to prevent low-confidence data from polluting member-facing grades.

### Source types

| `source_type` | Description | Eligibility |
|---|---|---|
| `real_api` | Live data from SharpAPI (or successor provider) | Fully eligible for ALL grades (Best Signal, Sharp Confirmed, Market-Led, Model Only, Market Watch, Public Smoke, Sharp Conflict) |
| `manual` | Manually entered via Admin Upload Mode | Fully eligible for all grades, but `source_type='manual'` MUST be tracked in admin tooling for traceability. Acceptable for production use when real_api is unavailable. |
| `mock` | Development/seed data | Development only. **Never shown as production sharp signal.** Production filter excludes `source_type='mock'` rows from member-facing surfaces. |
| `stale` | Data older than 24 hours (or flagged as stale by ingestion) | Eligible for `Market Watch` only — does NOT escalate to Sharp Confirmed, Best Signal, Market-Led, or Sharp Conflict. Manually re-approving a stale row promotes it back to its original source_type. |

### Rules

1. **`mock` data NEVER ships to production member surfaces.** Production builds filter `source_type='mock'` rows from all daily edge / pick breakdown / Tonight's Board / Top Reads outputs. Admin tooling and dev environments may surface mock data freely.

2. **`stale` signals are downgraded.** A `stale` row that would otherwise classify as Sharp Confirmed becomes Market Watch. Members never see stale data driving high-conviction grades. Admin tooling can manually re-approve a stale row to promote it back to its original source_type.

3. **`manual` source must be auditable.** Every manually uploaded row carries a `source_type='manual'` flag, ingestion timestamp, and admin user attribution. Manual rows ARE eligible for production grades — but trail visibility matters when reviewing past performance.

4. **Source quality is INDEPENDENT of signal strength.** A strong-tier steam signal from a `stale` source still degrades to Market Watch. A weak-tier EV signal from `real_api` is still treated by its strength tier (Market Watch). Source quality is a separate eligibility gate applied on top of strength classification.

### Implementation

The `source_type` field exists on the `sharp_signals` table (and `game_predictions.source_type` for the prediction's data lineage). Derivation services consult `source_type` when computing eligibility:

```
function eligibleForGradeEscalation(signal):
  if signal.source_type === 'mock' and environment === 'production':
    return false  # excluded entirely
  if signal.source_type === 'stale':
    return false  # eligible for Market Watch only
  return true  # real_api and manual fully eligible
```

This rule lives in the derivation service, applied BEFORE the per-pick signal combination logic runs.

---

## Member-Facing Explanation Copy

When the product shows a sharp-signal row in the Pick Breakdown expanded section, the copy explains:
1. What the signal IS (in plain language)
2. Why it matters (one sentence)
3. Specific data points (EV %, books moved, divergence value, etc.)

### Tone guidelines

- Use plain English first, jargon second (members may be beginners)
- Avoid "guaranteed" / "lock" / "sure thing" — never imply certainty
- Cite the data source where relevant (e.g., "Pinnacle fair value", "Action Network books moved")
- Keep individual lines under 25 words where possible

### Example copy templates

**Aligned strong EV + steam:**
> "STRONG · Pinnacle EV +3.2% on PHI ML, confirmed by steam across 4 books (detected 11:45 AM ET). Sharp money 65% vs public bets 53%."

**Aligned EV-only (no confirmation):**
> "MODERATE · Pinnacle fair value supports PHI ML — +2.1% EV. No confirming steam or sharp money divergence."

**Opposing EV-only (no confirmation) — surfaces in Market Watch, not Sharp Conflict:**
> "WATCH · Pinnacle fair value opposes the model's Under pick — +5.4% EV on Over. No confirming steam or sharp money divergence on the opposing side."

**Opposing confirmed (Sharp Conflict):**
> "STRONG CAUTION · Steam across 3 books opposing the model's Under pick. Pinnacle EV +4.2% on Over confirms. Sharp money 65% on Over vs public 53%."

---

## Code Implementation Reference

This section maps the framework above to the actual code architecture. Engineers and code reviewers use this to verify the code implements the framework correctly.

### File responsibilities

| Concern | File | Status |
|---|---|---|
| Per-signal evaluation logic | `lib/services/marketSignalDerivationService.ts` (`deriveMarketSignal`) | Active, V2.1.1 |
| Per-pick grade assignment | `lib/services/gradeDerivationService.ts` (`deriveGrade`) | Active, V2.1.1 |
| Headline grade selection | `app/lab/lib/perPickHeadline.ts` (`headlineGrade`, `headlinePrimaryMarket`) | Active, V2.1.1 (rank-based) |
| Legacy verdict text (signal_summary) | `lib/models/dailyEdge/sharpSignalEvaluator.ts`, `lib/models/dailyEdge/verdictGenerator.ts` | **Needs audit** (may diverge from framework) |
| UI attribution copy | `app/lab/lib/gradeAttribution.ts`, `SimpleDailyEdgeCard.tsx` | Active, V2.1 |

### Field mapping (SharpAPI → code)

| SharpAPI field | Code field | Used by |
|---|---|---|
| `pinnacle_fair_probability` | `pinnacle_fair_probability` | EV calculations |
| EV calculation result | `is_plus_ev`, `ev_pct` | Pinnacle EV signal |
| Steam detection | `has_steam_move`, `steam_books_count` | Steam signal |
| RLM detection | `has_reverse_line_movement`, `rlm_direction` | RLM signal |
| Betting splits | `public_betting_pct`, `public_money_pct` | Sharp money divergence + public smoke |

### Threshold constants (single source of truth)

Defined in `lib/models/dailyEdge/sharpSignalConstants.ts`:

| Constant | Value | Framework reference |
|---|---|---|
| `MIN_EV_FOR_PLUS_EV_SIGNAL` | 1.5 (currently 2.0 — needs update) | Signal 1 (Pinnacle EV) moderate tier |
| `EV_STRONG_THRESHOLD` | 3.0 | Signal 1 strong tier |
| `EV_VERY_STRONG_THRESHOLD` | 5.0 | Signal 1 very strong tier |
| `MIN_STEAM_BOOKS` | 3 | Signal 2 strong tier |
| `STEAM_VERY_STRONG_BOOKS` | 5 | Signal 2 very strong tier |
| `RLM_PUBLIC_THRESHOLD` | 60 | Signal 3 detection |
| `RLM_STRONG_PUBLIC_THRESHOLD` | 65 | Signal 3 strong tier |
| `SHARP_DIVERGENCE_MODERATE` | 10 | Signal 4 moderate tier |
| `SHARP_DIVERGENCE_STRONG` | 15 | Signal 4 strong tier |
| `SHARP_DIVERGENCE_VERY_STRONG` | 25 | Signal 4 very strong tier |
| `PUBLIC_SMOKE_TICKET_THRESHOLD` | 65 | Signal 5 detection |
| `PUBLIC_SMOKE_FLAT_GAP_MAX` | 8 | Signal 5 flatness |

### Conformance audit checklist

After every change to signal evaluation logic, verify:

- [ ] All five signals are evaluated independently per-pick
- [ ] Grade rules match Section "Grade Output Rules"
- [ ] Thresholds match Section "Threshold constants"
- [ ] Headline selection follows rank-based logic
- [ ] Pinnacle EV alone (without confirmation) does NOT escalate to Sharp Conflict
- [ ] Single very-strong signal can fire Sharp Confirmed / Sharp Conflict alone
- [ ] Conservative default: when in doubt → Market Watch

---

## Open Questions / Future Considerations

Items not yet decided. Update when resolved:

- **Confidence thresholds for "model edge":** Currently using model_edge_pct vs Pinnacle fair. Need to confirm threshold values for Best Signal vs Sharp Confirmed eligibility.
- **Player props sharp signals:** Framework above covers GAME markets (ML, OU, NRFI). Prop markets (HR, K's, hits, etc.) need their own signal evaluation pass. Phase 6.5 work.
- **Sport-specific tuning:** Thresholds above are MLB-tuned. NBA / NFL / NHL may need adjusted thresholds for their market dynamics. Per-sport overrides supported in `sharpSignalConstants.ts`.
- **Stale signal weighting:** Currently no down-weighting for older signals. Consider half-life decay for signals > 4 hours old.
- **Confidence intervals on splits:** Sharp money / public ticket percentages have measurement noise. Should we require statistical significance, or accept point estimates?

---

## Changelog

- **2026-05-26 — v1.1** — Reviewer-pass refinements:
  - Tightened `Market-Led` definition (must not fire on weak/mixed movement — use Market Watch instead).
  - Changed unpicked-market fallback from defensive `Market Watch` to honest `No Pick` / `Unavailable`. Market Watch implies movement; "No Pick" is the honest representation when no model prediction exists.
  - Added new section **Signal Source Quality** — eligibility rules for `real_api`, `manual`, `mock`, `stale` source types. `mock` filtered from production; `stale` downgraded to Market Watch.
  - Clarified Sharp Conflict ranking: rank-50 headline-priority position applies only to FULLY CONFIRMED Sharp Conflict (all framework conditions met). Borderline cautions fall back to Market Watch instead of hijacking the headline.

- **2026-05-26 — v1.0** — Initial document. Framework locked by Daniel Mengel. Conservative-by-default philosophy. Five signal inputs, seven grade outputs, per-pick evaluation, rank-based headline. Replaces ad-hoc classification logic accumulated during Phase 6.3 – 6.3.5.

---

**End of document.**
