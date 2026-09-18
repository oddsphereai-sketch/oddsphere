# MLB Sharp split display fallback repair

Date: 2026-09-18

## Scope

This is a member-presentation and provider-identity repair only. It changes no
MLB model, calibration, decision, grade, stake, lock, tracking, settlement, or
writer release. The established display hierarchy remains one Sharp Book
Splits card: current complete Circa first, then a current complete DraftKings
pair, then a current complete BetMGM pair. Playbook remains a separate Public
Consensus source.

## Production diagnosis

The read-only September 18 source audit found 15 MLB games. Stored SharpAPI
coverage had complete Circa money-and-ticket values for one game. BetMGM had
ticket shares but no money shares for the other games, so it could not form a
truthful two-sided fallback pair. The independent DraftKings Network feed
returned all 15 games with Moneyline, run line, and Total sections.

Three provider abbreviations did not map to their canonical MLB identities:
`CHI Cubs`, `CHI White Sox`, and `WAS Nationals`. One legitimate DraftKings
Total pair was reported as 100/0. The general source-aware, decision-grade
path correctly continues to reject exact endpoints without sample counts; the
independent DraftKings overlay is display-only and never enters a decision.

## Repair and verification

The shared MLB normalizer now resolves those three exact aliases. The
DraftKings display parser preserves a complementary provider-reported 0/100
pair while continuing to reject out-of-range or non-complementary values.
Fallback rows remain typed internally as DraftKings, are applied only when a
current complete Circa row is unavailable, and are never passed into
`recommendationDecision`.

A real read-only Daily Edge route replay after the repair returned 15 games and
30/30 complete full-game Moneyline/Total Sharp displays, with zero missing
markets. The parser/overlay regression test also proves source priority,
freshness, exact alias matching, two-sided complement validation, and the
display-only boundary. No member-facing copy, label, subtitle, or layout was
added or changed.

Rollback is limited to the three MLB aliases and the independent DraftKings
display endpoint allowance. Stored observations and all prediction releases
remain untouched.
