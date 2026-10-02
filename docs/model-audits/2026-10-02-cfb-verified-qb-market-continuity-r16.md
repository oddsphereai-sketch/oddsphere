# CFB verified-quarterback and same-book market continuity r16

Date: 2026-10-02

Starting production base: `8d31ea24bcbf689a71d7be15c40f00e6d12c56f8`

## Owner direction and scope

The owner reported that Delaware quarterback Nick Minicucci was expected to
miss the Liberty game and directed Oddsphere to account for the injury now,
refresh later official designations correctly, and publish the repair without
adding member copy, labels, badges, or layout changes. This release preserves
the independent scoring artifact and all locked evidence. It changes only
unlocked CFB evidence, expected-quarterback identity, market-movement identity,
and exact-price actionability under unresolved replacement-QB model risk.

## Outcome-blind evidence

- Delaware News Journal reported on September 30 that Minicucci injured his
  knee/leg against Virginia, left in the second quarter, and was replaced by
  Braden Streeter. Delaware's coach declined to provide an availability or
  practice designation:
  https://www.aol.com/articles/delawares-qb-conference-usa-opener-162854000.html
- Action Network's October 2 game page reported that Minicucci was not expected
  to play and identified Streeter as the replacement:
  https://www.actionnetwork.com/ncaaf-game/liberty-flames-delaware-fightin-blue-hens/289269
- The official Delaware preview named Minicucci as the season passing leader
  but did not provide a game-status designation:
  https://bluehens.com/news/2026/9/30/football-hosts-liberty-on-friday-for-sold-out-parents-family-weekend-game
- Direct read-only provider probes found that BALLDONTLIE NCAAF returns 404 for
  both `/player_injuries` and `/injuries`, Playbook currently returns no NCAAF
  injury report, and the exact SharpAPI event has zero player-prop rows. Missing
  provider evidence is therefore not interpreted as healthy.

## Released behavior

1. Exact-game, source-attributed likely-out evidence replaces Minicucci with
   active-roster backup Braden Streeter in the existing expected-QB field. No
   member-facing field, label, or explanatory copy is added.
2. A later league-scoped Playbook Out, Doubtful, or Questionable status for the
   expected quarterback supersedes the credentialed report. The last verified
   exact-game provider designation is retained if a later response omits it.
   An explicit Active, Available, Healthy, or Cleared status restores the named
   quarterback and removes the availability grade cap; omission alone never
   does so. A Questionable status restores the named quarterback while keeping
   the unresolved-availability cap.
   The Playbook read is one bounded league request per collection, not a
   per-game injury request loop. Successful responses use the existing shared
   cache; a failed response cannot erase retained evidence or the board.
3. Availability evidence selects a replacement from the already captured
   active roster. Unlocked and T-60 updates reuse that immutable roster context
   rather than opening a second provider-fetch path.
4. When a source-attributed expected-QB absence selects a replacement but the
   frozen score artifact lacks a validated starter-substitution response, an
   unlocked Best Angle or Lean is capped at Watchlist. The score, PMF, side,
   probability, price, and tracking denominator are not fabricated or erased.
5. Market movement now compares the operational opening only with a current
   quote from the same sportsbook. The independently price-shopped execution
   quote remains unchanged. Cross-book movement remains unknown instead of
   being manufactured.

## Validation and board impact

- The release-pure stored-board audit covers 99 games and 163 currently
  evaluated markets. Same-book movement changes 163 reads that were previously
  unknown, with nine grade promotions and fifteen demotions. Actionables move
  44 to 40; the two actionable promotions are CAL-UNLV Spread Watchlist to Lean
  and SAM-UAB Total Watchlist to Lean. Six actionable demotions include the
  Delaware Moneyline Lean to Watchlist. This is not a quota rule and does not
  suppress games or predictions.
- Delaware resolves to Liberty Moneyline / Delaware +7.5 / Over 49.5 on the
  stored replay. Its grades become Watchlist / Watchlist / No Play. Same-book
  FanDuel movement supports Liberty and resists Delaware +7.5 and Over 49.5.
- The live-provider zero-write writer replay proposes 97 still-upcoming rows
  from the 99-game weekly slate with zero capture failures. It publishes 158
  exact-price evaluations containing 17 Best Angles, 72 Leans, 59 Watchlists,
  and 10 No Plays, so the refreshed board is not flat. The remaining 133
  markets retain explicit market-anchor holds rather than guessed prices.
- The replay's bounded maximum is 94 calls. The injury repair adds one bounded
  league request per collection, not a per-game loop. Playbook's current NCAAF 404 is recorded
  internally as provider health and does not erase the sourced quarterback
  evidence or the board.

## Release and rollback

The current release family is evidence r29, collector r35, member r41,
market-reader r24, grade policy r16, decision r36, tuple r24, writer r83,
fixture r62, outcome contract r57, member snapshot r21, reader r10, tracking
r31, and verified availability r1. The independent score/model/distribution,
probability, and calibration releases remain unchanged.

Rollback the complete r16 publication family to the October 1 r15/r82 family.
Never rewrite a locked tuple or an existing tracking record. Hold publication
on missing games, mixed releases, score/side incoherence, writer overlap,
failed integration safety, or reader failure.
