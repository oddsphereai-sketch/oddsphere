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

The exact starting-base replay used the same external providers but selected a
different lifecycle cohort: 103 payloads / 173 markets, with 21 / 58 / 77 / 17
and 136 held. Because the cohort and capture stage differed, these numbers are not
represented as a same-input promotion/demotion comparison. Candidate and base had
81 and 79 actionables respectively, but that apparent delta is not qualification
evidence.

## Tests and locked safety

Focused tests cover public-split PMF/grade neutrality, strict Owls admission,
wrong-game/stale/retail rejection, target exclusion, source conflict, reversal,
one innovation per axis, final-PMF score coherence, paired grade promotion and
demotion, writer immutability and locked reader precedence. Existing locked rows
retain their exact stored releases and payloads; new semantics apply only to
future-unlocked rows.

## Publication status

Not published. Focused checks and `npm run verify:model-change` pass. A valid
same-input board-impact comparison remains the release blocker. Rollback is the
complete R59/R41/R7 family; never rewrite a row already locked under either
release.
