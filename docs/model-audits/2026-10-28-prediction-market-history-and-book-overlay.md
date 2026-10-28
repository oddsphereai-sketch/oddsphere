# Corrected prediction-market graph

Starting production base: `101f923d00ead5902c28d35e317775b7804fa8e5`.
Branch: `codex/prediction-market-book-overlay-20261028`.

The initial #848 launch omitted the approved sportsbook overlay and only had
observations captured after launch. This corrects both omissions; it does not
claim the first release already matched the approved mockup.

## Display-only boundary

No prediction DTO, model input/output, projection, probability, grade, stake,
calibration, market-reader logic, lock, tracking record or prediction writer is
changed. The existing five-minute display cron remains the only feed writer.
Current quotes remain OWLS receipts with original timestamps. Locked member
payloads are read unchanged; the new panel is separate live market context.

## Real historical Kalshi quotes

The official public endpoint is documented at
https://docs.kalshi.com/api-reference/market/batch-get-market-candlesticks.
It accepts up to 100 exact tickers / 10,000 minute candles per response.
An unauthenticated probe of the exact SAS/UTA contract returned HTTP 200 and
383 actual minute observations. A requested five-minute period returned no
candles; therefore fetch supported one-minute candles and aggregate complete
five-minute intervals locally. No synthetic opening candle is requested.

Require exact ticker, real bid and ask closes, valid spread, actual closed
minute timestamp, and all five minutes before plotting an interval's volume.
The graph uses bid/ask midpoint consistently for historical and current prices.
Null prices / synthetic previous-price-only candles remain absent.
Historical volume is already an interval total; live volume is a cumulative
delta. They are kept separate, with no subtraction across that boundary.
Real source gaps break the Kalshi line rather than being filled in.

Capture is bounded to three sequential batches of 20 contracts per sport per
cycle, 2.5 seconds per request, up to eight hours / 96 aggregated candles per
contract. Each successfully checked contract is revisited no more than hourly;
remaining new contracts are picked up in later five-minute cycles. The existing
1.5 MB feed budget shortens histories first. History failure cannot remove a
current quote or fail the separate split capture. Member requests never call
Kalshi or OWLS. No trading endpoints, new credentials, subscription or tier
upgrade are used; OWLS credentials are never sent to Kalshi.

## Second line: one real sportsbook

Use the exact selected team's existing moneyline trail (or its explicit opposing
trail). Retain one real book only, preferring the reader's named movement
reference, then Circa/Pinnacle where available, then a coherent same-book
fallback. Require a current/locked endpoint and valid observations within eight
hours. An unknown side or missing reference is not substituted from another
team/book. Point times are never shifted to match Kalshi.

The sportsbook curve is its odds-implied percentage, including sportsbook
margin, not a forecast or value claim. That semantic is labeled explicitly.
This also avoids pretending a two-outcome normalization is valid for three-way
soccer. The graph is game-winner context on every tab, never a Total/Spread/FI
probability graph. Original same-book odds tracking and split UI stay unchanged.

## Read-only rehearsal

All 24 NBA outcome contracts tonight returned multiple real historical points
(8–94 five-minute intervals in the first bounded rehearsal). The current stored
reader has a verified same-book trail for all 12 NBA and all four NHL games.
Other historical coverage varies with actual contract age and liquidity; absent
source observations are not manufactured. MLB, NHL, NFL, CFB, WNBA, EPL and UCL
were included in the same read-only endpoint rehearsal without database writes.

Required before success: focused historical/identity/volume/failure tests,
existing reader/capture tests, TypeScript, ESLint, full safety suite, production
build, real-data desktop/mobile QA, clean fresh-main integration check, protected
PR checks, exact production deployment and natural capture/UI confirmation.
