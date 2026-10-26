# NFL complete-signal semantic interpretation — owner-directed result

Date: 2026-10-26

Status: qualified for future-unlocked publication only after the repository and live gates below pass.

## Owner correction to the frozen candidate

The frozen full-game-arbiter predeclaration proposed low-capacity numeric/mixture candidates. The
owner rejected that framing: Oddsphere must not average an independent forecast and a sportsbook
baseline, assign a universal market weight, or reduce market reading to one more conjunction of
thresholds. The accepted candidate is therefore semantic. It interprets the complete game story and
selects a coherent existing forecast or an explicitly understood winner/cover regime; it never blends
scores with a scalar market weight.

The settled outcomes were already open while this semantic candidate was refined. The figures below
are an owner-directed provisional repair audit, not a pristine holdout or a claim that every future
game will be correct.

## Closed defect

The preceding ledger's `allUsableAccounted` flag proved only that a signal was routed to an arbiter.
It did not prove that the arbiter interpreted the signal. The candidate now creates exactly one
auditable interpretation record for every captured signal, including unavailable and stale
provenance. Each fresh signal receives one or more explicit roles:

- coherent independent or player-aware forecast;
- current target-excluded market state;
- originating named-book price discovery and retail follow-through;
- price resistance, number/price divergence, reversal, or buyback;
- key-number transition;
- qualified flow confirmation or disagreement;
- observed but unqualified flow context;
- availability/weather context and the observed report-versus-market sequence; or
- non-directional conflict/data quality.

The availability sequence is not falsely labeled causal. Injury availability alone never adds or
subtracts fixed points. The complete interpretation record explains whether and how the observation
affected the side story, Total story, context, or data-quality state. A build/test gate fails if any
captured or usable signal lacks an interpretation reference.

## Frozen-ledger result

On the same 59-game checksum-matched ledger used by the released joint side reader:

| Measure | Released | Candidate |
| --- | ---: | ---: |
| Moneyline projection | 35-23-1 | 35-23-1 |
| Moneyline Brier | 0.23564 | 0.23044 |
| Spread projection | 25-32-2 | 31-26-2 |
| Spread +3 | 33-25-1 | 38-20-1 |
| Spread +6 | 41-18 | 44-15 |
| Total projection | 37-22 | 37-22 |
| Team-score MAE | 6.5154 | 6.4345 |
| Margin MAE | 8.9605 | 8.5297 |
| Total MAE | 9.4960 | 9.4960 |
| Actionables | 38 (28-10, +15.53u) | 39 (32-7, +22.39u) |

The candidate makes six Spread projection corrections and zero harms in this opened ledger. Exact
Spread decisions improve from 20-18-2/+0.96u to 25-13-2/+10.73u. It demotes one losing Moneyline Best
Angle, promotes two winning Spread Watchlists to Lean, and adds one net actionable. Moneyline winner
and Total direction are preserved. The selection chronology improves Spread from 13-14-1 to 17-10-1;
the later confirmation block improves 7-5 to 8-4. These partitions constrain the audit but are not a
pristine prospective validation because the owner-directed refinement occurred after outcomes were
available.

## Publication and immutability contract

Only future-unlocked payloads may use the complete-signal interpreter. Stored locked projections,
probabilities, representative scores, sides, prices, grades, stakes, and evidence remain exact stored
authority. The same sole NFL forward writer and `prediction_pipeline:nfl` lease remain authoritative;
no second writer, shadow model, or parallel member product is introduced.

Publication requires:

1. focused full-game, writer, fixture, snapshot, tracking, and lock-precedence tests;
2. TypeScript and `npm run verify:model-change`;
3. the model/calibration/decision/grade/member/writer/fixture/snapshot registry update in the same
   commit;
4. latest-main integration safety and protected pull-request checks; and
5. post-deploy proof of the live release, fresh price history, complete signal interpretations,
   coherent scores/picks, and unchanged locked rows.

## Rollback

Restore the r34/r33/r42/r39 joint-side family for future unlocked rows. Never rewrite or reinterpret
an existing locked payload. The complete ledger and interpretation diagnostics remain audit evidence.
