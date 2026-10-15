# NBA market-reader readiness audit r1

Date: 2026-10-15  
Starting production base: `2ade2c2efd3c1a593e862a269573e32db59bd06c`

Status: read-only audit tooling. This change cannot alter a prediction, projected
score, side, probability, grade, stake, lock, tracking result, member card, or
provider refresh. It does not create another reader or writer.

## Purpose

NBA now captures current per-book SharpAPI splits through the shared Market
Intelligence v2 writer. Capture alone is not validation. The audit reports the
evidence the shared resolver can actually use for the selected NBA quote and
keeps the following concepts separate:

- exact-line, same-book two-sided price evidence;
- first-tracked versus provider-opener status;
- same-book number/price movement versus cross-book differences;
- Playbook consensus versus named SharpAPI source books;
- ticket-plus-money rows versus ticket-only rows with money left null;
- source-observed time, fetched time, freshness, and post-start rejection;
- directional support, resistance, unavailable evidence, and rejected evidence.

The operator is:

```bash
node --import tsx --env-file=.env.local \
  scripts/operator/nba/audit-nba-market-reader-readiness.ts \
  --date 2026-10-20
```

It reads the current slate, Market Intelligence v2 split/price observations,
and existing NBA prediction records. It evaluates the official Moneyline and
Total selections with the shared resolver and separately reports observation
coverage for Moneyline, Spread, and Total. Spread remains context-only.

## Safety boundary

Every result remains observation-only. The report hard-codes zero prediction
and grade authority because NBA-specific thresholds have not cleared a complete
point-in-time settled replay. Missing evidence is unavailable, not neutral
confirmation. Cross-book quotes cannot manufacture movement, ticket-only rows
cannot manufacture handle, first-tracked prices cannot be called openers, and
existing locked payloads are never queried for mutation or reconstructed.

## Validation gates still required

1. Repeated forward captures must prove event, selection, source-book, exact-line,
   timestamp, and freshness coverage through opening night.
2. Settled replay must compare model-only, support, resistance, and disagreement
   cohorts at the exact decision timestamp and price.
3. Any proposed correction needs paired corrections/harms, Brier/log loss,
   margin and Total MAE, ATS/Total direction, exact-price return, promotions,
   demotions, and board-count impact.
4. A candidate may affect future unlocked predictions only under a separately
   versioned model/market/grade release with immutable-lock tests and the full
   model-change safety suite.

Until those gates clear, the independent NBA model remains authoritative and a
missing or conflicting market read cannot silently promote a play.
