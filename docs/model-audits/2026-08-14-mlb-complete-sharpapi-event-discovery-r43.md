# MLB r43 complete SharpAPI event discovery

Date: 2026-08-14

Decision release: `mlb_daily_edge_decision_2026_08_14_r43`

Rule bundle: `mlb_daily_edge_rule_bundle_v42_2026_08_14`

Grade policy: `mlb_public_grade_policy_v33_complete_sharpapi_event_discovery_2026_08_14`

## Incident

SharpAPI's aggregate MLB `/splits` payload carried current-date event ids but
prior-slate team pairings. The r41/r42 slate identity guards correctly rejected
that payload. A separate coverage defect remained in price discovery:
the qualifying-opportunity feeds could omit current games at different polls.
Those games retained older prices even though event-scoped `/odds` returned
fresh real-book markets when queried by the scheduled matchup identity.

## Change

The authoritative SharpAPI odds provider now builds event discovery from the
union of `/opportunities/ev` and `/opportunities/low_hold`, then compares that
set with every scheduled database game. Any missing game is queried through the
existing deterministic SharpAPI event-id candidate generator across team order,
provider mascot aliases, and market buckets. Existing sport, slate-date,
team-identity, doubleheader, alternate-line, and player-prop guards remain
mandatory. `/splits` remains enrichment-only and its rejected payload cannot
populate prices, splits, predictions, or grades.

## Live evidence before release

- Direct event-scoped `/odds` probes returned current timestamps and real-book
  prices for today's verified event ids.
- The pre-completion same-code operator refresh wrote 312 current line rows but
  explicitly preserved unresolved scheduled games.
- The completed r43 operator refresh resolved all 14 scheduled games and wrote
  411 current line rows. Every game refreshed moneyline, total, and spread;
  unresolved games, preserved gaps, call-cap skips, rejected rows, and write
  failures were all zero.

## Board impact and safety

This is a missing-input recovery, not a new promotion or demotion threshold.
It does not manufacture public/sharp percentages and does not relax price
freshness. Existing tested promotion and demotion rules re-evaluate only after
both real sides are present. Board-count impact is therefore data-dependent and
must be reported from the post-deploy slate cycle; no hidden quota is applied.

## Required validation

- `npx tsx scripts/test-opportunities-discovery.ts`
- `npx tsx scripts/test-sharpapi-provider.ts`
- `npm run verify:model-change`
- Production slate refresh followed by live release, price coverage, split
  identity, grade coherence, and reader verification.
