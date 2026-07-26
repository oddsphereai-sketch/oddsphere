# MLB player-prop model audit — 2026-07-26

## Release decision

- Previous release: `mlb_props_2026_07_24_r7`
- Candidate release: `mlb_props_2026_07_26_r9`
- Authoritative writer remains the existing MLB player-props refresh under the shared
  `prediction_pipeline` lease.
- No probability model, grade, or tracking row from an older release is rewritten.
- Locked July 24–25 rows are the untouched forward check.

The audit tested each market separately. It did not apply a universal calibration or flip.
Market-following and opposite-side flips were tested only where two-sided prices existed.
No universal or side-specific flip passed the full live standard, so r9 adds no flip rule.

## Market-by-market disposition

| Market | Historical / forward finding | r9 disposition |
|---|---|---|
| Pitcher strikeouts | Market read improved historical disagreements, but failed one future window and reversed on July 24–25. Current actionables were 2–1. | Unchanged; market-read rule remains shadow-only. |
| Pitcher outs | Compact-core probability calibration improved Brier score, but its selected action policy lost in 2026 and r7 actionables were 2–5. | Probability model unchanged; no new action rule. Continue shadow action-policy work. |
| Pitcher hits allowed | Market beat the raw model historically and on July 24–25, but no priced side rule cleared chronological uncertainty. | Unchanged and non-actionable. |
| Pitcher walks | Neither model-side nor market-side rule was stable. | Unchanged and non-actionable. |
| Pitcher earned runs | Current actionables were 9–11; market-following was inconsistent and unprofitable. | Unchanged pending a dedicated replacement. |
| Batter strikeouts | Two-way sample was too small for a live rule. | Unchanged. |
| Batter hits | Dedicated model was less calibrated than market overall. Qualified unders were 63–34 historically across four positive windows; the July 24–25 strict under sleeve was 8–1. Overs are not universally flipped or removed. | Add an under-only promotion gate when model probability is at least 56%, raw edge at least 10 points, final edge at least 2 points, and final EV at least 1%. Existing player/cluster caps remain. |
| Batter total bases | Market beat the raw model on probability accuracy and added 188 historical disagreement wins plus 13 on July 24–25. Runtime already market-anchors this market. | No second calibration and no new action rule. |
| Batter home runs | Previous 15%–18% promotion band was 148–1,339 historically at about -24.4% ROI and 1–19 on locked July 24–25 rows. A discovery-selected ranked replacement went 23–120 at long odds in the four later windows, +10.10u and +7.1% ROI, with 3 of 4 windows profitable. Its date-clustered 95% ROI interval remained wide at -29.9% to +45.7%. | Remove the failed broad band. Add an up-to-five-per-slate HR Lean sleeve requiring a shrunk season projection of at least 0.08 HR, recent-survival probability of at least 18%, market probability of at least 10%, nonnegative final EV, and prices from +200 through +650. Rank qualified best offers by final EV. No HR Best Angles. |
| Batter RBIs | Market anchoring improved accuracy, but no priced actionable sleeve validated. | Unchanged and watchlist-only. |
| Batter runs scored | Broad qualified unders were 176–123 historically. Bounded final-EV candidates supplied the replacement promotion pool and went 12–6 in the untouched July 24–25 counterfactual. | Add an under-only gate: model probability at least 60%, raw edge at least 8 points, final edge at least 2 points, and final EV at least 1%. |
| Hits + runs + RBIs | Current r7 actionables were 58–30, including overs at 27–11, so overs are preserved. Qualified 1.5 unders were 34–25 across four positive future windows. | Add only the qualified 1.5 under promotion gate; preserve existing overs and unders. |
| Batter singles | Current actionables were 47–25, while broad historical under performance deteriorated late. | Unchanged; no flip or broader promotion. |
| Batter doubles | High under hit rate did not overcome short pricing consistently. | Unchanged and watchlist-only. |
| Batter triples | Two-way actionable evidence was insufficient. | Unchanged and watchlist-only. |
| Batter walks | Unders won often but did not deliver stable priced value; overs were 0–3 on July 24–25. | Unchanged; candidate rules remain shadow-only. |
| Batter stolen bases | Rare-event prices and model probabilities did not yield a stable actionable sleeve. | Unchanged and watchlist-only. |

## Balanced board impact

The new promotion policies are independently defined per market. Portfolio governance adds at
most one validated promotion per game, preserves the two-signal player limit, and does not add
a second hit-production signal for the same player.

On the untouched r7 locked rows from July 24–25, before adding the separately validated HR
replacement sleeve:

| Change | Count | Record | Flat 1u result |
|---|---:|---:|---:|
| Removed HR promotions | 20 | 1–19 | -11.750u |
| Added validated under promotions | 18 | 12–6 | +1.239u |
| Net board change | -2 | — | — |

The exact r7 actionable board was 172–128 over those dates. The counterfactual under-promotion
board is 183–115 with 298 actionables. The HR replacement can add no more than five qualified
Leans per slate; it never fills to a quota when fewer than five qualify. The locked forward
rows do not retain the season-value component required to reconstruct this HR rule, so its
exact July 24–25 board count is not backfilled or guessed.

The chronological historical promotion portfolio produced 104 decisions, went 64–40,
returned +19.092u at flat 1u stakes, and was positive in all four future windows. Its
date-clustered 95% ROI interval was -1.74% to +37.83%, so it remains a Lean-only 0.25u sleeve,
not a Best Angle rule.

## Safety checks

- New immutable release and affected market-version identifiers are stamped.
- Existing writer, refresh cadence, lock policy, and shared lease are unchanged.
- Best-price, player concentration, correlated hit-production, game, lineup, freshness, and
  price gates remain in force.
- `npm run verify:model-change`: passed.
- `npm run test:mlb-props-engine`: 342 passed, 0 failed.
- Clean-worktree `npx tsc --noEmit`: passed.
- Focused ESLint and `git diff --check`: passed.
