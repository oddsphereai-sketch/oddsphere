# CBB source-split institution-alias coverage repair

Starting base: `a28b4489674a1b3678308afd2efdcdeff521d7cb`.
Branch: `codex/cbb-split-coverage-repair-20261102`.

## Owner request and diagnosed mismatch

The owner reported missing CBB public and named splits across many games and
requested repair of actual source/mapping handling. At November2 4:32PMET, a
bounded read of current member metadata and the last30 minutes of Playbook v2
observations found112 future unlocked games (111tonight),221 stored public
panels and318 named panels. All221 current captured public market scopes were
already represented in stored member panels. The missing-public gap was upstream
of the reader, not fresh data hidden by card rendering.

The direct CBB source and reader paths already use the verified
`cbbProviderInstitutionName` alias registry r1. The shared observation collector's
`matchCbbSourceGame` instead used punctuation-only `canonicalCbbTeamName` from
the statistical dataset module. Legitimate institution spellings such as
Oregon St/Oregon State, C Connecticut/Central Connecticut and Boston U/Boston
University therefore could not join the same canonical fixture. The reported
missing-game cluster includes those institutions.

Use the existing verified provider identity function in the shared CBB matcher.
Do not alter the statistical dataset matcher, add fuzzy substring/mascot rules,
infer percentages, substitute named-book data for public consensus, loosen
time/date/unique-fixture requirements or reverse a side without an exact
neutral-site match. Both source participants still must match and ambiguous
matches remain rejected.

Capture advances to
`market_intelligence_v2_capture_2026_11_02_r19_cbb_verified_source_aliases`.
All source values, original clocks, percentages, orientation and hashes retain
their normal capture semantics. No new provider call, independent collector,
cron, writer or lease. This remains source observation/display repair under the
existing October30 CBB institution-capture policy. ScoreR3/boardR6/gradeR2 and
publisherR12 are unchanged; the separate PR938 market-decision candidate remains
owned by its original chat and is not deployed here. Current decision/grade
policy deltas are zero by contract; source coverage is not claimed predictive
accuracy. Future model changes must integrate this capture version explicitly.

## Verification and publication

The focused shared collector suite passes89 checks. Regressions cover ten
institution pairs from the missing-game cluster, direct/reversed orientation,
duplicate canonical candidates, wrong kickoff, mascot-only identity and
ambiguous USC/Miami forms. Existing shared-sport capture checks remain green.

Before publication: full model-change gate, CBB reader/store/lock focused tests,
TypeScript/build, same-input value/decision preservation, latest-main integration
safety and protected PR checks. After publication: observe the existing collector
writing newly matched source rows, verify the reader and sole CBB writer retain
those public/named sections, compare baseline locked payloads unchanged and
report actual remaining source coverage separately. Local primary environment
has no Playbook credential; no failed/unauthorized provider request or invented
raw response is used as evidence.

Private read-only baseline:
`/private/tmp/cbb-split-coverage-20261102-audit.json`.
Live source coverage and publication proof pending.
