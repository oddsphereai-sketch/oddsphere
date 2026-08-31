# CFB Playbook event-identity repair result

Date: 2026-08-31
Starting production base: `0f6b4ab9eab872f417f8def81aeba15e208b89a2`

## Result

The writer's old exact-full-name comparison discarded valid Playbook public-consensus rows when
the two providers used different official school forms. Direct read-only reconciliation proved
that 10 of the 11 missing FBS-involved games were in both current 103-row Playbook endpoints.

The release binds each observed variant to its exact BALLDONTLIE team ID. A match additionally
requires the correct home/away orientation, kickoff within three hours, one unambiguous Playbook
game ID, and the identical game ID across the line and split endpoints. It does not use mascot-only
or fuzzy matching. Conflicting IDs and one-sided endpoint availability fail closed.

## Current-slate paired replay

At `2026-08-31T15:52:41.703Z`, coverage changes as follows:

- FBS-involved games: 87
- Playbook line/split rows: 103 / 103
- old exact-name matches: 76
- repaired strict-identity matches: 86
- legitimately unpublished: HAMP@MD only
- recovered: SHSU@TROY, UALB@BUF, NICH@KSU, HCU@RICE, ME@APP, YSU@UK,
  CIT@CLT, ALCN@USM, SELA@USA, and LIU@KU

Holding the current stored books, Circa evidence, football baseline, thresholds, and exact-price
rules fixed, the 165 comparable markets remain 13 Best Angles / 30 Leans / 76 Watchlists / 46 No
Plays. There are zero promotions, zero demotions, zero side changes, and 43 actionables before and
after. The newly available public evidence is neutral on this capture. That zero delta is not a
goal or quota; a later non-neutral verified row can adjust the authoritative PMF through the
existing bounded public-input path.

## Safety boundary and rollback

The release adds no request, endpoint, writer, table, reader override, threshold, grade, stake, or
copy. Circa keeps priority. Missing Playbook data remains unknown and contributes zero adjustment.
Locked and started rows retain their immutable r46 tuples. Rollback is the complete r46 release set
documented in `docs/current-model-releases.md`.

Validation passed: the focused alias/ambiguity test, the complete CFB production suite (including
the r46-to-r47 atomic transition fallback), the repository model-change safety suite, TypeScript,
focused lint with zero findings, diff checks, and the 105-page webpack production build.
