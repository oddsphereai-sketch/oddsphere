# Sharp Book Splits scheduled capture and display continuity

Date: 2026-10-28

## Owner direction

Daniel Mengel reported that verified Sharp Book Splits repeatedly appeared and
then disappeared from NBA, NHL, and CFB member boards. He directed Oddsphere to
finish the Owl's replacement for the cancelled SharpAPI dependency while the
separate Market Reader task retains ownership of predictive reader changes.

## Production diagnosis

- The Owl's NBA split response was current but partial: it reported
  `book_unavailable`, exposed BetMGM only, and supplied ticket percentages
  without handle percentages.
- The independent DraftKings Network fallback returned an HTTP-200 maintenance
  page stating that betting splits were temporarily unavailable.
- The durable Owl's reader had a five-minute cache lifetime, but most sports
  had no five-minute capture schedule. A complete named-book observation could
  therefore appear and disappear between member requests without being saved.
- A newer single-axis observation could temporarily displace a previously
  verified complete member display after the source-hold window.

## Repair boundary

The member display feed is captured for MLB, WNBA, NHL, NBA, NFL, CFB, and CBB
every five minutes. Forced capture bypasses the request cache, retains bounded
timestamp-honest provider observations, and reports an empty or failed Owl's
response as a failed sport run instead of silently reporting success. At seven
league requests per cycle, the maximum scheduled usage is 60,480 requests per
30-day month, before ordinary application calls.

The history cap keeps the newest 96 observations for each exact event/book and
may retain one older complete money-plus-ticket observation per market. It
never combines axes from different timestamps. At the response boundary, a
previously verified complete exact-game section may replace a later partial
display section only after the existing market-reader bridge has finished.
That restoration is presentation-only and cannot enter the canonical decision.

Locked records remain immutable. Existing locked split evidence keeps exact
precedence, and a missing locked field continues to require the established
explicit pre-lock reconstruction path.

## Authority and expected board impact

This repair changes no pick, probability, projection, evaluated price, grade,
stake, lock, tracking row, model release, calibration release, or prediction
writer. It does not manufacture missing handle data. A game with no previously
captured complete pair continues to show the truthful available axis only.

Expected member impact is additive continuity: once a complete exact-game pair
has been verified and captured, a temporary upstream partial response or
maintenance page no longer removes it from the open member card. Same-input
prediction promotions, demotions, side changes, and actionable-count changes
are zero by contract.

## Verification

- Continuity tests prove that a current partial row cannot enter the internal
  decision and that the prior complete pair is restored only for the member
  display.
- Locked-row tests prove the restoration pass does not modify a locked card.
- History tests prove 96 newer partial observations cannot evict the prior
  timestamp-honest complete pair.
- DraftKings tests prove the maintenance shell fails closed and cannot replace
  the durable fallback.
- Cron contract tests prove all seven supported leagues are scheduled every
  five minutes and that the capture does not claim the prediction lease.

## Rollback

Remove the `sharp-book-splits-refresh` Vercel schedule and route, remove the
post-reader display restoration calls, and restore the prior bounded history
trim. Stored snapshots remain readable and no locked or model-owned record
requires mutation.
