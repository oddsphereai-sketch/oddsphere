# OddSphere WNBA Slate Reconciliation — 2026-06-24

Status: read-only reconciliation (prerequisite for `o-wnba-playbook-splits`)
Date: 2026-06-24
Author: Claude
Tool: `scripts/operator/wnba-slate-reconciliation.ts` (read-only; no DB/splits/grade/movement writes)

Purpose: Daniel flagged the official ET WNBA slate for Wed Jun 24, 2026 as **4 games**, but our shadow audit saw only 2 pregame OddSphere games. This reconciles four views — official vs OddSphere DB vs Playbook splits vs SharpAPI odds — and finds the root cause **before** any splits ingest.

## Verdict

**Playbook coverage is complete and correct. The defect is in OddSphere's WNBA slate bucketing**, not in Playbook. Do **not** ingest WNBA splits until the slate is ET-anchored from a precise tip time.

## Four-way reconciliation (target ET day = 2026-06-24)

| Game | Official (ET) | OddSphere DB | Playbook (ET tip) | SharpAPI (ET tip) |
| --- | --- | --- | --- | --- |
| PHX@IND | ✅ | ✅ pregame | ✅ | ✅ |
| MIN@WSH | ✅ | ✅ pregame | ✅ | ✅ |
| POR@CHI | ✅ | ❌ (on 06-25 slate) | ✅ | ✅ |
| ATL@GS | ✅ | ❌ (on 06-25 slate) | ✅ | ✅ |
| NY@LV | — | ⚠️ present as **FINAL** | — | — |

Counts: official **4** · DB-on-slate **3** (pregame **2**) · Playbook(ET) **4** · SharpAPI(ET) **4**. **Playbook and SharpAPI agree on all 4.**

## Answers to the review checklist

1. **Are our WNBA games stale/incomplete?** Yes — incomplete. The 06-24 slate is missing `POR@CHI` and `ATL@GS`, and carries a stale `NY@LV` that already went FINAL (a Jun 23 ET night game).
2. **UTC vs ET slate bucketing?** This is the root cause. `lib/dates/slateDate.ts` correctly anchors WNBA to `America/New_York`, but the WNBA seed never applies it — see #4.
3. **Is Playbook returning only part of the slate?** No. Playbook returns all 4; its `date` field is the **UTC** calendar date, so the two late ET games (tip 00:10Z / 02:10Z) carry `date=2026-06-25`. Bucketing Playbook by **ET(startTime)** yields the correct 4.
4. **Are BDL source games missing the 4?** No — the games exist, but on the wrong slates. **BallDontLie WNBA games carry no precise tip time** (`seedWnbaGames.ts` comment: "calendar date at midnight UTC (no precise tip time here)"), so `slate_date` is set from BDL's **UTC** date. ET-evening games (tip after 00:00Z) roll to the next slate; prior-night ET games land on today. Confirmed: `POR@CHI` and `ATL@GS` sit on DB `slate_date=2026-06-25` (and a duplicate `POR@CHI` on 06-26 — see note).
5. **Are expansion teams POR/GS mapped correctly?** Yes. The normalizer resolves `Portland Fire`→POR and `Golden State Valkyries`→GS (and SharpAPI's messy forms like `FIRE`, `ATL Dream`, `(W)` suffixes) correctly. Not the issue.
6. **Should the WNBA slate source be refreshed before judging Playbook?** Yes — fix bucketing first. Judging Playbook on the current broken slate understates its coverage (it's actually 4/4).

## Root cause (precise)

`seedWnbaGames.ts` assigns `slate_date` (and a placeholder `game_date` like `23:29:59Z`) from BallDontLie's tip-time-less, UTC-dated game list. Because WNBA slates are ET-anchored, any game tipping after 00:00Z (≈ after 8 PM ET) is mis-dated to the next slate, and any prior-night game tipping before 00:00Z (late ET) appears on today. The fix requires a **precise tip time** — which BDL lacks but **both Playbook (`startTime`) and SharpAPI (`event_start_time`) provide.**

## Recommendation (no code changed here)

1. **Fix WNBA slate bucketing first** (new ticket `o-wnba-slate-bucketing-fix`): hydrate each WNBA game's real tip time from SharpAPI `event_start_time` (already the odds provider) or Playbook `startTime`, then set `slate_date = computeSlateDate("wnba", tip)` (ET). Re-seed/refresh.
2. **Exclude terminal-status games** from "today" (the `NY@LV` FINAL leakage).
3. **Only then** ingest Playbook splits, keyed to the corrected pregame ET slate.
4. Strategy unchanged: Playbook = public splits/context; SharpAPI = per-book odds/+EV/movement/CLV/props. No Playbook field becomes +EV/steam/RLM/Pinnacle/CLV.

## Notes / secondary findings

- **Possible duplicate WNBA rows:** `POR@CHI` appears on both `2026-06-25` and `2026-06-26` DB slates — worth a de-dup check during the bucketing fix.
- **SharpAPI WNBA data is messy:** 7 events for 4 games, with inconsistent team-name strings and duplicate `event_id`s. The normalizer's token fallback absorbs the naming, but SharpAPI dedup needs care if used as the tip-time source.
- This reconciliation is reusable any day: `npx tsx --env-file=.env.local scripts/operator/wnba-slate-reconciliation.ts --date YYYY-MM-DD --official "AWY@HOM,..."`.
