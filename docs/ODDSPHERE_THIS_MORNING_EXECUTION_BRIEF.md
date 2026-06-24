# OddSphere This-Morning Execution Brief

Date: 2026-06-24  
Goal: improve OddSphere quickly without corrupting market data meaning, model claims, or line movement logic.

## Plain-English Decision

Buy the Playbook $99 plan if the cost is acceptable, but do not let anyone wire it directly into production grading or line movement today.

The correct use this morning is:

1. Enable Playbook.
2. Run it in shadow.
3. Use it first for WNBA public splits and MLB context.
4. Keep existing odds/line movement logic stable until the canonical line-source policy is implemented.

This gives OddSphere better data fast without creating fake movement, mixed books, or overclaimed sharp signals.

## What "Prove It" Means

"Prove it" does not mean wait months or be scared to ship. It means every user-facing claim must trace back to data that actually supports that exact claim.

Examples:

- To show public betting splits, we need bet percentage and money/handle percentage from a provider like Playbook.
- To show line movement, we need the same source series over time: DraftKings to DraftKings, FanDuel to FanDuel, or Playbook consensus to Playbook consensus.
- To show +EV, we need fair probability/fair odds and current book odds.
- To show CLV, we need our pick price and a real closing price from the same comparable market.
- To show steam or reverse line movement, we need consistent line history and rules that detect those patterns.
- To show ROI, we need settled tracked bets with stake assumptions and grading rules.

If we do not have the right data yet, the UI can still be useful. It should just say the honest thing: market context, public split, first observed move, consensus line, or model lean.

## Accuracy And ROI

More data does not automatically create better predictions. Better predictions come from:

- Cleaner inputs.
- Consistent market baselines.
- Good model calibration.
- Honest confidence buckets.
- Result tracking.
- Knowing when not to bet.

Playbook can help accuracy by improving context and coverage. SharpAPI can help expected value work by providing sharper market/pricing data. Neither provider alone guarantees ROI.

OddSphere should optimize for a process:

1. Generate picks.
2. Record the exact price/source at pick time.
3. Grade results.
4. Compare confidence bucket performance.
5. Compare against close when closing data exists.
6. Adjust model weights only after enough tracked evidence.

## What To Tell Claude

Send Claude this:

```text
Use docs/ODDSPHERE_PRODUCT_DATA_OPERATING_PLAN.md and docs/ODDSPHERE_THIS_MORNING_EXECUTION_BRIEF.md as the source of truth.

Do not replace SharpAPI with Playbook globally.
Do not wire Playbook consensus lines into sportsbook-specific line movement.
Do not populate steam, reverse line movement, +EV, Pinnacle, or CLV fields from Playbook splits.

First task only:
Build a read-only Playbook shadow client and coverage audit, or add WNBA public splits from Playbook in a clearly separated lane.

Before editing, state:
- data lane affected
- provider used
- UI claim enabled
- tables touched
- rollback path
- exact files expected to change

Avoid editing app/api/lab/daily-edge/route.ts, lib/services/linesService.ts, lib/providers/factory.ts, provider interfaces, or lib/services/wnba/* at the same time as Codex unless we explicitly assign ownership.
```

## Can Codex And Claude Coordinate?

Codex and Claude cannot reliably talk to each other directly unless the user copies messages between us or we use shared repo artifacts.

Use the repo as headquarters.

Recommended coordination files:

- `docs/ODDSPHERE_PRODUCT_DATA_OPERATING_PLAN.md`: strategic source of truth.
- `docs/ODDSPHERE_THIS_MORNING_EXECUTION_BRIEF.md`: immediate execution rules.
- `ops-local/overhaul-todos.json`: separate local HQ task board for this overhaul.
- `docs/ODDSPHERE_CANONICAL_LINE_SOURCE_POLICY.md`: line-source and movement rules.

Every agent should update the Overhaul board before and after work. This is how we avoid duplicate edits and mismatched assumptions.

## This-Morning Build Order

### Step 1: Lock The Rules

Done when:

- Both agents read the two docs.
- Everyone agrees Playbook is shadow/context first, not a global replacement.

### Step 2: Use The Overhaul Board

Done when:

- Current owner is listed for each task.
- No two agents own the same files.
- The local HQ Overhaul board reflects the active ticket state.

### Step 3: Playbook Shadow Audit

Done when:

- A script can fetch Playbook coverage without writing production tables.
- Output includes sport, games, matched games, lines, splits, endpoint errors, and rate usage if available.
- API keys are redacted.

### Step 4: WNBA Splits

Done when:

- WNBA Daily Edge can show public bet and money percentages.
- No Playbook field is treated as +EV, steam, RLM, or CLV.
- Existing WNBA odds/model behavior is unchanged.

### Step 5: Canonical Line Source Policy

Done when:

- Each sport/market has a declared movement source.
- Best available price is separate from tracked movement source.
- Consensus lines are labeled as consensus.

## Today Should Not Include

- Full provider replacement.
- Major model reweighting.
- Public claims about ROI improvement.
- New props UI.
- CLV labels.
- Steam/RLM labels unless separately computed from valid line history.

## Final Recommendation

Yes, buy Playbook if the $99 plan is acceptable and you want the better coverage now.

But the purchase should unlock a clean shadow integration, not a rushed production rewrite. The first production value should be WNBA public splits and MLB context, because those improve the product without disturbing the hardest and riskiest part: consistent odds and movement tracking.
