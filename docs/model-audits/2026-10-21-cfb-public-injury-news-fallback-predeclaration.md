# CFB public injury-news fallback predeclaration

## Owner direction

The owner rejected a new injury-data subscription and any manual workflow that
requires supplying reports to Oddsphere. Publicly reported college-football
injuries must be collected automatically when a reliable source publishes an
explicit player status.

## Scope

Future unlocked CFB evidence may add one bounded, no-key ESPN college-football
news request to the existing leased CFB writer. The parser may accept only an
article that:

- has a valid publication timestamp and public source URL;
- names exactly one scheduled team after strict team-identity matching;
- names a player through a narrow football-position/name headline or explicit
  player-status sentence pattern; and
- states an explicit availability designation such as out, season-ending,
  doubtful, questionable, game-time decision, probable, cleared, or expected
  to play.

Generic injury discussion, game recaps, coach changes, historical articles,
multi-team ambiguity, and inferred medical status must be rejected. A public
news report may list a known player concern; it may never certify an unlisted
player or team healthy.

Exact official-conference reports remain first authority. Public ESPN injury
news is a partial fallback for games without a current official report. A
credentialed SportsDataIO report remains an optional lower-priority fallback,
not a required production dependency. Existing exact-game last-known report
continuity remains authoritative when a later collection returns nothing.

## Model and lock boundary

This source is availability-panel evidence only. It is not passed to verified
quarterback availability, the independent model, probability distribution,
market reader, decision, grade, stake, promotion, or demotion paths. Locked
payloads retain exact stored precedence and are never rewritten.

Collector/writer and complete-health provenance advance because future evidence
and health-source authority change. Model, calibration, decision, evidence
schema, member, tracking, and settlement releases remain unchanged.

## Acceptance gates

- Parser tests cover accepted out/questionable/available patterns and rejection
  of false-positive, ambiguous-team, stale, post-kickoff, and malformed rows.
- Arbitration tests prove official-conference precedence, public-news fallback,
  optional SportsDataIO precedence, and exact-game continuity.
- The same-input board report proves zero changes to scores, probabilities,
  sides, grades, stakes, promotions, demotions, and locked payloads.
- Focused CFB production tests, TypeScript, `npm run verify:model-change`, and
  latest-main integration safety must pass before publication.
- Post-deploy verification must prove the ESPN request succeeds, at least one
  known current public injury maps exactly when present, and the missing
  SportsDataIO credential no longer creates a false required-credential failure.

