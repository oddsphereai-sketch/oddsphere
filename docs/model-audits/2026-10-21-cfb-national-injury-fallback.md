# CFB national injury fallback

## Problem

The production CFB availability collector covered ten official conference
publication systems and retained the newest verified exact-game report. That
was not a national CFB injury contract: a school or game outside a published
conference report could remain without verified availability evidence. The
unsupported Playbook CFB injury endpoint correctly remained disabled.

## Authorized repair

Future unlocked captures add the credentialed SportsDataIO NCAA Football
`Teams` and `InjuredPlayers` endpoints as a national fallback for every game
in the active weekly window. Exact official
conference reports remain first authority. The national row is eligible only
when both scheduled teams match uniquely against the provider team catalog.
A successful national response with two verified team matches may report an
empty player list as clear; a missing key, failed request, ambiguous team, or
unmatched team may not.

The fallback is availability-panel evidence only. It is explicitly excluded
from `reportedCfbQuarterbackAvailability`, so the independent model,
probabilities, score, market reader, sides, grades, stakes, promotions, and
demotions are unchanged. Locked payloads are never rewritten. The collector
and sole writer advance to r62/r133 because future evidence provenance changes;
the evidence schema, member release, decision release, calibration, and model
release remain unchanged.

## Validation and deployment gate

- Parser tests cover injured, verified-clear, unmatched-team, authentication,
  response-size, and exact source-provenance behavior.
- Continuity tests prove official-conference precedence and last-known exact
  report preservation.
- The existing CFB production suite and full model-change suite must pass.
- Production must configure `SPORTSDATAIO_CFB_API_KEY`; without it, national
  CFB injury coverage is red and must not be certified green.
- After deployment, a credential-backed zero-write read must report request
  success, unique team matches, and per-game coverage before the live route is
  declared healthy.

Rollback r62/r133 to r61/r132 for future unlocked collection only. Do not
change or reconstruct any locked record.
