# MLB Owls provider cutover — October 28, 2026

## Scope

This release removes SharpAPI from the active MLB slate-cycle odds and splits
path. It does not change the internal Market Reader algorithm; that work remains
owned by its separate release. The affected forward-only identifier is:

`mlb_market_input_snapshot_v5_owls_provider_cutover_2026_10_28`

Locked member snapshots remain byte-for-byte authoritative. Historical rows
whose provenance says `sharpapi` remain readable and are never relabeled.

## Source contract

- Current game prices: Owls `/api/v1/mlb/odds`.
- Opening prices: Owls `/api/v1/history/odds?opening=true`, requested once only
  for games without an existing opener.
- Named-book splits: Owls `/api/v1/mlb/splits`, with Circa, DraftKings, then
  BetMGM preference.
- Public consensus: Playbook remains separate and unchanged.
- Canonical schedule and exact game identity: BallDontLie/database slate.

Only complete coherent two-sided same-book ML/spread/total pairs enter current
lines. Pinnacle supplies the no-vig fair reference for matching book/market/line
tuples. A missing reference remains null. Steam and RLM are not inferred from
splits. Missing handle percentage remains null. Exact 0%/100% split endpoints
without sample counts remain unavailable to the decision layer.

## Safety and no-write evidence

The October 28 production rehearsal used live Owls and read-only production DB
access with `dryRun=true`:

| Check | Existing | Owls candidate |
|---|---:|---:|
| Canonical MLB games | 1 | 1 exact match |
| Games with moneyline | 1 | 1 |
| Games with total | 1 | 1 |
| Games with spread | 1 | 1 |
| Current game-line rows | 10 | 42 |
| Distinct Owls books | — | 7 |
| Rejected database-bound rows | — | 0 |

The seven candidate books were BetMGM, Bovada, Caesars, DraftKings, Hard Rock,
NoVig, and Pinnacle. The provider returned one event fragmented into seven
book buckets; the adapter coalesced them to one event before reconciliation.

The live splits response was explicitly partial (`book_unavailable`). It
contained a coherent BetMGM ticket split for ML and Total but no handle split.
The adapter produced four rows with ticket percentages and null money
percentages. It did not fabricate a complement or carry an old SharpAPI handle
percentage into the new Owls observation.

The current prediction board contained three unlocked rows (Moneyline, Total,
First Inning), with grades `market_aligned`, `provisional`, and `toss_up`.
There were zero actionable `BEST_ANGLE`/`LEAN` rows before the write.

A separate read-only candidate replay ran the same October 28 feature snapshot
through the incumbent model with stored market inputs and then with the Owls
candidate lines/splits. The sole game retained its Moneyline side and its
Moneyline/Total `provisional` grades. The Total forecast changed from Over to
Under as its market input moved from the stored board to the current Owls board;
the projected total moved from 6.961 to 6.523. Therefore the measured impact is
0 actionable promotions, 0 actionable demotions, 0 actionable-count change,
0 Moneyline-side changes, and 1 unlocked Total-side change. No locked row was
used or mutated. The replay is reproducible with
`scripts/operator/audit-mlb-owls-provider-cutover.ts --date=2026-10-28`.

This release adds no promotion or demotion rule. Any later Market Reader
semantic change requires its own paired replay and release.

## Rollback

Rollback restores the prior deployment commit and market-input identifier for
future unlocked rows only. It must not restore outbound SharpAPI calls because
that subscription is canceled. The safe operational rollback is to preserve
last-known-good current lines/splits and hold new unlocked publication until
Owls recovers. Locked records and already captured history are never deleted or
rewritten.
