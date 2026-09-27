# CFB named-book tracking recovery r78

## Scope and predeclaration

- Sport / markets: CFB Moneyline, Spread, and Total official tracking only.
- Sole write path: `runCfbForwardEvidenceWriter` under the existing
  `prediction_pipeline:cfb` lease.
- Previous releases: writer r77 / official tracking r27.
- Candidate releases: writer r78 / official tracking r28.
- Trigger: r77 recovered complete sibling games, increasing the September 26 stored denominator
  from 222 to 249, but five held games remained incomplete. Three had exact immutable BetMGM
  Spread and Total lines in their pregame payloads; two had no stored pregame Spread or Total line
  at any capture.

## Intended behavior

For a held immutable pregame payload with a stored named-book line, replay the exact independent
PMF from the same prior-game inputs and fail closed unless its PMF hash, probability, expected
scores, representative score, and intervals exactly match the stored evidence summary. Evaluate
that verified PMF at the exact stored line and write an accuracy-only No Play record. Do not copy
or reconstruct American odds, edge, EV, recommendation, stake, or ROI.

If no pregame Spread or Total line existed, lock the published Moneyline prediction only. That
includes the game in tracking without inventing an undefined betting contract. Candidate records
are filtered to the exact planned game/market keys before insertion.

This changes no production forecast, probability, score, side, member card, grade, action, stake,
copy, label, layout, or provider collection behavior. Promotion / demotion / actionable / side /
score impact is 0 / 0 / 0 / 0 / 0.

## Verification and rollback

- Focused tests cover verified named-book replay, null economics, line-less Moneyline-only locks,
  unplanned-market rejection, and the existing per-game isolation contract.
- Required gates: focused CFB production tests, TypeScript, lint, `npm run verify:model-change`,
  production build, integration safety, protected PR checks, and live denominator proof.
- Roll back writer/tracking constants to r77/r27 without deleting or rewriting existing records.
