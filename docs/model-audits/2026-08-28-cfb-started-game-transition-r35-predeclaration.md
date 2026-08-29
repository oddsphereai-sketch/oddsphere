# CFB started-game release transition r35 predeclaration

Date: 2026-08-28

## Scope

- Sport: CFB Daily Edge exact-price ingestion and member release selection.
- Writer: the existing sole leased CFB writer only; no second writer, timer, route, or database table.
- Provider boundary: preserve the existing bounded canonical `/events` then exact `/odds`
  sequence. When the current catalog contains duplicate exact-identity event rows, a single
  canonical ID already proven by immutable prior evidence for that same game may disambiguate
  the duplicate. Without one unique proven prior ID, odds calls remain forbidden.
- Model / probability / projection / decision / tuple / grade formula / stake / lock: unchanged.
  This repairs canonical provider input discovery, so evidence, collector, member, writer, Sharp
  fallback, and fixture identifiers are bumped. The existing r15 decision code continues to
  evaluate each newly observed exact tuple under the same already-qualified policy.

## Observed launch boundary

The natural r32 release wrote one immutable T-60 row at 18:54 ET and then 34 additional
pregame rows at 19:09 ET. Three 18:00 ET games had already started before the release-refresh
cycle and were correctly excluded by the post-kickoff mutation guard:

- URI at Merrimack (`458628`)
- William & Mary at Villanova (`459164`)
- Colgate at Fordham (`459167`)

All three have immutable pregame evidence in the last complete r15 member wave. Rewriting or
re-evaluating those games after kickoff is forbidden.

The 19:09 ET r32 row for SJSU at USC also exposed a separate launch regression. Current strict
catalog discovery returned more than one exact team/time event, so r10 correctly made no odds
call, but immutable prior captures prove one unique canonical event ID
(`ncaaf_sanjosestatespartans_usctrojans_2026-08-29_b2`) with coherent named-book Spread and Total
markets. The repair may reuse that ID only when it is still one of the current strict-identity
catalog matches. It never guesses an ID, picks by suffix, or probes every ambiguous candidate.

## Predeclared transition rule

1. Prefer a complete current release exactly as before.
2. When the current release is incomplete, it may replace the corresponding games in the last
   complete r15 wave only if every missing current-release game has already started at the
   response timestamp.
3. Every current row and every carried row must retain its original schema, member, decision,
   capture, price, and grade releases. No payload is relabeled.
4. If even one missing current-release game is still upcoming, reject the mixed selection and
   retain the existing complete-wave fallback behavior.
5. Publish the selected 38-game board as one response. Never expose a partial 35-game board.
6. For current catalog ambiguity, accept one candidate only when all immutable prior Sharp odds
   observations for that provider game prove the same event ID and that ID is an exact current
   team/time match. Otherwise retain `ambiguous` and make zero odds calls for that game.

## Acceptance

- Focused tests prove already-started carry and reject upcoming-game carry.
- Exact current board remains 38 unique games / 114 market slots.
- The three carried games remain their immutable pregame operational No Plays.
- Current r32 rows retain their exact tuples. A fresh natural release must restore USC Spread and
  Total from current exact named-book evidence while Moneyline remains unavailable if no coherent
  two-sided quote exists. Report exact before/after board counts and promotions/demotions.
- `npm run verify:model-change`, webpack build, integration safety, protected PR, production
  commit, and signed-in desktop/mobile QA must pass before announcement.

## Rollback

Restore fixture r23. The last complete pre-r32 wave remains available and no immutable evidence
is changed by rollback.
