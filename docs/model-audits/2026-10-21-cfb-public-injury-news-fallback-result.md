# CFB public injury-news fallback result

## Decision

Advance future-unlocked CFB collection to collector r63 and sole writer r134.
Keep official conference reports first, add one no-key ESPN public-news request
as the strict second authority, and retain SportsDataIO only as an optional
lower-priority fallback. Complete-health certification advances to r2 and no
longer treats the absent optional credential as a failure.

## Same-input product impact

- Scores changed: **0**
- Probabilities changed: **0**
- Moneyline / Spread / Total sides changed: **0**
- Grades changed: **0**
- Promotions: **0**
- Demotions: **0**
- Stakes changed: **0**
- Locked payloads changed: **0**

The production writer passes availability evidence into verified-quarterback
logic only when `source === "Playbook"`. Focused tests prove ESPN, Conference,
and SportsDataIO reports all resolve to null at that model boundary while the
existing Playbook path remains unchanged. The new source can therefore improve
the member injury panel without influencing the independent score or the
professional market reader.

## Live zero-write provider proof

At `2026-10-21T17:47:21.838Z`, the current Tuesday-through-Monday slate audit
read 111 games and made exactly one ESPN injury-news request. The response
contained 50 public articles. Strict identity and status parsing accepted one
current player on one exact scheduled game:

- Michigan State at UCLA (`457746`): UCLA QB Nico Iamaleava, **Out**, report
  timestamp `2026-10-20T02:15:03.000Z`.

The first rehearsal exposed ESPN rejecting the custom OddSphere user-agent
with HTTP 403. Removing only that header restored HTTP 200; all strict parser,
size, timeout, identity, and status gates remain in place. The final audit made
zero writes.

## Verification

- Focused ESPN parser / arbitration / zero-model-authority test: pass.
- Official conference, SportsDataIO, exact-game continuity, and complete-health
  regressions: pass.
- Complete `test:cfb-v1-production` suite: pass.
- TypeScript `--noEmit`: pass.
- Full `npm run verify:model-change`: pass.
- Live current-slate public-source audit: pass, 1 request / 1 matched game /
  1 accepted player / 0 writes.

## Rollback

Roll back collector r63, writer r134, and complete-health r2 together. Do not
modify or reinterpret any stored locked record. The previous r62/r133 path
continues to render existing official and optional SportsDataIO evidence.
