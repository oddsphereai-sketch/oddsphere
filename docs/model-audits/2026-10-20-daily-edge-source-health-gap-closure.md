# Daily Edge source-health gap closure — October 20, 2026

## Scope

This change set repairs concrete collection and health-verification defects. It
does not add explanatory member copy, manufacture unavailable evidence, change
prediction formulas, or rewrite locked records.

## Repaired defects

### NFL player-props reference evidence

The elapsed-hour production writer could remain anchored outside the old
minute-0-through-14 Pinnacle/NoVig collection window. A current Week 7
zero-write replay proved 390 live reference observations and 115 effective
qualified offers were available while production retained only 59 offers from
two games. Writer r58 refreshes qualified reference evidence from its actual
age at the existing authorized wake, with the existing call ceilings, T-60
capture, sole writer, lease, and immutable-lock rules unchanged. Detailed
evidence is recorded in
`2026-10-20-nfl-player-props-reference-cadence-alignment.md`.

### Competition-aware soccer monitoring

The legacy World Cup health audit queried every `sport=soccer` row, including
EPL and UCL rows in their reserved external-ID namespaces. It also invoked the
retired World Cup schedule provider when no World Cup slate existed. The audit
now excludes club competition namespaces and skips that provider comparison
when the World Cup window has no database games. EPL and UCL remain governed
by their competition-owned coherence, lock, and readiness checks.

### NBA/NHL tracking monitor accuracy

The legacy monitor reported a missing compatibility-route bridge for NBA and
NHL. The actual member Tracking foundation reads their
`prediction_records`/`prediction_grades` through the generic aggregate service;
the warning inspected a retired route and was false. It has been removed
instead of adding a duplicate bridge that could double-count records.

### CFB readiness audit scalability

The current CFB readiness audit still loaded the complete high-frequency
season archive and failed after the archive exceeded its bounded 50,000-row
limit. It now reads the same bounded current game/stage evidence set used by
the sole production writer. The repaired read completed with 874 bounded rows,
96 current games, and 288 market slots. This changes no writer, model, member
snapshot, or stored evidence.

### UCL team identity

BALLDONTLIE currently identifies Viking FK as `VFK`; the presentation registry
contained only `VIK`. The 36-club current registry now resolves `VFK`, while
`VIK` remains a reader alias for already-captured cards. No fixture or model
identity is changed.

## Current read-only health evidence

- NFL: 14 games, 42/42 priced markets, zero Holds, zero missing prices, zero
  empty price trails, and a healthy current snapshot.
- NBA: three games with all nine expected prediction records, current
  Moneyline/Spread/Total lines, and Playbook splits for every matchup.
- NHL: 11 games with all 33 expected prediction records, complete main-market
  lines, and Playbook plus SharpAPI split coverage.
- Soccer: nine games with all 36 expected competition-market prediction
  records.
- CFB: 96 games are present; all 56 FBS-involved games have current odds and
  all 96 have quarterback coverage. The remaining 40 FCS-only games continue
  through the already-repaired paid-provider polling path; the current
  provider probe published no exact FCS betting events, so no synthetic line
  is admitted.
- MLB and WNBA: no games on the October 20 slate.

All reads above were select-only or explicit zero-write provider replays.

