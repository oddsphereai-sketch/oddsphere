# MLB props compact member-board pairing — 2026-07-24

- Previous release: `mlb_props_2026_07_23_r5`
- Candidate release: `mlb_props_2026_07_24_r6`
- Scope: MLB player-prop compact member reader only.

## Problem

The initial member payload bounded the board by selecting individual price rows.
The UI groups those rows by player, market, and line, so an available over/under
pair could be split during compaction and the omitted side was then labeled
`Not offered`.

## Candidate behavior

The compact reader selects complete player/market/line groups atomically. It:

- keeps the existing 600-row hard ceiling;
- preserves complete over/under pairs when both sides exist;
- preserves genuinely one-sided milestone and provider offers;
- prioritizes actionable groups without changing their grades, probabilities,
  projections, prices, or stakes;
- keeps posted markets discoverable and retains broad player coverage; and
- adds no provider calls, database reads, writers, retries, or cron work.

The canonical board writer, shared `prediction_pipeline` lease, locking,
tracking, settlement, provider ingestion, model versions, calibration, and
market scoring remain unchanged.

## Shadow comparison

Read-only replay against canonical snapshot
`edc5811b-6dec-4648-bcd9-b61b15ac7460`, locked to
`2026-07-24T11:17:07.442Z` and stamped
`mlb_props_2026_07_23_r5`:

| Metric | Previous selector | Candidate selector |
| --- | ---: | ---: |
| Serialized rows | 600 | 600 |
| Market groups | 600 | 345 |
| Complete over/under pairs | 0 | 255 |
| Displayed one-sided groups | 600 | 90 |
| False `Not offered` groups | 501 | 0 |
| Players represented | 325 | 325 |
| Markets represented | 16 | 16 |
| Actionable rows | 195 | 195 |
| Serialized bytes | 1,248,961 | 1,239,477 |

Actionable row identity was unchanged: four Best Angles and 191 Leans in both
selectors. Promotions: 0. Demotions: 0. Net actionable-board change: 0. The
candidate adds the non-actionable counterpart rows already present in the
canonical snapshot; it does not recalculate or regrade them.

## Verification required before deployment

- Run `npm run test:mlb-props-launch`.
- Run `npm run verify:mlb-props-engine`.
- Run `npm run verify:model-change`.
- Verify the next published snapshot reports
  `mlb_props_2026_07_24_r6`, remains under the member payload limit, and is
  published by the existing leased refresh path.

Until those checks and post-deployment live proof succeed, this is a candidate
release and must not be described as live.
