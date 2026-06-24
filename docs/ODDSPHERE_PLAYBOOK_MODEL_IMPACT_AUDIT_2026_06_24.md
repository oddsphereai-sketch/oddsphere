# Playbook Model Impact Audit — MLB 2026-06-24

Status: first-pass read-only audit  
Date: 2026-06-24  
Tool: `scripts/operator/playbook-model-impact-audit.ts`  
Ticket: `o-playbook-model-impact-audit`

## Purpose

Measure how replacing current SharpAPI public split fields with Playbook public split fields could affect OddSphere's market-signal and grade path before any production wiring.

This audit is read-only. It does not write `sharp_signals`, `game_predictions`, grades, UI fields, tracking rows, or line movement.

## Scope

Initial scope is MLB moneyline and total markets for the 2026-06-24 slate.

The audit:

- Loads current OddSphere games, predictions, grades, and `sharp_signals`.
- Loads Playbook MLB public splits.
- Matches Playbook games to OddSphere games.
- Replaces only public bet/money percentages in a simulated signal source.
- Re-runs pure `deriveMarketSignal` and `deriveGrade` for comparison.
- Simulates the `prediction_records` Best Angle public-money conflict guard.

It does not write or mutate Daily Edge ordering, Best Angle selection, locked prediction records, or tracking rows.

## Result

Command:

```bash
npx tsx --env-file=.env.local scripts/operator/playbook-model-impact-audit.ts \
  --sport mlb \
  --date 2026-06-24 \
  --out ops-local/playbook-model-impact-mlb-2026-06-24.json
```

Artifact:

- `ops-local/playbook-model-impact-mlb-2026-06-24.json`

Summary:

- DB games: 16
- Playbook games matched: 16
- Markets audited: 32
- Public percentage changes: 32
- Market-signal changes: 1
- Grade changes: 2
- Public-money conflict guard changes: 10
- Best Angle demotions: 0
- Best Angle possible restores: 10
- Missing Playbook matches: 0

## Interpretation

Playbook public splits differ materially from the current SharpAPI-backed public fields on every audited market, but the production-like market-signal/grade path changed on a small subset of ML/total markets in this pass.

The changed grade cases were public-smoke related. That is the expected risk area: public splits can change `public_smoke`, which can change user-facing grade/verdict behavior. This confirms the model-impact gate is necessary before promotion.

The Best Angle public-money conflict guard did not produce any Playbook-driven demotions on this slate. It did produce 10 possible restores where current public-money conflict is present but the Playbook overlay would remove that conflict. These are not automatic promotions because line-movement confirmation, base eligibility, totals divergence, and other guards can still suppress Best Angle. They are review candidates.

## Guardrails Confirmed

This audit did not treat Playbook as:

- +EV
- steam
- reverse line movement
- Pinnacle agreement
- CLV
- sportsbook line movement

Playbook was used only as public bet percentage, public money/handle percentage, `booksUsed`, and matched game context.

## Next Work

Before production promotion:

1. Add verdict / Daily Edge ordering comparison.
2. Run across multiple MLB slates.
3. Repeat for WNBA after user-facing Step A is deployed and stable.
4. Keep Playbook disabled from production MLB grade influence until the audit results are reviewed.
