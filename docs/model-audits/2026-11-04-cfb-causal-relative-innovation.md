# CFB causal relative-innovation reader — 2026-11-04

## Scope

This candidate removes two production forecast-authority defects:

1. Playbook/public spread splits could reflect the independent PMF across the
   market line before the complete reader ran.
2. The complete reader interpolated 50–75% from the independent margin toward a
   current consensus level, even without a causal price response.

It replaces them with one chronological, target-excluded joint-market ledger.
Named line and price movement is normalized against the independent PMF at each
book's own opening/current contract and is applied at most once per axis. Public
splits are context-only. Exact Owls Circa flow can confirm or veto but cannot
create a point shift by itself.

## Identity and failure rules

- Owls provider, Circa sportsbook and `sharp_adjacent` semantics are required.
- Provider game ID, nonempty provider event ID, pre-evaluation and pre-kickoff
  clocks, 120-minute freshness and a complete relevant market pair are required.
- Spread and Total split evidence must match the evaluated line exactly.
- The evaluated sportsbook family is excluded throughout the historical trail.
- Missing, partial, flat, reversed, bought-back or conflicted evidence leaves the
  corresponding independent axis unchanged.
- One coherent PMF owns expected scores, representative score, probabilities,
  picks and downstream grades.

## Zero-write board observations

Candidate replay (The Odds API disabled): 108 discovered games, 104 proposed
future-unlocked payloads, 176 evaluated markets, 136 held markets; grades were
27 Best Angle / 54 Lean / 72 Watchlist / 23 No Play. Writes and inserts were zero.
Playbook lines/splits returned HTTP 401 in the local credential context; retained
context remained available but was not given forecast or grade authority.

The earlier separate starting-base replay selected a different lifecycle cohort
and therefore was not qualification evidence. The release blocker was closed by
`scripts/operator/audit-cfb-causal-reader-same-input.ts`. One writer capture was
structured-cloned, recursively frozen and SHA-256 stamped per game. The exact
R41/R7 implementation was loaded only by the operator from a clean detached
worktree at predecessor commit `4fcc4129`; the candidate was replayed from the
same frozen objects and was required to be byte-identical to the authoritative
writer result.

The exact comparison covered 103 games /309 market axes, including all 173
evaluated markets and 136 explicitly held markets. Incumbent grades were
21 Best Angle /60 Lean /75 Watchlist /17 No Play; candidate grades were
27 /53 /72 /21. Actionables moved 81 to 80 through eight promotions and nine
demotions, not a quota or hidden flattening. There were zero market additions,
zero removals and held markets remained 136 to 136. The candidate changed 15
sides (two Moneylines and 13 Spreads), 21 game-score distributions, 61 market
probabilities and 33 grades. All 15 side changes crossed favorite/underdog
disposition; no Total direction changed.

Promotions were ARK-AUB Spread, Texas A&M-South Carolina Spread, Penn State-
Washington Moneyline, UCF-Kansas Moneyline, Louisiana Tech-Troy Total, Michigan
State-Michigan Spread, Liberty-New Mexico State Spread and Fresno State-Utah
State Spread. Demotions were Iowa State-Baylor Spread, Old Dominion-Coastal
Carolina Moneyline, Cincinnati-Houston Moneyline, Penn State-Washington Spread,
UL Monroe-Arkansas State Total, Northern Illinois-San Jose State Total,
South Alabama-Louisiana Spread, Louisville-Georgia Tech Moneyline and Fresno
State-Utah State Moneyline. The operator emits every game/market's exact side,
score, probability, grade, favorite/underdog or Over/Under disposition, held
reason and change classification; the reproduced audit artifact is
`/private/tmp/cfb-causal-same-input-report.json`.

The run had zero writes, zero inserts and zero paid Odds API calls. Local
Playbook line/split requests returned HTTP 401, so retained stored Playbook
context was identical in both lanes and remained non-authoritative. Owls and the
named price capture completed without a capture failure. This credential warning
does not invalidate the identical-input comparison, but it is disclosed rather
than described as live Playbook health.

## Tests and locked safety

Focused tests cover public-split PMF/grade neutrality, strict Owls admission,
wrong-game/stale/retail rejection, target exclusion, source conflict, reversal,
one innovation per axis, final-PMF score coherence, paired grade promotion and
demotion, audit-only dependency rejection on writing jobs, authoritative-writer
candidate parity, writer immutability and locked reader precedence. Existing
locked rows retain their exact stored releases and payloads; new semantics apply
only to future-unlocked rows.

## Publication status

Not published. The valid same-input board-impact comparison is complete. Focused
checks, TypeScript, `npm run verify:model-change` and integration safety pass on
fresh production base `1b8a677a`. PR #1014 changed only the cross-sport audit
classifier/operator and its tests/artifact. The complete CFB runtime, focused-test
and same-input-operator tree hash remained exactly
`9445a29d0fa85f1b3ea4688feb887ae96da1db768fbdb5110f24d4a82e4e24a9`
before and after that rebase, so the frozen provider replay remains applicable
and was not needlessly repeated. Rollback is the complete R59/R41/R7 family;
never rewrite a row already locked under either release.
