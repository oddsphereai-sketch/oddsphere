# NBA split fallback team-identity repair predeclaration

Date: 2026-10-16

## Scope

- Sport: NBA.
- Markets: Moneyline, Spread, and Total split evidence for future unlocked games.
- Provider path: the existing leased Market Intelligence V2 collection inside
  `public-splits-observations-refresh`.
- Reader/model path: the existing NBA professional market reader and unified
  projection; no new reader, writer, timer, provider call, coefficient, threshold,
  grade rule, stake, lock rule, or member label.
- Starting production base: `5aa54e8f8c804b72ef0f3a6a14d0a70c1bb98088`.
- Sole prediction writer/lease: the existing NBA writer under
  `prediction_pipeline:nba`.

## Confirmed defect

The NBA games table uses ESPN abbreviations for six teams (`GS`, `NO`, `NY`,
`SA`, `UTAH`, and `WSH`), while the shared NBA identity registry emits the
canonical abbreviations `GSW`, `NOP`, `NYK`, `SAS`, `UTA`, and `WAS`. The
SharpAPI split collector normalized provider names but compared them with raw
database abbreviations. It therefore rejected exact-date provider rows for any
matchup containing one of those six teams.

On the October 20 opening slate, the provider returned complete DraftKings
Moneyline, Spread, and Total pairs for BOS-DET, PHI-NY and OKC-SA. The stored
V2 evidence contained DraftKings and BetMGM rows for BOS-DET, while PHI-NY and
OKC-SA contained Playbook rows only. The fallback rows for the latter two games
were being rejected before storage.

## Candidate

1. Add explicit ESPN abbreviation aliases for all six mismatched NBA teams.
2. Canonicalize both the stored-game side and provider side before exact
   date-plus-matchup comparison in current-slate, rolling-window, alignment,
   and per-game collection maps.
3. Preserve strict league, exact event date, exact away/home orientation, and
   unique event identity. Unknown names still fail closed.
4. Advance the Market Intelligence V2 NBA capture release. If a zero-write
   same-input rehearsal proves that restored rows can change an unlocked final
   forecast, advance every affected NBA reader/marriage/model release in the
   same candidate before publication.

## Required proof

- Full 30-team database abbreviation-to-canonical identity test.
- Exact October 20 rolling-window provider-row selection test covering all
  three games and all six affected aliases.
- Credential-backed, read-only provider/capture rehearsal showing complete
  available rows map to the correct canonical games.
- Same-input board comparison reporting side changes, promotions, demotions,
  actionables, and score changes.
- Focused identity/capture/NBA tests, TypeScript, `npm run verify:model-change`,
  latest-main integration safety, protected PR checks, and post-deploy live
  split coverage/reader/lock verification.

Locked member snapshots remain immutable and retain exact stored precedence.
The repair applies only to new evidence and future unlocked computations.
