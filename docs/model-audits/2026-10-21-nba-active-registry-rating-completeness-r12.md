# NBA active-registry rating completeness (candidate r12, combined refresh r13)

## Live finding

After the combined r14 deployment recovered the intended prior-season rating
pack, production contained complete rows for all 30 current NBA clubs and one
additional historical/test team row (`LON`). The r11 skip gate compared rating
coverage with every stored `sport=nba` row. Because Basketball Reference can
never produce a `LON` rating, the supposedly one-time recovery would run on
every full refresh.

## Repair

The skip gate now checks only stored identities that resolve through the exact
30-club NBA registry already used by the ratings importer. Unknown stored rows
are excluded only from the provider-call completeness denominator. They are
not deleted, rewritten, mapped to a current club, or made model-eligible.

This is an operational cadence correction only. It does not change model r14,
market marriage r16, grade r8, any score, probability, side, grade, price,
stake, writer, lease, lock, or tracking rule. The live acceptance test is a
second full refresh reporting rating mode `already-complete`, zero prior-season
payloads/writes, and unchanged 30-current-club coverage.
