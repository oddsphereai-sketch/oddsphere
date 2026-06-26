# MLB Playbook Public-Splits Promotion Audit (read-only, multi-slate)

Status: read-only audit + recommendation (ticket `o-mlb-playbook-splits-shadow`)
Date: 2026-06-24
Author: Claude
Tool: `scripts/operator/playbook-mlb-splits-promotion-audit.ts` (15 slates, 2026-06-10..06-24)

Question: should Playbook become MLB's PRIMARY public-splits provider (SharpAPI backstop) without hurting grades / Best Angle / ROI?

## Methodology
Mirrors Codex's ratified single-slate harness (`playbook-model-impact-audit.ts`): for each market, re-run the REAL pipeline (`deriveMarketSignal` + `classifyEvidence` + `deriveGrade`) twice — once with the stored **SharpAPI** public split, once with the **Playbook** public split, **everything else identical** (Playbook never supplies +EV/fair-prob/steam/RLM/odds). Multi-slate via `/v1/splits-history` (frozen pregame). Symmetric A/B on the **model side** to isolate the provider effect. Consistency check: on the shared date 2026-06-24 this harness shows **3 grade changes** vs Codex's **2/32** — same ballpark, methodology agrees.

## Coverage / data quality (Playbook side: strong)
- 15 slates, 203 MLB games; Playbook `/splits-history` matched **174/203 (86%)**.
- **346 both-covered markets** (model ML+total with both SharpAPI and Playbook). `noPlaybook` 58 (unmatched games / history gaps), `noSharp` 2.
- **booksUsed populated 346/346** on matched markets. Splits-history is frozen-pregame → good for backtest.
- bets% (tickets) are reasonably close between providers; **money% (handle) is where they diverge sharply.**

## Impact of swapping SharpAPI → Playbook (provider A/B, 346 markets)
| Metric | Count | Rate |
| --- | --- | --- |
| public bet/money % changed | 346 | 100% |
| **market_signal changed** | 48 | **13.9%** |
| **grade changed** | 89 | **25.7%** |
| public_smoke flipped | 48 | 13.9% |
| **divergence tier changed** | 241 | **69.7%** |
| opposing-money conflict-guard changed | 82 | 23.7% |
| **Best Angle affected** | 17 markets | — |

Per-slate it ranges widely (06-24 grade Δ = 3/30 ≈ 10%; 06-13 = 12/30 = 40%). **The single 06-24 first pass (≈2/32) understated the true, slate-variable impact** — exactly why multi-slate was required.

## Root cause: providers disagree on MONEY/HANDLE %, and our grade engine is money-divergence-sensitive
Verified in DB (MLB 2026-06-10 totals): SharpAPI money% is symmetric but **extreme** — e.g. over 94 / under 6, over 83 / under 17, over 93 / under 7 — while bets are moderate (65/35). So `|money − bets|` is large → **very_strong sharp-divergence → best_signal / sharp_confirmed**. Playbook reports **balanced** money (~60/40) → small or null divergence → lower grade.

Consequently:
- **69.7% of markets get a different divergence tier** between providers → the dominant grade driver.
- Swapping to Playbook **systematically lowers** divergence-driven grades (fewer best_signal/sharp_confirmed from money divergence) and changes the opposing-money conflict guard on 23.7% of markets (which demotes/locks Best Angles).
- Even `public_smoke` flips 13.9% (it requires a *flat* money-vs-bets gap; SharpAPI's extreme money breaks "flat," Playbook's balanced money satisfies it).

**Which money% is correct is unknown** without outcome validation. SharpAPI's extreme handle concentration and Playbook's balanced handle are a genuine provider disagreement, not a storage bug in either.

## Confirmed safety
Playbook populated ONLY public bet% / money% / booksUsed (freshness = ingest time). The A/B left +EV, fair/no-vig, steam, RLM, CLV, line movement, and sportsbook odds untouched. No DB/UI/grade/tracking writes.

## Recommendation → **(3) RUN LONGER SHADOW** (do NOT promote yet; do NOT passively keep SharpAPI)

Promoting now would silently reshape ~26% of MLB grades and 17 Best Angles based on a provider disagreement we cannot yet adjudicate — too large to swap blindly. But "keep SharpAPI" is not a clean win either: its MLB **handle%** is the sole driver of a large share of best_signal/divergence grades, and we have no evidence it's the *accurate* handle.

Run a **targeted** shadow, not a passive one:
1. **Forward dual-capture** both providers' bet% AND money% daily (Playbook already ingested; capture SharpAPI alongside) keyed to locked picks.
2. **Outcome validation:** grade the divergence-driven Best Angles under each money source and compare ROI/hit-rate — i.e., does SharpAPI's "extreme handle divergence" or Playbook's "balanced handle" better predict winners? That is the entire crux.
3. **Decision gate:** promote Playbook only if its money% is ≥ as predictive (and its coverage/freshness hold) over ≥2–3 weeks; otherwise keep SharpAPI as the divergence source and use Playbook for bet% + booksUsed display.

### Secondary finding (model-integrity, separate ticket)
A **26% grade swing from a splits-provider swap** is a fragility signal: the grade engine's `best_signal`/`sharp_confirmed` path is highly sensitive to the splits provider's **money%** (via `classifySharpDivergenceTier` + the opposing-money conflict guard). Regardless of the Playbook decision, this sensitivity—and SharpAPI's extreme-handle pattern—warrants review under `o-market-signal-correctness-audit` (is money-vs-bets divergence a robust signal, or is it amplifying provider noise?).

## Next steps (no code beyond this audit)
- Stand up the forward dual-capture + outcome harness (new ticket).
- Until validated: Playbook stays display-context (bet%/money%/booksUsed); SharpAPI remains the grade/divergence source for MLB.
