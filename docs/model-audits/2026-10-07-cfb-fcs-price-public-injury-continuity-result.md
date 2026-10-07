# CFB FCS price and official-injury continuity — result

Date: 2026-10-07

## Decision

Promote the bounded price-continuity and official-report display release. It restores provider-
verified line-specific context for the covered FCS board without inventing sportsbook economics,
changing member copy, or flattening the actionable board.

## Provider hierarchy

1. Paid BALLDONTLIE named books.
2. Exact-event SharpAPI named-book quotes, within a bounded 32-game writer budget.
3. CollegeFootballData DraftKings/Bovada rows for FCS-only gaps, one season/week request at most
   every six hours.
4. Existing bounded ESPN behavior remains unchanged for FBS-only gaps.

A lower tier fills absence only. It cannot replace an already-selected same named book from a higher
tier during the same capture. Stored verified same-book observations survive a provider omission,
and a later higher-priority observation silently resumes authority. Novig and SX Bet exact-event
pairs from the paid Sharp feed are a separate context-only lane: they may provide the line used for
a prediction, but cannot enter sportsbook consensus, canonical anchors, grading, actionability,
movement arbitration, or opening-price authority. Kalshi and Polymarket remain excluded.

## Exact live-provider zero-write replay

Audit boundary: `2026-10-07T20:00:00.000Z`, board window October 6–12, 88 existing board games,
89 writer games, 88 proposed payloads, and **0 writes**.

| Scope | Games | Before paired ML / spread / total | After paired ML / spread / total | Before line predictions | After line predictions |
| --- | ---: | ---: | ---: | ---: | ---: |
| FBS involved | 57 | 57 / 57 / 57 | 57 / 57 / 57 | 57 / 57 / 57 | 57 / 57 / 57 |
| FCS only | 31 | 2 / 1 / 0 | 2 / 1 / 0 | 31 / 1 / 0 | 31 / 14 / 29 |

The recovered FCS line contexts remain 0 evaluated / 93 held before and after. An exchange line does
not create sportsbook consensus, a Lean, or a Best Angle. Source-scoped candidate impact is therefore **0
promotions, 0 demotions, and 0 actionable-count change**. The full time-separated live replay also
observed ordinary FBS price/grade movement; those changes were not caused by the FCS-only CFBD/Sharp
fallback and are not claimed as candidate improvements.

SharpAPI supplies exact-event Novig/SX context for 29 FCS games. Twenty-nine now have a provider Total
line and fourteen have a provider Spread line. CFBD's true provider open/current Spread and Total
lines are also retained as context; because CFBD does not publish Spread/Total prices, no opening
price is fabricated. Paired sportsbook price coverage remains unchanged and honest.

## Remaining upstream gaps

Two FCS games still lack an acceptable provider Total line and seventeen lack an acceptable provider
Spread line. Those slots remain line-unavailable rather than receiving a manufactured line or -110
price. SharpAPI matched the exact events and the writer will retry on its ordinary cadence; a later
conventional book silently supersedes exchange context through the existing hierarchy.

## Injury continuity boundary

The official SEC, ACC, Big Ten, and Big 12 endpoints matched three exact current-board reports in the
audit. Playbook remains primary; official data fills only absence; failure or omission retains the
last verified report with its original timestamp. `Available`/`Exempt` full-roster rows are removed,
and a missing player never implies health.

Official conference rows are display evidence only in this release. Audit found that treating a
single `Questionable` quarterback as an automatic three-market grade cap would demote the board
without recomputing the score projection. That behavior was rejected. A future injury-model release
must quantify the expected replacement contribution, rebuild the score distribution, and validate
paired promotions and demotions before official rows can alter picks.

## Request and safety bounds

- CFBD: exactly one request per due run, six-hour cadence, projected maximum 124 per 31-day month,
  well below the 1,000-call free tier.
- SharpAPI: maximum 32 deficient exact games in one writer run, inside the existing 192-request
  provider ceiling; no unbounded loop.
- Official reports: four bounded conference requests, six-hour normal cadence and hourly only inside
  the final three hours before kickoff.
- Sole writer and `prediction_pipeline:cfb` lease are unchanged. Locked payloads remain immutable.
- `CFBD_API_KEY` is stored as a sensitive production environment secret and is not committed.

## Verification

- Focused FCS price/injury parser, Sharp exchange-isolation and hierarchy tests: pass.
- TypeScript no-emit validation: pass.
- Complete CFB production suite: pass, including weekly engine, exact-price decisions, market/sharp
  arbitration, cross-market coherence, SharpAPI odds/splits, weather, confidence, and member contract.
- CFB current-odds, evidence-capture, member-reader, and official tracking tests: pass.
- The broader football member-snapshot test could not run in this task worktree because its ignored
  NFL research pointer is absent; the failure occurs before exercising CFB code and is not treated as
  candidate evidence.

Repository-wide model-change verification and the supported Next.js webpack production build pass.
Production publication still requires current-main integration safety, protected pull-request checks,
merge, natural writer refresh, and live release/coverage/reader verification.

## Rollback

Revert the full CFB r36/r50/r29/r41/r103/r76/r66/r36/r21/r38 release family and remove the optional
CFBD route input. Preserve all immutable prior lock and tracking rows. The sensitive environment
secret may remain unused or be removed separately.
