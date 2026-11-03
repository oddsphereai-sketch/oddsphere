# CBB forward retail quote journal — November 3

Starting production base: `322d9822c708e372396f0768b7f386d273e4ce93` (PR952).

## Reproduced defect

The source trace for PFW–Duquesne (10882593) at 13:43 UTC showed FanDuel
with only one genuine stored observation per side/market; generic line_history
had zero rows, and canonical observations held only Pinnacle/Circa. R18 repaired
native-event mapping, not the missing retail history. The existing current-odds
collector already fetched the retail quotes but normalized/persisted only the
professional roster. Existing chart compaction cannot recover absent source.

## Repair

The same leased collector, same single Owls request and same canonical upsert
now preserve supported retail quote pairs for CBB only. No new job, provider
call, polling cadence, table, migration, shadow prediction or score writer.
Native event identity, exact shared participant/time matching, original
per-market update clocks (book clock only when no market clock exists), actual
capture lineage and both sides stay bound. Exact duplicate source frames
coalesce; inconsistent, one-sided, nonpregame, future, non-half-point and invalid
price/hold pairs are rejected together. Exchange books remain excluded.

New collector release R27 and retail source release R1 describe storage behavior.
Retail rows always have sharp_book=false. The professional normalizer and its
outputs remain byte-identical; other sports retain their existing wrapper.
The CBB numerical history query continues filtering to professional books before
pagination, and downstream qualification still requires sharp_book=true.
No numerical score, grade, promotion/demotion, stake or lock change: board-count
impact is zero on identical professional inputs. Stored locks render unchanged.

The existing all-book chart reader can consume canonical retail observations
without changing the display feed schema. Only genuine quotes captured after
cutover can fill the forward trail; no historical opener is invented. Existing
nullable-moneyline uniqueness semantics are unchanged; the journal retains real
source timestamps rather than freshening unchanged quotes to collection time.

## Verification

Focused source checks cover two-sided capture, original per-market clocks,
professional output parity, source lineage, duplicate/conflict behavior,
future/live/incomplete/invalid pairs and no non-CBB retail authority. The bounded
numerical-history test explicitly proves professional filtering on every page.
Run full model-safety checks, production build, TypeScript/lint, clean integration
ancestry and protected PR checks before publication. Post-merge proof must use
normal collector observations and immutable-lock comparisons, not a paid manual
refresh. This source repair is not evidence of improved predictive accuracy and
does not solve the separate full starting-level inference gap.
