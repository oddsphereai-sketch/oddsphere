# CFB completion-cadence continuity repair

## Incident

The October 20-26 member board contained 96 model-covered Division I games:
56 FBS-involved games in the default view and 40 FCS-only games in the explicit
All Division I view. The schedule was complete, but all 288 displayed markets
were No Play. Only 20 games retained a current-odds observation and 228 market
rows had no current price.

Production writer runs were waking every five minutes with
`provider_seed_due`, selecting exactly the 40 FCS-only games, and repeatedly
returning a partial provider result. Current BALLDONTLIE or SharpAPI main-market
prices were independently verified for representative FBS games, including
Middle Tennessee at FIU, Oregon at Illinois, and James Madison at Appalachian
State, but the ordinary hourly capture plans for those games were discarded by
the provider-seed completion filter.

## Root cause

The completion path intentionally plans every unlocked game with a zero-minute
override and then narrows that forced plan to the rows requiring the special
provider seed. A persistent FCS seed gap therefore remained the highest-priority
release need on every run. Because the filter retained only seed-needed and
T-60 rows, an unrelated FBS game could never receive its already-due ordinary
hourly refresh while any seed gap persisted.

## Repair

Sole writer release
`cfb_forward_evidence_writer_2026_10_19_r129_completion_cadence_continuity`
computes the ordinary cadence plan before applying the existing completion
override. Provider-seed and reference-line completion runs now retain the union
of:

- every due T-60 plan;
- every row requiring the named completion operation; and
- every game already due under the ordinary opening/unlocked cadence.

Fresh games that require neither ordinary collection nor completion stay out of
the run. The special provider seed, bounded provider budgets, authoritative
schedule, independent forecast, professional market reader, probability,
decision, grade, stake, member fixture, compact snapshot, tracking releases,
and sole `prediction_pipeline:cfb` lease are unchanged.

## Safety and board impact

This is an operational input-continuity correction for future unlocked rows. It
does not create a second writer, invent a quote, bypass exact-event identity,
alter a grading threshold, or promote/demote a row by rule. Fresh verified odds
may cause the unchanged production reader to evaluate an unlocked market at its
real current tuple; those provider-driven changes must remain release- and
timestamp-separated. Every stored opening, T-60, locked, started, and tracking
payload retains exact precedence and is never rewritten.

The focused mixed-plan regression contains one FCS seed-only game, one
ordinary-hourly-due FBS game, and one fresh FBS game. The repaired completion
filter selects the seed-only and ordinary-due games and excludes the fresh game.
Existing regressions continue to prove unconditional T-60 priority. The live
acceptance gate is increased current-odds coverage on the same 96-game slate,
non-flat grades produced only by the unchanged exact-price reader, no lock
mutation, and no second lease or writer.

## Rollback

Roll back the sole writer to r128 if a completion cycle exceeds provider
budgets, admits a fresh non-due/non-completion game, drops a due T-60, creates a
second writer, changes an immutable row, or produces a release/reader mismatch.
Do not roll back or rewrite any locked payload created before or after this
release.
