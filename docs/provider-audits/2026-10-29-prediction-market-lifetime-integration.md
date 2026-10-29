# Prediction-market lifetime display integration

Starting production base: `3713fcef00a54230632e22aa8ef60ad3654a7671`.
Integrated production base: `5d192fa9a99785c739e8443c55bffb7504af9710`
(NBA consumer execution authority and trail coherence). No overlapping files;
the upstream model, price source and locked-reader repair remain unchanged.
Subsequent integrated bases: `0ea6af8e66e5e4337b7b0f441e34db034dbb529c`
(NBA consumer history) and `47fcef8e84024dd812634b52aa9dc947966d5dbb`
(NFL navigation/member-cache invalidation). Both have no task-file overlaps;
their full detail loading, consumer trails and cache invalidation are preserved.

Scope: display-only Daily Edge prediction-market panels across the existing
supported sports and market families. No prediction, projection, selection,
probability, grade, stake, model input, public/sharp split, or locked payload
writer changes. Existing model releases and prediction leases remain unchanged.
The existing five-minute display capture remains the sole history writer.

The Cleveland–Atlanta NBA game has moneyline contracts in OWLS but no spread or
total event in the current OWLS feed. Direct exact-event checks against Kalshi
also returned 404 for both on October 29. The reader must explain market-specific
unavailability and retry normally, never silently disappear or borrow moneyline.

Plan: retain lifetime source histories and opening provenance in display-only
storage; collect bounded OWLS opening-to-current book history on the existing
capture; use Kalshi market open time for bounded lifetime candle backfills;
preserve real source timestamps and same-book/side/line isolation. Full history
can start at different times on one honest axis. Unknown openings must remain
unknown rather than fabricated. Existing locked evidence retains precedence.

Publication requires focused history/coverage/lock tests, unchanged input JSON,
cross-sport rehearsal, lint, application typecheck/build, model-change safety,
fresh-main integration safety, protected PR checks, exact verified tree and live
desktop/mobile proof. Provider calls and retained payloads must be bounded;
member requests may never trigger upstream provider calls.

## Implemented display contract

- Lifetime Kalshi history is requested from raw market `open_time`, using minute
  candles for up to six days or hourly candles (plus opening-hour minute
  evidence) for up to 366 days. The existing public-history ceiling remains
  three requests/sport/cycle, so cold backfills rotate rather than fan out.
- Both candle/current histories retain their original source times. An opening
  minute with a wide or empty bid/ask cannot create an invented fair opener.
  The earliest usable quote is explicitly distinguished from market-open time.
- OWLS `/api/odds/history`, without a rolling-hours filter, supplies each chosen
  book/market/side's reported opening and subsequent main-line changes. These
  live-history receipts are display-only, not the canonical internal NFL tape,
  and do not attest that a retrospective quote was available to an old model.
- The stored opening survives later refreshes, outages, sampling, and rolling
  windows. Exact-line probability curves never combine different thresholds;
  the original opening line and separate same-book point-movement sparkline
  retain that context even when today's total/spread changed.
- Full available source history is the default unlocked view; an explicit 24h
  option keeps a long market usable without pretending the recent view is its
  opening. Sources have one time axis but no fabricated pre-opening segment.
- Missing contracts, feed failures, pending sportsbook lines, unsupported
  selections and missing pre-lock history render distinct compact states. The
  existing 60-second member retry and five-minute shared capture remain in
  place; a later matching contract can populate without a manual page repair.
- Stored locked book evidence always wins; no live provider history repairs or
  replaces a locked field. No Kalshi volume enters sharp money or a model.

## Request and storage bounds

New paid reads are <=1 discovery and <=3 history requests/sport/cycle, capped at
12 discovery and 48 history attempts/sport/UTC day, persisted across cron runs.
Discovery is reused for two hours; full book history refreshes daily, while the
existing canonical tape supplies current quotes. Optional capture stops at a
50,000-request monthly reserve. At eight supported sports, the additional hard
daily limits imply <=14,400 requests in 30 days; actual usage depends on active
slates. This is an incremental ceiling, not a claim about all account usage or
an instruction to upgrade. Existing paid capture is not increased per member.
The unchanged public-history ceiling is separate and uses no OWLS allowance.
Book histories are losslessly compressed, <=450 identities and <=128 sampled
real observations per identity, with a separately retained original opening.

## Read-only provider and cross-sport proof

The exact CLE–ATL rehearsal recovered Pinnacle's reported ML opener -110 at
Oct 28 10:49 PM ET, and Circa's Over 239.5 -110 / ATL PK -110 at 10:55 PM ET.
The Kalshi winner market opened Oct 25; a full backfill recovered 177/181
sampled historical quotes, not just the recent chart window. Its opening minute
was not a usable two-sided price; it remains first-quoted rather than a fake
verified opening.

The exact CAR–GB NFL rehearsal recovered Circa ML -190 from Oct 25 8:55 PM ET,
and Total 47 -110 / GB -3.5 -110 from Oct 20 4:05 PM ET. The responses held
18/29/31 real main-line observations. Kalshi market open was Oct 20 04:06 UTC;
the bounded long-market path recovered 183 hourly/minute points on one winner
and deferred the other to the next existing capture cycle, respecting the
three-request ceiling. No production snapshot or internal research tape was
written during either rehearsal.

SELECT-only coverage checked NBA, NHL, NFL, CFB, MLB, WNBA, EPL and UCL. There
were no current MLB games; future NBA/CFB rows without a priced selected line
were counted separately from matching contracts. Every input JSON remained
unchanged. NHL (33/33), NFL (42/42), WNBA (3/3), EPL (30/30) and UCL (54/54)
had matching stored contract coverage in that read; NBA/CFB had real missing
contracts and/or unpriced selections that must show explicit states rather
than borrowed markets. These are point-in-time coverage counts, not a promise
that providers publish every contract.

The first integrated build, full TypeScript, focused suites, lint, integration
safety and `verify:model-change` passed. The optional local PostgreSQL proof
was skipped because its URL is unset. Final affected checks and live deployed
proof are still required after the last UI/budget refinements.
