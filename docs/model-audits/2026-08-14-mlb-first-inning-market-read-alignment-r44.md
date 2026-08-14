# MLB r44 first-inning Market Read alignment

Date: 2026-08-14

Decision release: `mlb_daily_edge_decision_2026_08_14_r44`

Rule bundle: `mlb_daily_edge_rule_bundle_v43_2026_08_14`

Grade policy: `mlb_public_grade_policy_v34_first_inning_visible_market_read_alignment_2026_08_14`

## Incident

The member reader correctly displayed same-book, two-sided NRFI/YRFI price
history, but the Market Read alignment helper explicitly skipped first-inning
markets. The pulse could therefore retain a Market Intelligence snapshot from
a different sportsbook while the visible movement tracker showed the selected
side at the board's verified sportsbook. Live examples included a neutral read
beside a displayed NRFI move from -120 to -114, which is resistance under the
existing implied-probability movement threshold.

## Change

The reader now selects NRFI or YRFI from `fiMarketBoard` according to the
published pick and passes that exact open/current pair through the existing
visible-odds classification helper. The expanded Line Move row consumes that
same selected-side board trail. No threshold, source priority, model input,
prediction side, probability, projection, stake, writer, cron, or lease is
changed.

## Board impact and safety

Authoritative `prediction_records` continue to own the published pick and
grade. The paired reader comparison has zero promotions, zero demotions, and
zero changes to Moneyline or Total markets. The change corrects first-inning
Market Read labels and displayed movement evidence only. Missing or invalid
two-sided 0.5-run markets retain their existing fail-closed behavior.

## Validation

- `npm run test:lab-daily-edge`
- `npx tsx --env-file=.env.local scripts/test-edge-stack-rows.ts`
- `npm run verify:model-change`
- TypeScript and production build
- Post-deploy release coherence, shared-lease cron health, odds/stat coverage,
  reader snapshot freshness, and live NRFI/YRFI Market Read verification

Rollback is the exact r43 commit and its reader snapshot. Historical locked
rows remain immutable.
