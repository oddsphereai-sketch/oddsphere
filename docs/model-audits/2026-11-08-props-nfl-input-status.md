# NFL source status counts model heads, not all evidence

Base: `9844df4e521a25ff1930a8cbf08bf80a444c5055`.

The cached NFL adapter counted all evidence entries to determine whether every
independent model/context head was present. A retained movement entry adds a
second evidence item. That could falsely report a supplied model as missing,
or hide a genuinely unavailable second model head when counts happened to match.

NFL source R2 counts independent_model evidence only. Every individual input,
market, quote, positive evidence value, source clock and player remains exact.
Genuine future/unavailable heads, missing recent logs, matchup history and other
limitations stay explicit. The fix must not fabricate context or erase an actual
gap to improve apparent coverage.

Future AI generations stamp R17; sole NFL writer R77 identifies the input-status
change. R16 and R15 accepted laws remain under their actual releases, without
regeneration or relabeling. NBA/MLB source behavior and grouping are unchanged;
future generations share the same R17 runtime identity. MLB independent champion
R44, NFL native model/calibration, source decision R8, member R57, lifecycle R39,
selection R1, tracking R43 and the law/grade/price/reader semantics stay exact.
No timer, provider request, review slot, cap or funding rule changes.

The actual live adapter regression proves supplied model plus movement is not
missing, a future model stays unavailable, and movement cannot hide one missing
head among two offered markets. Retained R15/R16 publication keeps original
release/bytes. Source/forecast/count impact before generation is unchanged;
future AI decisions can differ because their limitation flags are corrected.
No new promotion/demotion rule or retrospective accuracy claim is introduced.

Required checks: no-network source and retained-review tests, scoped publication,
locked reader/writer precedence, focused NFL lifecycle, full model gate, lint,
TypeScript/build, clean latest-main protected PR and ordinary runtime/funding/
publication proof. Existing locked snapshots, accepted reviews and archived
input evidence are never sanitized. No paid AI tests or manual cron calls.
