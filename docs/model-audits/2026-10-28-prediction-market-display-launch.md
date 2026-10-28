# Prediction-market display launch

Starting production base: `b7aef3267bdd2bf492cf5f4f437119967fc78242`.
Branch: `codex/daily-edge-prediction-market-20261028`.

Scope is an additive member display, not an internal market-reader/model change.
No prediction DTO, locked payload, price authority, grade, probability, stake,
calibration, outcome, prediction writer, or prediction-pipeline lease changes.
The existing matchup layout, projected scores, odds/line tracking, split bars,
sport-specific stats, injuries, and analysis remain authoritative and unchanged.

## Source receipt

Read-only OWLS probes at 2026-10-28 19:19–19:20 UTC returned HTTP 200 for NBA,
NHL, NFL, NCAAF, MLB, WNBA, EPL, and UCL game-winner series. Their raw quote
envelopes carried cache ages of 16–42 seconds. NCAAB discovery returned HTTP 400;
CBB is intentionally absent until the provider supports it. League series keys
were confirmed against discovery rather than inferred from marketing coverage.

Raw `updated_time` is market metadata, often days old, and is never the quote
timestamp. Source freshness comes from `meta.cacheTimestamp`, or timestamp minus
ageSeconds. Retained quotes keep that exact timestamp and become Last available
after ten minutes; receipts over 24 hours old are not displayed.

Matching requires the exact sport/competition, original scheduled Eastern date,
both opponents, a complete coherent binary pair (three outcomes including Draw
for regulation-time soccer), and a unique event. Same-day ambiguity is withheld,
not guessed. No player prop or first-inning market is relabeled a game winner.
The full-game panel can accompany those reader tabs only as Game winner context.

## Capture and load

One new read per covered league per existing five-minute display capture (eight
calls per cycle at full coverage; at most 2,304/day or 69,120/30 days). No new
subscription, streaming connection, or schedule. Capture runs under the existing
sport-scoped display lease; prediction writers are untouched. Failure is isolated
from the split capture. The existing private snapshot table stores the distinct
release-scoped display key, as it already does for named-book split feeds.
Member requests perform cached snapshot reads only, never provider requests.

Up to eight hours / 100 actual observations per contract are retained. A missing
or partial upstream pair preserves the last coherent event. History is never
invented or backfilled with the illustrative chart. On first launch the reader
shows the current quote and volume while history builds. Activity bars use the
change in cumulative contracts only for contiguous observed intervals, not a
change in rolling 24-hour volume. Missing intervals and volume resets stay absent.
The feed is capped at 1,200 contracts and a 1.5 MB serialized budget; histories
are shortened before current quotes when needed to fit the shared cache.

The price shown is the YES bid/ask midpoint, not a calibrated win forecast.
Trading volume refers to the displayed contract, not sportsbook handle or a
directional money split. A Pinnacle comparison appears only for a recent,
complete, synchronized same-book full-game moneyline pair. It never substitutes
a Circa trail, publish-time implied probability, Total, Spread, or FI quote.

## Placement

Phone: below the existing Market Pulse/splits block, before injury/stat evidence.
For FI (which has no sharp split block), below First-Inning Intelligence.
Desktop/tablet: a slim row after the reader evidence and before full analysis.
The original two-team matchup grid and all sport-specific sections are retained.
Homepage/sample previews do not load or display live prediction-market data.

## Required acceptance (not yet a deployment claim)

- focused parsing/matching/retention/history/comparison and immutable-input tests
- existing reader and model-change safety suites; TypeScript, ESLint, build
- latest-main integration safety and protected/up-to-date PR checks
- verify exact production commit, natural five-minute display capture, raw/API/site
  agreement for supported live sports, responsive placement, and no model changes
- CBB and uncovered/ambiguous events remain absent rather than fabricated

## Prepublication verification

Read-only stored-slate rehearsal: all 12 NBA games tonight, all four NHL games,
all 14 NFL games, the MLB game, all ten EPL games, and all 18 UCL games matched.
The broader NBA next-seven-day board matched 32/51 and CFB matched 63/100;
upstream-unlisted events are not fabricated. WNBA has no current member slate.
Ticker-based Clippers identity and provider/member soccer-code collisions have
focused regression tests; existing public-provider normalizers are unchanged.

The actual built reader was checked in Chrome at desktop and phone sizes:
original compact two-team layout retained; no horizontal overflow; mobile panel
below the sharp split block and before Key Stats; desktop row about 152px high.
The local QA proxy replayed real captured receipts without production writes.
The retained timestamp was displayed honestly as Last available. A fresh NBA
probe advanced the source receipt from 19:19 to 19:41 UTC, with age 40 seconds.

Focused display tests, existing reader tests (228/228), TypeScript, focused
ESLint, the full model-change safety suite, and a production webpack build passed.
The optional Market Brain PostgreSQL proof is not configured locally; no Market
Brain/model path changes are included. Default Turbopack cannot follow the
external dependency symlink in this temporary worktree; webpack builds the same
source successfully. Final protected-PR and production checks remain required.

The OWLS account reported 297,414 requests remaining before the October 30 reset
at the last budget check. No account tier or subscription was changed.
