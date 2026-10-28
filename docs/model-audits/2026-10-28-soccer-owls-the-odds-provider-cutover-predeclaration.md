# Soccer Owls + The Odds API provider cutover — predeclaration

Date: 2026-10-28

Status: candidate only until same-input replay, focused/full model verification,
protected publication, and post-deploy live proof are complete.

## Owner direction

Daniel explicitly directed Oddsphere to replace the cancelled SharpAPI soccer
price dependency, use the providers already paid for, improve incomplete EPL
and UCL market pricing, and verify the models after the change. Existing locked
member records remain immutable.

## Verified provider facts

- A live authenticated Owls `/api/v1/soccer/odds` probe returned fresh named-book
  EPL and UCL events. Pinnacle currently supplies three-way Match Result,
  handicap, and Total markets; DraftKings, FanDuel, Caesars, Hard Rock, and
  NoVig coverage is also present where offered.
- Owls does not expose soccer splits and its current soccer odds payload does
  not expose BTTS or Double Chance.
- The Odds API official v4 event-odds contract documents `btts` and
  `double_chance` for soccer. Production already has `THE_ODDS_API_KEY` for the
  bounded CFB fallback; local development intentionally does not copy that
  secret.
- Playbook's verified local contract exposes consensus main lines and public
  splits, with MLS as its only declared soccer league. It is not a named-book
  EPL/UCL BTTS or Double Chance price source and must not masquerade as one.

## Candidate boundary

1. One cached Owls soccer odds request supplies current named-book Match Result
   and 2.5 Total vectors for EPL and UCL.
2. The Odds API free event catalog resolves exact EPL/UCL event identity.
   Its paid event endpoint fills only missing BTTS and Double Chance vectors.
3. The Odds API calls are bounded by same-book stored-quote freshness, kickoff
   cadence, a hard per-cycle request ceiling, and an account-credit reserve.
   A missing key, quota reserve, provider error, ambiguous identity, stale row,
   or incomplete vector fails closed and preserves the last coherent member
   snapshot.
4. Exact team orientation, kickoff proximity, complete outcome vectors,
   provider timestamps, market/line identity, and named-book provenance are
   mandatory. Playbook consensus is never labeled as a sportsbook.
5. Locked records and locked member payloads render exactly as stored. New
   provider semantics apply only to unlocked rows and future locks.
6. The existing EPL/UCL writers, sport-scoped prediction-pipeline lease,
   schedules, settlement, stakes, copy, labels, and layout remain unchanged.

## Model-impact declaration

This is model-input changing. Current named-book vectors can influence the
existing target-excluded market comparison, coherent outcome arbitration,
exact-price EV, grade, and movement lanes. The candidate therefore receives
new EPL and UCL model/calibration/grade/member identifiers. It does not change
the independent score equations, coefficients, thresholds, or add a second
writer.

## Required evidence before publication

- Unit fixtures for Owls three-way Match Result/Total and The Odds API BTTS/DC,
  including reversed teams, ambiguous identity, partial outcomes, stale data,
  and quota/cadence rejection.
- A real-provider zero-write rehearsal showing current EPL/UCL coverage,
  freshness, provider calls, and remaining credits without logging secrets.
- Same-input incumbent/candidate board comparison reporting side changes,
  promotions, demotions, actionable counts, and coverage by market.
- Locked writer immutability and locked reader precedence tests.
- `npm run verify:model-change`, affected EPL/UCL suites, typecheck, build,
  latest-main integration safety, protected PR checks, and post-deploy writer,
  lease, release, coverage, reader, and lock verification.

## Hold / rollback

Hold publication on mixed releases, lost locked precedence, unresolved event
identity, incomplete vectors, quota-reserve breach, unexplained board
flattening, provider-call amplification, failed writer/lease health, or a
current game losing a previously coherent price board. Roll back the complete
provider/release family together. Never rewrite an existing locked row.
