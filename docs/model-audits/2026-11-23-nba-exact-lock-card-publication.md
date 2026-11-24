# NBA exact saved-card lock handoff — November 23

Prospective only. Starting base `f27cf6859e98656a0f1840e166546eac42f7b81c`.
No historical prediction or locked payload correction is authorized or performed.

## Reproduced publication defect

The R39 source repair passed an ordinary reader R5 publication at November24
02:01:03.948 UTC and a normal T60 sweep completed at 02:03:01.797. All ten
November23 NBA games have thirty locked records; the original twenty-four
pre-release lock hashes remain identical. The two new three-market tuples
carry R39/R41/R5/gradeR31 and have coherent scores, directions and prices.

A subsequent signed-in member comparison found a separate handoff defect.
R10's lock publisher copied only the lock timestamp/state onto the earlier
reader card. The complete snapshot predated final targeted price capture.
San Antonio–Sacramento's saved original member card selects Over223.5 at−108;
the earlier reader still displayed Under225.5 at−105 while marking it locked.
Its Spread was−102 in the original capture and−105 on the earlier card. Utah–LA
Spread was−107 in the original capture and−105 on the earlier card. The stored
records/captures are correct; no later model is used to reinterpret them.
These are exact-price/contract and publication differences, not outcome-based
pick changes or evidence that a replacement forecast is better.

The existing full reader already gives saved original locked cards precedence.
The ordinary 02:15:51.991 reader recovered all six market contracts on the
signed-in page: both saved Spread prices and the original Over223.5/−108 were
visible without any record change. This proposal closes the interval between the final lock and that next full publication.
Private SELECT/DOM comparisons remain in
`/private/tmp/nba-reader-timeout-stage-20261123`; no raw private payload enters Git.

## Prospective R11 handoff

Member lock publication advances from R10 to
`nba_member_lock_publication_2026_11_23_r11_exact_saved_cards`.
ModelR39/marriageR41/readerR5/gradeR31, original capture R8, numerical formulas,
selection, evidence, source clocks, stake, tracking and every existing lock stay
unchanged. This is an original-card publication correction, not a model refit,
new promotion/demotion policy or grade reinterpretation. Relative to the same
authoritative captures there are zero numerical/grade/actionable changes.

The existing post-lock publisher remains the sole path under the existing NBA
prediction lease. It reads only metadata for existing locks and one bounded
three-market capture cohort for newly locking cards (maximum128 games). It
uses the existing R8 legacy decoder/precedence validator; no independent card
reconstruction or new writer is added. All three official-market captures must
be present, equal, identity-matched and share their original lock timestamp.
The publisher copies the original full card and its existing lifecycle overlay.
It never promotes the prior unlocked card into locked truth by changing only
its timestamp. Unavailable, corrupt, mismatched or partial captures fail closed
with zero snapshot/cache/freshness writes. No source/model/provider requests.

Already published locked cards remain opaque and byte-identical; a different
stored lock timestamp is an explicit error rather than permission to replace
one. The fix applies only to unlocked→locked handoffs and future locks. A retry
with no changes reads no capture JSON, writes nothing and does not renew TTL.
Prediction records and their snapshot_json are never written by this publisher.
No current or older stored lock is corrected or rewritten by this release.

## Verification and publication gates

The mocked actual-writer regression reproduces the old Under/new Over and
quote/projection differences, then proves exact saved-card publication. It also
proves immutable old locked cards and future cards, three-market consistency,
missing/foreign/partial/mismatched/failed source refusal, one new-game-only
capture read and zero failed/idempotent writes or freshness advancement. All
real network access is trapped. Existing locked reader and prediction-writer
immutability tests remain required. Hosted reader proof adds this same mocked
actual-writer regression alongside the unchanged database frontier proof.

Require focused, full model verification, full TypeScript/lint/build, latest-main
integration with no dirty overlap, exact remote tree, protected up-to-date PR,
actual Ready source and live member/sweep coverage verification. A future-lock
case must be observed on its ordinary schedule before declaring that path
fully verified. Do not run a manual paid proof/refresh or rewrite locked history
to manufacture a live test. If that prospective live proof is unavailable,
retain the explicit pending qualification.

## Local candidate checks

Ten focused NBA lock/reader/writer/source suites pass, including the actual
snapshot-writer dependency-injected fault controls. Full repository TypeScript,
ESLint, webpack production build and `npm run verify:model-change` pass on
base f27cf685. Optional local Market Brain PostgreSQL proof is explicitly
skipped because its URL is unset. No production history writes, manual cron,
provider/model/count requests or added paid proof were performed.

There are no remaining NBA lock entries tonight after the ten-game slate.
Keep the prospective future-lock qualification explicit; a green synthetic or
preview test is not an actual future lock. Original R39/R5 successful live
publication and the thirty original locks remain separately documented.
