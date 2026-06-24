# Dual-Source Public Splits — Architecture & Smallest-Safe Path (design, read-only)

Status: design (no production code proposed inside this doc)
Date: 2026-06-24
Author: Claude
Builds on: `docs/ODDSPHERE_SOURCE_FLOW_AUDIT_2026_06_24.md`, `docs/ODDSPHERE_MLB_PLAYBOOK_SPLITS_PROMOTION_AUDIT_2026_06_24.md`

Goal: provider-separated public-splits observation layer + a resolved read (Playbook-preferred display, SharpAPI confirmation, agreement→confidence), with a **simple UI** and **gated** model use — without replacing SharpAPI or averaging the two into a fake number.

## Why this shape (grounded in the prior audit)
The MLB promotion audit found the providers genuinely disagree on **money/handle%** (SharpAPI extreme, Playbook balanced), and that disagreement alone would swing ~26% of grades because the grade engine keys on money-vs-bets divergence. The dual-source design turns that disagreement from a *liability* into a *signal*: **agreement → support; hard disagreement → cap public-split influence.** That directly defuses the fragility.

## What already exists (reuse, don't reinvent)
- `sharp_signals.public_betting_pct / public_money_pct / computed_at` (current) + `sharp_signals_history` (history).
- `lib/services/lastKnownGoodReader.ts`: current→history→null, `STALE_AGE_MINUTES = 15`, `isStale()`, `loadSplitsHistoryForSlate()`.
- DTO `MarketEdgeDto.publicSplits[] = { side, label, moneyPct, betsPct, observedAt?, isStale? }` rendered by the sport-agnostic UI.
- **Limitation:** one shared lane — `sharp_signals.public_*` is SharpAPI for MLB, Playbook for WNBA; the two can't coexist per game, so there is no provider comparison.

## Sport-agnostic by design — per-sport capability registry
This is shared infrastructure across ALL sports/models, parameterized by one
registry: `lib/config/publicSplitsCapability.ts`. Adding a sport = one entry.
The observation writer, resolved read, UI, and grade modifier all consult it.

| Sport | sharp_signals provenance | Playbook splits | SharpAPI splits | status | meaning |
| --- | --- | --- | --- | --- | --- |
| MLB | sharpapi | yes | yes | **supported** | model-impacting now; dual-source target |
| WNBA | playbook | yes | no | **supported** | Playbook fills the gap; display-only (no grades yet) |
| NBA / NHL / NFL / NCAAF / NCAAB | none | yes (in-season) | no | **audit_required** | observe-only; NOT displayed/model-fed until audited |
| Soccer / WC / UCL | sharpapi/none | **no** | empty_as_of_probe | **unsupported** | no trusted source → bars stay empty (honest) |

`status` gates flow: **supported** = observe + display + (gated) grade; **audit_required** = OBSERVE only (read-only data-gathering for the audit) — never display or feed model; **unsupported** = never display, never fabricate. So Soccer/WC is explicitly excluded from Playbook splits unless verified, and NBA/NHL/NFL/NCAAF/NCAAB must pass a per-sport audit before any model-impacting use — exactly per the operating directive.

## Invariants (must hold in every phase)
- Playbook NEVER creates EV, fair/no-vig, steam, RLM, CLV, or line movement.
- Public splits NEVER move raw score projections. They may affect market_signal / grade / Best-Angle eligibility / actionability only.
- No averaging two providers into one money number. Display shows ONE provider's value (preferred), not a blend.
- No provider names in the default UI.
- SharpAPI remains the owner of EV / fair price / steam / RLM / movement and stays a public-split comparison point.

---

## Layer 1 — Observation table (provider-separated)

New table `public_splits_observations` — additive, does NOT touch `sharp_signals`.

```sql
-- lib/db/schema-migration-v18.sql (proposed)
CREATE TABLE public_splits_observations (
  id                 BIGSERIAL PRIMARY KEY,
  provider           TEXT NOT NULL CHECK (provider IN ('playbook','sharpapi')),
  sport              TEXT NOT NULL,
  game_id            BIGINT NOT NULL REFERENCES games(id),
  market_type        TEXT NOT NULL,                 -- moneyline | total | spread
  side               TEXT NOT NULL,                 -- home | away | over | under
  public_betting_pct NUMERIC(5,2),
  public_money_pct   NUMERIC(5,2),
  books_used         INTEGER,
  observed_at        TIMESTAMPTZ NOT NULL,          -- provider fetch/compute time (freshness basis)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, game_id, market_type, side)     -- one CURRENT row per provider/key (upsert)
);
CREATE INDEX idx_pso_game ON public_splits_observations (game_id, market_type, side);
```
- Upsert per `(provider, game_id, market_type, side)` = the provider's current observation. (History/LKG-across-providers is a later refinement mirroring `sharp_signals_history`; not needed for v1.)
- Freshness reuses `STALE_AGE_MINUTES` against `observed_at`.

## Layer 2 — Resolved read (pure service)

`resolvePublicSplits(playbookObs | null, sharpApiObs | null, nowMs)` → per (game, market, side):
```ts
type ResolvedPublicSplit = {
  // DISPLAY (one provider, never a blend)
  betsPct: number | null;
  moneyPct: number | null;
  booksUsed: number | null;
  observedAt: string | null;
  isStale: boolean;
  // INTERNAL (not shown by default)
  displaySource: "playbook" | "sharpapi" | null;
  agreementState: "aligned" | "mild_disagreement" | "major_disagreement" | "single_source" | "none";
  modelConfidence: "high" | "medium" | "low" | "unavailable";
  // raw both-provider values retained for model use (never UI-blended)
  raw: { playbook?: {...}; sharpapi?: {...} };
};
```
**Display preference:** Playbook when present AND fresh (≤ `STALE_AGE_MINUTES`) AND complete (bets%+money%+booksUsed); else SharpAPI fallback; else stale-but-valid (LKG) with `isStale=true`; else null.

**Agreement (compare the two providers; money% is the divergent axis):** `gap = max(|Δbets|, |Δmoney|)` —
- `aligned`: both fresh & `gap ≤ 10`
- `mild_disagreement`: `gap ≤ 20`
- `major_disagreement`: `gap > 20`
- `single_source`: exactly one provider present (fresh)
- `none`: neither present
(Initial thresholds — tunable once we have outcome data.)

**model_confidence:** aligned→`high`; mild→`medium`; single_source(fresh)→`medium`; major→`low`; stale-only→`low`; none→`unavailable`.

## Layer 3 — UI (stays simple)
- One clean Tickets/Money bar pair from the resolved DISPLAY source. No provider names.
- DTO add (minimal): one optional field, e.g. `publicSplitNote?: "mixed" | "lower_confidence" | null`, derived from `agreementState`/`modelConfidence`.
  - `major_disagreement` → subtle "Market data mixed".
  - `modelConfidence === "low"` → subtle "Lower confidence".
  - else nothing (default clean bars).
- No default "Playbook vs SharpAPI" comparison anywhere.

## Layer 4 — Model / grade use (the confidence modifier)
Public splits keep feeding ONLY market_signal / grade / Best-Angle eligibility (never projections). New rule, applied where `public_smoke` / `classifySharpDivergenceTier` / opposing-money guard consume splits:
- `aligned` (high) → public-split signal counts at full framework weight (can support grade).
- `mild_disagreement` (medium) → public-split signal counts but **cannot alone create `best_signal`** (cap at `sharp_confirmed` / `market_watch`).
- `major_disagreement` (low) → public-split grade escalation **suppressed** (no public_smoke/divergence boost; still displayed). 
- `single_source` → treat as today (one provider), confidence medium.
- SharpAPI EV / RLM / steam are independent and still strongly confirm/resist (unaffected by the cap).
This is exactly the safeguard the promotion audit called for: the ~26% swing was concentrated in disagreement cases — those are now capped, not amplified.

---

## Smallest-safe implementation path (phased, each gated)

**Phase 1 — Observation layer (additive; ZERO behavior change).** New table + dual-write from existing ingest: `refreshWnbaPlaybookSplits` (provider=playbook), `SharpAPISignalProvider` (provider=sharpapi), and a new **MLB Playbook splits ingest → observations only** (does NOT write `sharp_signals`, so no grade impact). Read-only verify script confirms both providers populate. UI/grades untouched. *Ticket `o-dual-splits-observation-layer`.*

**Phase 2 — Resolved read + display (behind a flag, display-only).** Add `resolvePublicSplits` (pure, unit-tested). Wire the DTO publicSplits builder to use it behind a feature flag (default OFF = current behavior); add the optional `publicSplitNote`. Model-impact audit must show **grades unchanged** (display-only). Sport-switching browser smoke. *Ticket `o-dual-splits-resolved-read-ui`.*

**Phase 3 — Confidence modifier in grade (gated, model-impacting).** Feed `agreementState` into the public-split grade path (cap/suppress on disagreement). Requires the multi-slate model-impact replay + sign-off (expected to REDUCE the disagreement-driven swing, not add risk). *Ticket `o-dual-splits-confidence-modifier`.*

**Phase 4 — Promotion/cleanup.** Once validated, Playbook is the preferred display everywhere fresh; SharpAPI stays sharp/confirmation + backstop. Decide whether to retire the single-lane `sharp_signals.public_*` writes or keep as backstop.

## What needs a decision before Phase 1
- Confirm the new table name/columns (above) and that a hand-written `schema-migration-v18.sql` is the right mechanism (matches v4..v17 convention; applied manually — no migration runner in package.json).
- Confirm initial agreement thresholds (10 / 20) as a starting point (tunable).
- Phase 1 touches `SharpAPISignalProvider` (additive observation write) — confirm that's acceptable (grade-critical file, but the write is purely additive and does not alter `sharp_signals`).

No code written. Phases 1–3 are separate tickets; nothing proceeds without explicit assignment, and Phase 2/3 carry their own model-impact + smoke gates.
