# NBA rolling market-evidence capture

Date: 2026-10-15

Release: `market_intelligence_v2_shadow_capture_2026_10_16_r3_paginated_nba_price_window`

## Purpose

The NBA member board now exposes the next seven Eastern calendar dates, but the
first Market Intelligence V2 capture only matched SharpAPI rows to the current
date. On October 15 the provider already exposed opening-week split rows for
October 20 and 21. Leaving the collector current-day-only would throw away the
five-day pre-opener sequence needed to validate movement, persistence, public
resistance, and source-book disagreement.

## Contract

- The existing `public_splits_observations_refresh` job remains the only owner
  and continues under `prediction_pipeline:nba`.
- One league-level SharpAPI `/splits?league=nba` pull is matched to the current
  date through current date plus six. The change does not add one request per
  date or create a second timer/writer.
- A provider row is accepted only when league, event-id date, normalized away
  team, and normalized home team identify one canonical game on that same date.
- Current-day preseason rows remain available for pipeline rehearsal. Future
  rows must clear the authoritative NBA public-tracking date boundary, rather
  than trusting the legacy ESPN seed's inaccurate `season_type` field.
- NBA provider-history calls remain disabled. Repeated current snapshots form
  the append-only forward sequence with their actual provider observation and
  fetch timestamps.
- The existing exact-date MLB path, history recovery, WNBA/NHL collectors,
  snapshot writer, and resolver semantics are unchanged.

## Authority boundary

This release is observation-only. It cannot change a model input used by the
active NBA release, projected score, probability, side, market selection,
price, grade, promotion, demotion, stake, lock, tracking row, member display,
copy, or layout. NBA remains `audit_required`. Evidence may receive decision
authority only after a settled chronological replay establishes source-specific
rules, promotion/demotion balance, calibration, return, and board-count impact.

## Expected impact and rollback

For identical model input, prediction and grade impact is exactly zero. The
expected data impact is additional source-book split observations for exact
future regular-season events already present in the seven-day schedule.

Rollback is the r2 rolling-window release. Roll back if the capture accepts
an event on the wrong date, maps one provider row to multiple games, includes a
future preseason event, increases provider calls by date count, overlaps a
writer/lease, changes any member/model field, or destabilizes the existing MLB
history path.

## October 16 pagination correction

The rolling-window selection was correct, but the current `lines` read used one
unpaginated Supabase request. The eligible window contained more than 1,000
current outcome rows. The response therefore ended inside the current-date
preseason portion of the query, and the collector wrote opening-week splits
without the corresponding opening-week price observations. At 12:43 UTC on
October 16, the three October 20 games had 1,550 stored split observations and
zero V2 price observations even though the canonical `lines` table contained
complete multi-book prices.

R3 pages the existing `lines` read in deterministic `id` order, requires an
exact row count on every page, rejects a changing count, and fails closed on a
short page. A 2,305-row regression fixture proves all three pages are retained;
a deliberately truncated page is rejected. This changes only observation
capture. It does not grant the NBA resolver authority and does not change any
prediction, score, probability, side, grade, stake, lock, or member field.

Rollback is r2. Roll back if the paginated read duplicates or omits a current
line, changes the request schedule or provider-call count, affects another
sport, or alters any published decision.
