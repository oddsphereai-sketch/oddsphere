# Prediction-market source starts versus the plotted window

Starting production base: `9b66451f241485591009484a8e005d205146a19d`.

The owner approved the smooth chart but correctly noted that its left edge did
not prove either source's true opening price. Existing Kalshi display collection
and current sportsbook comparison read the last 24 hours. The shared start is
the later source's first retained receipt, so it can hide an earlier quote even
within those histories. A rolling window must never be described as lifetime
market-opening coverage.

## Narrow presentation change

- Keep the approved curves, common chart edges, raw quote inspection, current
  source selection, book/side/point-line isolation and pre-lock ceiling intact.
- Show **Kalshi first available**, its actual percentage and full date/time,
  explicitly identified as **24h history · open unverified**. This is the first
  retained source observation, not a fabricated opening or a claim that Kalshi
  opened at that price.
- Show the sportsbook start's date/time. Use **Provider open** only for an exact
  same-book, same-side, same-point-line stored `provider_opening` observation.
  This can identify an older stored opening outside the recent chart without
  inserting it into the plot. Otherwise use **First recorded**, never Opening.
  A stop labeled `open` without provider-opening provenance is insufficient.
- Preserve the original same-book movement path, including round trips. Do not
  switch to another book's opening, another spread/total threshold, or the other
  team's quote merely to fill the opening field.
- Label the **Shared chart window** with its actual duration and describe the
  headline percentage-point change as a change over that chart window.
  Source starts can precede the common plot, and their separate dates make the
  distinction visible without compressing several days into a small chart.

## Coverage limits, not promises

No newly verified Kalshi lifetime opening is claimed in this release. A bounded
public diagnostic for `KXNBAGAME-26OCT29CLEATL-ATL` returned market `open_time`
2026-10-25T23:06:11.961252Z, earlier than the reader's 24h history. The opening
minute had bid 0.02 / ask 1.00 and no trade price. Treating its midpoint, a
previous-day quote, or the first retained 24h candle as a reliable market opener
would be misleading. Official field definitions:
https://docs.kalshi.com/api-reference/market/get-market and
https://docs.kalshi.com/api-reference/market/get-market-candlesticks.

This release adds no provider calls, database queries/writes, capture, refresh,
timer, schedule, model input, forecast, grade, stake, calibration or decision
change. Sharp Book Splits and Public Consensus are untouched. It does not repair
or replace any locked field. It only describes existing immutable stored
same-line evidence alongside a clearly scoped recent-window chart. All existing
locked values retain precedence; future/post-lock or unknown-time opening
candidates cannot enter this display context.

Focused tests prove opening provenance versus first-recorded fallback,
same-book/side/line matching, original dates, absence of future/post-lock
contamination, unchanged chart edges and original locked JSON. Run the existing
chart/contract suites, shared reader/immutability tests, TypeScript/lint,
production build and full safety suite. Publication requires fresh-main clean
integration proof, protected up-to-date PR checks, exact remote/local tree
identity, and actual deployed desktop/mobile verification.

## Local verification

The retained cross-sport reader rehearsal found 303 eligible book starts:
109 provider-opening records (23 NFL, 86 CFB) and 194 first-recorded fallbacks.
All input JSON stayed byte-for-byte unchanged. These are fixture coverage
counts, not a claim that every current game has an opening record. WNBA had
no current fixture in this rehearsal.

The actual built CLE@ATL reader at 1280px and 390px showed Kalshi first
available at Oct 28, 7:40 AM, Pinnacle first recorded at Oct 28, 11:00 PM,
and an explicitly labeled shared chart window from 11:00 PM to 7:00 AM.
The earlier Kalshi starting price did not get mislabeled as the chart's left
edge. The compact mobile two-column source-start footer fits below the graph;
the smooth chart and sharp-split section were unchanged.
