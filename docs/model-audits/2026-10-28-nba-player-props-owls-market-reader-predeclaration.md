# NBA player-props Owls market-reader predeclaration

Date: 2026-10-28

## Problem

The active NBA player-props collector still depended on BALLDONTLIE plus a paid
gap request to The Odds API and did not consume the replacement Owls prop feed.
The reader also reduced all target-book-excluded books to one median, obscuring
whether Pinnacle/FanDuel/NoVig evidence agreed with or contradicted retail
books. A raw Owls rehearsal additionally exposed exchange-style ladder rows
whose apparent Over and Under prices were not a complementary two-way market.
Those rows cannot be allowed to select a line, flip a side, or promote a grade.

Owls does not provide verified player-level money/ticket splits. This change
must not invent them or reuse game-level splits as player evidence.

## Candidate

- BALLDONTLIE remains the authoritative slate, player identity, member-facing
  main line, opening history, and primary current target quote.
- The sole existing writer makes one bounded Owls NBA props request per cycle.
  Exact home/away identity, kickoff within 30 minutes, non-live state, six-hour
  freshness, complete Over/Under pairing, and a sane two-way implied-probability
  envelope are required before a row is admitted.
- Owls supplements the target-book-excluded reference lane and fills genuinely
  missing player/market scopes. It cannot displace an existing primary listed
  line or member-facing sportsbook merely because an alternate ladder is newer.
- The Odds API remains gap-only and is skipped when BALLDONTLIE plus Owls have
  already supplied corroborated coverage.
- Internal evidence retains separate reference-book and retail medians, counts,
  cross-cohort agreement, dispersion, and exact same-book movement. No new copy,
  label, or public split section is added.
- Rebounds adopt the release-pure all-book target-excluded direction that
  qualified in both development and confirmation. Points + Rebounds + Assists
  removes its losing exact-price direction override and returns to the
  independent side. Every other market retains its existing specialized rule.

## Required gates

- existing locked snapshots retain exact precedence and are never rescored;
- source normalization, malformed-pair rejection, identity, freshness,
  canonical-line, target-book exclusion, and opening-only tests;
- release-pure settled replay, separated development/confirmation, and exact
  current-board impact including promotions and demotions;
- one authoritative writer under `prediction_pipeline:nba`;
- focused tests, TypeScript, `npm run verify:model-change`, integration safety,
  protected PR checks, and live release/coverage verification.

