# MLB r65 price-coherence and availability audit

Date: 2026-08-21

Status: candidate; no publication from this worktree
Starting base: `fc4e02fe00dbdd2d87f6eb10e8c1740a56208cb3`

Integrated current-main base: `13db2aaf8050269acdb3e899cb979fa8cdb1f21a`

## Incident and cause

At 2:14 p.m. ET, the unlocked CLE@COL Moneyline record carried a 65.0% away-win
probability and was evaluated at BetRivers -210. The reader separately showed a
fresh Saba -161 quote. The writer had recomputed at 18:14:33Z, but its price
selector chose the first fresh sportsbook in trust-priority order. BetRivers' row
was 68 minutes old and still inside the writer's 90-minute ceiling; Saba -161 and
Bally Bet -175 were captured at 18:13:13Z. The visible card therefore combined a
fresh price with an action decision made at a different quote.

The candidate retains the existing market-anchored Moneyline probability head and
all side-selection rules. For unlocked Moneylines only, it now evaluates the stored
recommendation at the shared best-playable-price policy: a price must be fresh
within 60 minutes, have the opposite side at the same sportsbook, carry plausible
hold, remain within four percentage points of the multi-book no-vig center, and be
corroborated by at least two eligible sportsbook pairs. A single sportsbook cannot
establish its own truth. T-60 and already locked records remain immutable.

Price shopping is not a newly authorized promotion sleeve. r65 records the
priority-market baseline and the current evaluation book, price, and timestamp,
and caps any action that would be created only by the new quote. Existing actions
may retain their grade at a better coherent quote. This preserves the distinction
between outcome confidence (for example, Cleveland is the likely winner at 65%)
and the price-sensitive bet grade. Outcome confidence is not a Lean, a parlay
recommendation, or evidence that any price is acceptable.

## Locked chronological evidence

`scripts/operator/audit-mlb-best-playable-price.ts` is read-only. It selected only
rows stamped with the current Moneyline probability head, then reconstructed the
last 60 minutes of two-sided `line_history` before each lock.

- Window: 2026-08-15 through 2026-08-20.
- 72 source rows; 72 unique game-lock observations; zero duplicate weighting.
- 43 locks had enough history to reconstruct a coherent price.
- Nine had at least a 1.0 percentage-point break-even improvement.
- Those nine went 6-3, +1.208 units, 13.42% ROI; calibration gap -9.29pp.
- The six historically nonactionable rows in that sparse cohort went 4-2,
  +0.678 units, 11.30% ROI; calibration gap -9.10pp.

That six-row cohort is too sparse and post-selected to authorize a new action
rule. It supports fixing the quote tuple, not force-promoting plays. Probability
Brier/log loss are unchanged because r65 does not alter probability output.

## Current-board paired comparison

Production main and the candidate were run read-only against the same August 21
input state. Both produced 45 records and the same action distribution: 16 actions
and 29 nonactions. Promotions: zero. Demotions: zero. The only candidate-owned
Moneyline differences were current evaluation prices:

- DET@KC -121 to Saba -118, No Play retained.
- CLE@COL -175 current priority baseline to Saba -161, No Play retained because
  the independently validated SharpAPI money-below-tickets resistance remained.
- PIT@LAD -265 to Saba -263, No Play retained.
- TB@BAL -136 to Saba -133, existing Best Angle retained.

No First Inning probability, side, price policy, or grade changed in r65. The
active FI head remains `mlb_first_inning_fi_v4_market_backed_weight25_2026_08_20`.

## Availability repair

The Playbook MLB report for August 21 declared `reportDate=2026-08-19`, was over
62 hours old, labeled all 282 players `Out`, and mapped only 93 players to the
current roster. It remains rejected; freshness was not loosened.

When Playbook is missing, stale, implausible, or incomplete for the requested
matchups, the supplementary availability service now falls back to MLB's official
40-man roster endpoint. Calls are bounded to six concurrent teams, 2.5 seconds per
request, and the existing route cache is versioned for 15-minute reuse. Only
explicit MLB injured-list status codes are displayed; active and reassigned-minor
players are excluded. The response identifies the official fallback, verification
time, and fallback reason. CLE@COL returned three Cleveland and ten Colorado
official injured-list entries in the live read-only verification.

Availability remains explanatory context. It changes no projection, probability,
side, grade, stake, or model input.

## Consolidation-owned reader and shared-type contract

This candidate deliberately does not edit the cross-sport reader or shared lab
types. Consolidation should apply the following presentation contract:

- Label the model win probability as **Outcome confidence**. It may identify the
  likely winner, but it must not be labeled Lean, Best Angle, or a parlay
  recommendation.
- Label `play_grade`/`prediction_type` and actionability as the **Bet grade**.
  This remains price-sensitive, including for parlays.
- Treat the writer record's `odds_american` plus
  `snapshot_json.ml_evaluation_price.evaluated` book/time as the authoritative
  evaluation tuple. A newer visible quote may be shown separately as current
  market context, but must not silently regrade the record in the reader.
- Extend the shared availability DTO to accept source `MLB Stats` plus optional
  `providerHealth`, `fallbackReason`, and `verifiedAt`. Render the official-source
  fallback and its verification time honestly; never relabel it as Playbook and
  never display the rejected stale/all-Out report as current.

## Release identifiers

- Calibration: `mlb_public_calibration_v25_coherent_playable_price_2026_08_21`
- Decision: `mlb_daily_edge_decision_2026_08_21_r65`
- Rule bundle: `mlb_daily_edge_rule_bundle_v53_2026_08_21`
- Grade: `mlb_public_grade_policy_v43_coherent_playable_price_2026_08_21`
- Probability heads: unchanged.

Rollback is r64/v52/v42/v24. Locked historical rows remain immutable.
