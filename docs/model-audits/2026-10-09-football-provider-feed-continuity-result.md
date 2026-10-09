# Football provider-feed continuity result

Date: 2026-10-09  
Base: `ab3ec4a2335d2cd2c8a29ab268661b0a7dd4d178`  
Candidate branch: `codex/provider-feed-continuity-20261009`

## Outcome

The candidate repairs the two confirmed transport/normalization defects without
loosening the already-approved football market readers.

### NFL SharpAPI splits

- Root cause: current SharpAPI NFL rows use exact provider identities such as
  `BAL Ravens`, `IND Colts`, `BUF Bills`, and `LA Rams`; the adapter rejected those
  labels even though the team/date/book/market tuples were otherwise complete.
- Correction: add exact abbreviation-plus-nickname aliases, with explicit LA-to-LAR
  and WAS-to-WSH code mappings. Fuzzy matching remains forbidden.
- Current-board zero-write result: complete SharpAPI split evidence increases from
  1 of 15 games to 7 of 15. The six restored games are LV-NE, IND-PIT, NYG-WSH,
  SF-SEA, BAL-ATL, and BUF-LAR; PHI-JAX was already matched.
- Current-board model result: zero projected-score changes, zero side changes, zero
  probability changes, zero grade changes, zero promotions, zero demotions, and the
  same 18 actionables. The final grade counts remain 11 Best Angle, 7 Lean,
  12 Watchlist, and 12 No Play across 42 markets. The repaired evidence is available
  to the professional authority, but none of these restored rows qualifies to move
  this slate.

### CFB Playbook injuries

- Root cause: Playbook's documented contract uses uppercase league identity and
  returns `last_updated`/`updatedAt` plus `teams[].injuries[]`; Oddsphere requested a
  lowercase league, timed the call out after 2.5 seconds, and read only the older
  `data[].players[]` shape.
- Correction: request `NCAAF`, use a 10-second injury-only timeout, normalize both
  contracts into the existing canonical DTO, preserve provider timestamps even for a
  verified clear report, and retain the newest prior per-game report when a later pull
  fails, omits the matchup, or is older.
- Model safety: newly normalized documented-contract rows are report-only in this
  release. They cannot cap or promote a grade until the production credential supplies
  a live payload and a separate exact-board audit validates player identity, coverage,
  promotions, demotions, and actionables. Existing previously qualified legacy rows
  retain their prior authority. CFB scores, probabilities, sides, grades, and tracking
  semantics therefore remain unchanged by this release.
- Current CFB SharpAPI audit: the actual production adapter matches 30 of 89 active
  games from the 34 rows currently published by SharpAPI. No CFB SharpAPI matcher
  change is warranted.

## Release and continuity

NFL advances to the r30 provider-feed-continuity model family and writer r60. CFB's
score, calibration, grade, decision, market reader, and tracking releases remain
unchanged; only its collector/member/publication family advances so the repaired
member injury report is versioned. The prior NFL r29 and CFB r57 member families remain
explicit immutable-lock reader predecessors, and the earlier CFB r39 compact snapshot
remains readable behind r57.

No provider request loop, schedule, writer, sport lease, model coefficient, threshold,
stake, copy, label, or layout changes. Locked records remain byte-authoritative.

## Verification

- TypeScript: passed with an 8 GB heap.
- Focused Playbook normalization, uppercase request, timestamp, omission, older-replay,
  verified-clear, report-only authority, and retention tests: passed.
- Focused NFL SharpAPI identity/date/completeness/duplicate tests: passed.
- NFL decision, professional authority, writer, fixture, compact snapshot, lock, and
  tracking suites: passed.
- Complete CFB production, decision, reader, SharpAPI, and continuity suites: passed.
- `npm run verify:model-change`: passed in full after the final fail-closed change.
- `git diff --check`: passed.

## Remaining publication proof

The production Playbook credential is not present in the local worktree. After a
protected merge, the first leased CFB writer cycle must prove a non-malformed live
NCAAF response, canonical team coverage, source timestamps, prior-report continuity,
member visibility, unchanged decision/grade releases, sole-writer/lease health, and
unchanged locks. Only then may a separately versioned proposal grant the documented
contract model authority.

Publication also still requires owner approval, latest-main reconciliation,
integration-safety verification from a clean commit, protected PR checks, merge, and
post-deploy release/cron/page verification.
