# Owls current sharp-book price capture

Date: 2026-10-27

## Predeclared scope

- Replace the current Circa/Pinnacle API input used by the existing observation-only capture with
  Owls data where Owls has an exact supported event.
- Preserve Playbook as Public Consensus and preserve the already-deployed Owls named-book split
  lane.
- Make no market-reader, model, prediction, member-display, lock, grading, stake, or tracking change.
- Do not relabel, rewrite, delete, or reinterpret existing SharpAPI observations.
- Keep every missing, malformed, incomplete, wrong-sport, unmatched, or ambiguous row unavailable.

Release:
`market_intelligence_v2_shadow_capture_2026_10_27_r8_owls_sharp_book_prices`.

## Acceptance contract

The normalizer accepts only the `circa` and `pinnacle` book keys. For Moneyline it requires exactly
one home and one away price. For Spread it additionally requires opposing numbers. For Total it
requires equal Over/Under numbers. Every accepted pair must have nonzero finite American prices and
a valid provider `last_update`; implied probabilities are normalized to a two-sided no-vig pair.

Canonical mapping then requires exact sport and away/home identity. NBA/WNBA use the professional
basketball registry, MLB uses the MLB registry, and NHL uses the established NHL registry so Owls
full names map to the abbreviation-only team rows stored by the NHL schedule. Duplicate matchups
must also resolve by scheduled time/date; ambiguity fails closed.

## Live read-only evidence

A direct read-only Owls `/odds` probe at approximately 22:37 UTC (18:37 ET) returned HTTP 200 for every
supported sport. The normalized current sharp-book coverage was:

| Sport | Unique events with Circa or Pinnacle | Circa events | Pinnacle events | Accepted side-prices | Provider timestamps |
| --- | ---: | ---: | ---: | ---: | --- |
| NBA | 4 | 4 | 4 | 48 | 22:37:16–22:37:33 UTC |
| NHL | 13 | 11 | 13 | 144 | 22:37:16–22:37:33 UTC |
| NFL | 29 | 29 | 14 | 228 | 22:37:16–22:37:33 UTC |
| NCAAF | 56 | 55 | 56 | 662 | 22:37:16–22:37:33 UTC |
| NCAAB | 0 | 0 | 0 | 0 | no current sharp-book row |
| MLB | 1 | 1 | 1 | 12 | 22:37:16–22:37:33 UTC |
| WNBA | 1 | 0 | 1 | 6 | 22:37:16 UTC |

These counts describe the provider response at one observation time, not a promise that every book
will quote every future event. Missing books remain missing rather than being synthesized.

The first NHL dry-run correctly failed closed because the canonical NHL schedule stored team names
as abbreviations while Owls returned full names. After routing both forms through the established
NHL registry, the same production rehearsal loaded all 11 current NHL games and built 66 complete
Owls split sides plus the current sharp-book price observations. The remaining rejections were
future provider events absent from the requested canonical window; they did not cross-match. NBA
and MLB production dry-runs matched their current canonical games with zero provider-row rejection.

## Production authority and board impact

The code writes only `market_price_observations_v2` through the existing gated shadow collector.
It does not write or alter `lines`, `line_history`, `game_predictions`, `prediction_records`, grades,
stakes, locks, member DTOs, or tracking. The predictive market reader is explicitly out of scope.

Same-input impact is therefore exactly:

- promotions: 0
- demotions: 0
- side changes: 0
- probability changes: 0
- grade changes: 0
- actionable-count changes: 0
- locked-record changes: 0

## Verification and rollback

Focused verification covers complete-pair normalization, no-vig math, book filtering, malformed
pair rejection, sport identity, NBA mapping, NHL full-name/abbreviation mapping, provider timestamp
preservation, and a live read-only rehearsal. Publication also requires TypeScript, the complete
model-change verifier, latest-main integration safety, protected PR checks, and a post-deploy
production rehearsal.

Roll back r8 to r7 if a row crosses game identity, an incomplete pair is accepted, provider
timestamps are lost, current-game coverage regresses, the collector makes a new SharpAPI split
request, or any model/member/lock field changes. Preserve append-only historical observations during
rollback.
