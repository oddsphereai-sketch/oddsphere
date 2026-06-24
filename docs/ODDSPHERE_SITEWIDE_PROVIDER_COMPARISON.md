# OddSphere Site-Wide Provider Comparison

Status: analysis + recommendation (ticket `o-sitewide-provider-comparison`)
Date: 2026-06-24
Author: Claude
Reads with: `docs/ODDSPHERE_PRODUCT_DATA_OPERATING_PLAN.md`, `docs/ODDSPHERE_THIS_MORNING_EXECUTION_BRIEF.md`, `docs/ODDSPHERE_CANONICAL_LINE_SOURCE_POLICY.md`

Purpose: compare **current OddSphere data** vs **Playbook** vs **SharpAPI** across every sport and every user-facing lane — not a single-sport integration. Decide which source should own each lane, what improves for users and operators, and which claims become allowed vs stay forbidden. All findings are read-only; no production change is proposed inside this document.

Evidence base: live Playbook shadow audit on 2026-06-24 (builder tier, 250k/mo) via `scripts/operator/playbook-provider-probe.ts`, plus a read-only trace of `lib/providers/factory.ts` and the per-sport services for current-state.

---

## 1. Executive recommendation

**Playbook becomes OddSphere's primary PUBLIC-SPLITS / money-% / `booksUsed` provider site-wide, and a labeled `playbook_consensus` market-context lane. SharpAPI remains the sole owner of per-book odds, fair/no-vig pricing, +EV, line movement, opener/lock, CLV, and streaming.** Neither replaces the other; they own different lanes.

The single highest-leverage change is **public splits**, because today:

- **MLB** public splits come from SharpAPI `/splits` and are *fragile*: markets limited to ML/spread/total, incomplete on the 8 AM slate, and **dropped entirely whenever the per-run 8-call SharpAPI cap is hit** (`SharpAPISignalProvider`). That intermittent null is a direct cause of "Daily Edge feels sloppy."
- **NBA, NHL, WNBA** have **no public-splits lane at all** (null throughout).

Playbook fixes both: one cheap call returns the **whole league's** splits (ML + total + spread, 100% populated today) with an explicit **`booksUsed`** count — removing the call-cap starvation and adding a coverage Playbook has where we currently have nothing.

Sequencing (no production change in this ticket):

1. Shadow-validate Playbook MLB + WNBA splits for ≥1 week (coverage, slate match, `booksUsed`, staleness).
2. Run a **model-impact audit** before Playbook fields influence grades/verdicts/Best Angles.
3. Promote Playbook to **primary public-splits** for MLB; demote SharpAPI `/splits` to **backstop** only if the audit is clean.
4. Add **net-new** public-splits lanes to NBA/WNBA/NHL (in-season) — with the same impact gate.
5. Keep Playbook lines as `playbook_consensus` context only. Never wire them into book-specific movement.

---

## 2. Lane-ownership matrix (site-wide)

| Lane | Today | Playbook can | SharpAPI can | **Owner (recommended)** |
| --- | --- | --- | --- | --- |
| Slate / games | BDL (MLB/WNBA), ESPN (NBA), NHL API, BDL-FIFA (WC) | Games/Teams endpoints | events/schedule | **Keep current**; Playbook = optional backstop |
| Per-book odds (ML/spread/total) | SharpAPI `/odds` | ❌ consensus only | ✅ per-book | **SharpAPI** |
| Consensus / market-context line | (none, distinct) | ✅ `/v1/lines` (tier label) | partial | **Playbook** as `playbook_consensus` (context/fallback only) |
| Public bet % / money % | SharpAPI `/splits` (MLB only, fragile); none elsewhere | ✅ ML+total+spread, `booksUsed`, 1 call/league | ✅ but tier-gated + call-capped | **Playbook** (primary); SharpAPI = backstop |
| Fair / no-vig price, +EV | SharpAPI `/opportunities/ev` | ❌ | ✅ | **SharpAPI** |
| Line movement / opener / lock | SharpAPI per-book series | ❌ snapshot only | ✅ | **SharpAPI** |
| CLV / closing | not yet stored | ❌ | ✅ (higher tier) | **SharpAPI** (when built) |
| Streaming / delta | SharpAPI WS (gated off) | ❌ | ✅ | **SharpAPI** |
| Steam / RLM | hardcoded false | ❌ | ❌ (must be computed) | **Derived in-house** (not a provider field) |
| Context: injuries / starters / weather / team stats / form / H2H | BDL / ESPN / OpenWeather / scrapes | ✅ (dedicated endpoints) | partial | **Evaluate Playbook per-lane** (ticket `o-mlb-playbook-context`) |

Rule from the canonical policy that governs the whole table: **movement compares the same `source_key` over time.** Playbook consensus and SharpAPI per-book are *never* compared to each other.

---

## 3. Current state vs Playbook coverage (live 2026-06-24)

| Sport | Live? | Games | Odds | Public splits TODAY | Playbook splits/lines TODAY |
| --- | --- | --- | --- | --- | --- |
| MLB | ✅ live | BDL | SharpAPI `/odds` | SharpAPI `/splits` (fragile) | **16 / 16** (100% slate) |
| NBA | ✅ live | ESPN | SharpAPI `/odds` | **none** | 0 (off-season) |
| NHL | 🟡 seasonal off | NHL API | SharpAPI `/odds` | **none** | 0 (off-season) |
| WNBA | 🟡 scaffolding, in-season | BDL | SharpAPI `/odds` | **none** | **8 / 8** |
| Soccer / WC | 🟡 tournament | BDL-FIFA | SharpAPI `/odds`+`/splits` | SharpAPI (WC) | **0** (MLS=0; no intl soccer) |
| NFL | ❌ stub | — | — | — | **75 / 75** |
| NCAAF (cfb≡ncaaf) | ❌ stub | — | — | — | **78 / 78** |
| NCAAB (cbb≡ncaab) | ❌ stub | — | — | — | 0 (off-season) |

Notes: `cfb`/`cbb` are aliases of `ncaaf`/`ncaab` (identical responses). Playbook lines are a **consensus snapshot only** — `lineSourceTier:"tier1"`, no per-book breakdown, no history, no timestamp. The only time field is event `startTime` (no data-as-of), so staleness must be stamped at ingest for every Playbook lane.

---

## 4. MLB public-data deep dive (Playbook vs current SharpAPI splits)

The user's explicit focus. Current MLB public bet%/money% = SharpAPI `/splits?sport=mlb` merged in `SharpAPISignalProvider`.

| Dimension | Current (SharpAPI `/splits`) | Playbook `/v1/splits?league=mlb` |
| --- | --- | --- |
| Markets | ML, spread, total | ML, spread, total (parity) |
| Coverage today | Partial; incomplete on 8 AM slate; **skipped when 8-call cap hit** | **16/16 games, 100%** of our slate |
| `booksUsed` transparency | Not surfaced | **Explicit 10–11 books per market, 100% populated** |
| bet % vs money % | Both (0–1 → ×100) | **Both, and they diverge** (real ticket-vs-handle, e.g. WSox total bets 57% / money 61%) |
| Freshness field | none in payload | none in payload (only `startTime`) → tie; stamp at ingest |
| Cost model | Counts against 8-call/run cap → can starve | **1 call returns whole slate** → no starvation |
| Slate match | team-pair + date guard | **15/16** matched, **0 unmatched** (1 = doubleheader sharing a team-pair key) |
| First inning (NRFI) | always null | not provided (out of scope, unchanged) |
| Failure modes | null on cap-skip / 8 AM / late-night date roll | none observed in probe |

**Verdict for MLB public data → replace as primary, keep SharpAPI as backstop.** Playbook is at least at parity on markets and strictly better on coverage reliability, `booksUsed` transparency, and cost (one call vs cap-contended calls). Promoting it removes the intermittent-null failure mode that makes the card feel unreliable. Keep SharpAPI `/splits` as a backstop during shadow validation, then demote it. **First-inning public data is unchanged** (neither side covers it well; out of scope).

Hard line (operating plan + canonical policy): Playbook splits feed **only** the public bet%/money% fields. They must **never** populate `+EV`, `steam`, `reverse_line_movement`, `pinnacle_*`, or `CLV`. Those remain SharpAPI-derived or computed in-house.

---

## 5. Per-sport / per-market recommendation

For each: current → Playbook → SharpAPI → owner → user gain → operator gain → claims allowed → claims still forbidden.

### MLB (live)
- **Current:** SharpAPI odds + EV + fragile `/splits`; BDL slate/context; V2.2 model; full tracking.
- **Playbook:** full-slate splits + `booksUsed`; consensus lines; rich MLB context endpoints.
- **SharpAPI:** per-book odds, fair price, +EV, movement.
- **Owner:** splits → **Playbook (primary)**, SharpAPI backstop; odds/EV/movement → **SharpAPI**; consensus context → **Playbook**.
- **Users gain:** public split on every game, every refresh; "% of bets vs % of money across N books."
- **Operators gain:** no call-cap starvation; one cheap call/slate; `booksUsed` to judge confidence.
- **Claims allowed:** "Public split," "X% bets / Y% money," "across 11 books," consensus market context.
- **Forbidden:** +EV/steam/RLM/Pinnacle/CLV from Playbook; book-specific "line moved"; "opener."

### NBA (live) — net-new win
- **Current:** ESPN slate, SharpAPI odds, **no splits, no sharp signals wired**; Elo V1; tracking ML/total.
- **Playbook:** public splits when in-season (0 today, off-season); consensus lines.
- **SharpAPI:** odds (already wired); EV not wired for NBA.
- **Owner:** splits → **Playbook (new lane)**; odds → SharpAPI.
- **Users gain:** public splits where there are currently none.
- **Operators gain:** market context for a model that today flies without it.
- **Allowed:** public split, consensus context. **Forbidden:** EV/steam/RLM/CLV (no fair-price lane wired).
- **Action:** validate at NBA season open (rows are 0 now).

### WNBA (in-season, scaffolding) — highest-value visible win
- **Current:** BDL slate, SharpAPI odds, **no splits**; Elo model; no tracking yet.
- **Playbook:** **8/8 splits today**, `booksUsed` 100%, but **2/3 of OUR games matched** → needs a non-MLB team normalizer.
- **Owner:** splits → **Playbook**.
- **Users gain:** first real public-market context for WNBA.
- **Operators gain:** coverage we cannot get from SharpAPI on the current tier.
- **Allowed:** public split, consensus context. **Forbidden:** EV/steam/RLM/CLV.
- **Action:** ticket `o-wnba-playbook-splits`; prerequisite = WNBA team normalizer (this audit's finding). Do not start until ownership assigned (touches `lib/services/wnba/*`).

### NHL (seasonal, off now)
- **Current:** NHL API slate, SharpAPI odds, no splits; V0 model.
- **Playbook:** public splits + consensus when in-season (0 today).
- **Owner:** splits → **Playbook (new lane)** at season open; odds → SharpAPI.
- **Allowed:** public split, consensus context. **Forbidden:** EV/steam/RLM/CLV.

### Soccer / World Cup (tournament)
- **Current:** BDL-FIFA slate, SharpAPI odds + `/splits` (WC), markets ML/DC/total/BTTS.
- **Playbook:** **does not cover international soccer** (MLS=0; no WC). No help here.
- **Owner:** **SharpAPI stays** the soccer provider. No change.
- Explicitly out of scope per the original brief.

### NFL / NCAAF / NCAAB (stubs)
- **Current:** none — type-union stubs, no providers/models/crons.
- **Playbook:** strong coverage (NFL 75, NCAAF 78 today) — splits + consensus lines.
- **SharpAPI:** per-book odds available if a tier is purchased.
- **Owner:** **opportunity, not a lane yet.** Playbook makes these sports *feasible* (instant public-market layer), but each needs a full slate/model/tracking build before any user-facing claim. Flag for roadmap; do not ship on coverage alone.

---

## 6. Claims map (what Playbook unlocks vs what stays gated)

**Newly allowed (once a Playbook split lane ships, per sport):**
- "Public split: 62% of bets / 58% of money" (bet% and money% are real and distinct).
- "Across 11 books" (`booksUsed`).
- "Market context (consensus)" using `playbook_consensus` lines, clearly labeled.

**Still forbidden regardless of Playbook:**
- "+EV," "no-vig," "Pinnacle agrees" — require SharpAPI fair price.
- "Steam," "reverse line movement" — must be computed from valid same-source history; no provider supplies them today.
- "Line moved" / "opener" — require same-`source_key` series over time (canonical policy). Playbook consensus snapshot cannot back this.
- "CLV" / "beat the close" — require stored, comparable closing prices.
- Any member-facing Playbook display before the **commercial-terms** question is resolved (Playbook's Terms/Privacy links are placeholder/blank — "needs confirmation before member-facing production").

---

## 7. Operator-level improvements (whole product)

- **Reliability:** removes the intermittent MLB-splits null (call-cap starvation) that makes Daily Edge feel sloppy.
- **Cost/headroom:** one call/league/refresh; measured burn ~2 units/call; builder 250k/mo is ample (fall-peak ~17k units/mo). Frees SharpAPI call budget for EV/odds.
- **Coverage:** adds a public-market layer to NBA/WNBA/NHL where there is none today.
- **Transparency:** `booksUsed` lets us down-weight thin-book splits and show honest confidence.
- **Discipline:** consensus stays consensus; every Playbook row stamped with `provider=playbook`, `source_type=consensus|public_split`, ingest timestamp — satisfying the canonical policy's stored-metadata requirement.

---

## 8. Open blockers before any member-facing production

1. **Commercial terms** — obtain Playbook's written ToS (redistribution + member-facing display). Currently unresolved.
2. **Non-MLB team normalizer** — required for WNBA/NBA/NHL slate matching (WNBA matched only 2/3 today).
3. **Ingest-time freshness stamping** — no provider exposes data-as-of; we must stamp and enforce a staleness budget.
4. **Model-impact audit** — compare current vs Playbook-backed public splits through `sharp_signals`, `market_signal`, grade, verdict, confidence, Best Angle, Caution, No Play, and tracking outputs before promotion.
5. **Market-signal correctness audit** — verify public splits do not create +EV, steam, RLM, Pinnacle, CLV, or book-movement claims.
6. **Shadow-validation week** — confirm MLB/WNBA coverage, slate match, and `booksUsed` hold across real slates before promotion.

---

## 9. Recommended next tickets (in order)

1. `o-wnba-playbook-splits` (after WNBA normalizer) — highest-value visible win, in-season now.
2. `o-playbook-model-impact-audit` — prove how Playbook changes grades/verdicts before promotion.
3. MLB splits promotion: Playbook primary + SharpAPI backstop (behind a flag, shadow first).
4. `o-mlb-playbook-context` — evaluate context lanes one at a time with fallback + freshness.
5. NBA/NHL public-splits lanes at season open.
6. Resolve Playbook commercial terms if needed by provider policy.
