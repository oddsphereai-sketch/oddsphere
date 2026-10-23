# NBA player-props canonical coverage result

Date: 2026-10-23

## Outcome

The candidate repairs current-slate coverage without changing the NBA player-
prop projection model or grade calibration. The provider timestamps individual
player and line records independently. The former selector kept only the exact
maximum timestamp for each sportsbook inside a player/market scope, which
silently removed still-current complete pairs and caused valid players to
disappear downstream.

The repaired selector retains each sportsbook's newest complete pair at every
current line, prefers a line corroborated by at least two books, and still emits
exactly one canonical row per game/player/market. When only one book truly
offers the market, the member row uses the unchanged independent projection and
the genuine exact price, but records null other-book probability, zero
confirming books, and mandatory `No Play`. Those rows are excluded from every
direct and slate-relative promotion path.

## Release-pure current-slate A/B

The audit used one 2026-10-23 provider response, one stored history payload, one
feature matrix, and the same frozen r7 model artifact for predecessor and
candidate selectors.

- Provider slate: 12 games, 35,474 normalized observations, no findings.
- Supported foundation scopes: 1,084.
- Candidate decisions: 1,084; missing feature scopes: zero.
- Predecessor/runtime-equivalent decisions after independent-only retention:
  1,084.
- Shared scopes changed: one. The change replaced an uncorroborated one-book
  31.5 points line with a two-book 32.5 main line; it did not create an
  actionable pick.
- Actionables: 36 before and 36 after.
- Independent-only rows: 202; actionable independent-only rows: zero.
- Added or removed canonical scopes in the same-feed selector comparison: zero.

The production snapshot preceding this repair contained 923 decisions. A
no-write writer rehearsal using the same release recovered 1,071 decisions
before the current-team identity repair. Resolving the one stale traded-player
team identity (Collin Sexton) closed the final four foundation scopes, producing
1,084/1,084 on the final same-feed audit. The identity fallback adds one bounded BALLDONTLIE player batch on
this slate, only when stored identity is absent or contradicts the scheduled
game.

## Accuracy and board safeguards

- Independent projections and frozen model coefficients are unchanged.
- Corroborated market arbitration and all grade policies are unchanged.
- One-book rows cannot be Best Angle, Lean, Watchlist, or a relative-promotion
  candidate; they are accuracy-visible forecasts only.
- Exactly one line is member-facing; alternate ladders remain internal price
  evidence.
- Genuine provider lines and prices are preserved; missing market consensus is
  represented internally as null and visually as the existing dash state.
- Stored locked decisions retain payload precedence and are never reconstructed
  or rewritten by this release.

## Rollback

Revert the complete r8 decision/product and r7 writer family for future unlocked
rows if canonical scopes duplicate, provider coverage contracts, any one-book
row becomes actionable, an existing corroborated forecast changes outside the
one documented main-line correction, the writer fails, or any stored locked row
changes.
