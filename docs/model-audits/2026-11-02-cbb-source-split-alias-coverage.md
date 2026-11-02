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

## Deployed r19 result and complete-name follow-up

PR939 merged `28d71522dd56928f8b34303e474ba7b8b2843153`; production deployment
matched verified tree `efdd1b85c5fc9168a27f49920a8b4fb95459f9b3`. The natural
4:46PMET CBB collector succeeded, but current public coverage remained221panels
(238fresh scopes including historical/locked events). It did not establish that
the missing panels were restored. All9 archived locked payloads and24 original
tracking records remained byte-equivalent. No predictive change was made.

Read-only comparison found210fresh legacy public side cells attached to35 of the
38 wholly missing current games. That older matcher uses mascots and is not
sufficient identity proof to republish those values. Canonical institution/full
names, both teams and event times are present in the canonical game table.

The r19 alias registry handles institution-only variants, but a full source
name can append the actual mascot to the alias (for example OregonStBeavers).
The complete-name follow-up r20 compares the exact mascot derived from the
canonical full name against the source suffix, then resolves the remaining
institution through the verified existing alias registry. It requires a
nonempty institution, nonempty exact mascot and the same unique timed matchup;
it does not strip arbitrary words or match an institution from a mascot alone.

Additional tests cover real canonical full-name forms for Weber/OregonState,
CentralConnecticut/Temple, Quinnipiac/MichiganState, Northeastern/BostonUniversity
and MoreheadState/WesternKentucky, both orientations and duplicate/wrong-time
rejection. Wrong mascots, different schools sharing a mascot and mascot-only
forms remain rejected. No statistical team identity, source percentage, quote,
price-selection, score, probability, grade policy, stake, lock or provider
request change accompanies this capture-only follow-up.

The owner approved one diagnostic run of the existing collector. It completed
successfully4:51:36–4:52:56PMET, but the connection closed before its full returned
diagnostics arrived. That cycle was not repeated. Provider-secret settings were
access was subsequently approved explicitly, but Vercel stores the existing
variable as write-only and would not reveal it. The editor was cancelled without
saving. No key was retrieved and no direct provider request was made. The
follow-up adds a bounded non-secret rejection sample (20 rows) to the existing
collector's log, including source event names/start and capture release. This
allows the normal scheduled run to explain missing joins without another poll
or dependence on its long all-sport HTTP response. No provider payload, key or
request headers are logged. It does not claim recovery before observation.

R20 starting base is `28d71522dd56928f8b34303e474ba7b8b2843153`; latest production
`4df9ed2531a362a6d700f7d1a68bcb9fcd35c735` was integrated without overlapping
implementation hunks. Its database efficiency changes are preserved in full.

## R20 production proof and source-observed R21 variants

PR941 merged as `f397cdb8360a3edf13ca6c5a06976e5f9fb62e0f`; its production
tree equals the locally verified tree. The normal 22:46:42Z capture built 628
Playbook side observations. The subsequent sole writer persisted 69 newly
restored public market panels on the same 104 still-unlocked baseline games:
209 panels before, 278 after, zero previously present panels lost. Earlier
locked snapshots retain their original payloads. The source diagnostic log
shows 140 source games, 472 canonical games in the loaded window and 33
rejections; those outside the seven-day window are correctly left unmatched.

The first 16 rejected in-window games expose exact full-name variants, including
Boston Univ. Terriers / Boston University Terriers, UMKC Kangaroos / Kansas City
Roos and Grand Canyon Antelopes / Grand Canyon Lopes. Each source spelling is
checked against the canonical full school name and institution on the exact
paired timed fixture. R21 adds only these 16 explicit capture-local aliases;
it does not change the shared statistical/provider institution registry or
generalize alternate mascots to other schools. Direct and neutral-site reversed
orientation, wrong opponent, duplicate candidate and wrong date are tested for
each alias. Both participants, unique event and original clock remain required.

R21 starts from `f397cdb8360a3edf13ca6c5a06976e5f9fb62e0f` in
`codex/cbb-verified-playbook-full-names-20261102`. Capture identifier advances to
`market_intelligence_v2_capture_2026_11_02_r21_cbb_observed_full_name_aliases`.
All score, probability, pick, grade, stake and lock policies remain unchanged;
the same-input actionable board delta is zero. No additional provider requests,
new refresh path, lease or writer. Existing collector and sole member writer
remain authoritative. Actual further coverage recovery awaits their next normal
production cycle after protected publication.
