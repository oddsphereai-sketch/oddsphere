# Cross-sport complete tracking denominators — 2026-09-04

## Pre-change production evidence

SELECT-only production reads on protected main `aa422456f388d2f9c6e21d81fd84145e250d7b47` showed that CFB was the active defect: its 2026-09-03 ten-game locked slate contained 6 Moneylines, 10 Spreads, and 9 Totals. The omitted four Moneylines and one Total retained immutable model forecast sides but lacked an exact-price decision. NFL used the same market-scoped exact-price serializer and therefore had the same latent failure mode before its 2026-09-09 tracking launch. WNBA production was currently balanced at 177 rows per market, but its writer could withhold a side-bearing market or an entire otherwise-valid game when a price/tuple was unavailable.

The other live contracts were complete in the read-only audit: MLB 2026-09-03 had 9 Moneylines, 9 Totals, and 9 First Inning records (one genuine FI Toss-Up is intentionally excluded from W-L); NBA lifetime was 3/3 Moneyline/Total; WNBA was 177/177/177; EPL was 20 records per four markets; World Cup was 103 per four markets. UCL had 18 complete four-row pregame manifests, all still unlocked.

## Corrected contract

Accuracy, recommendation performance, and ROI are separate:

- Every immutable locked prediction with a real side counts toward overall W-L accuracy.
- Best Angle and Lean cuts include only records actually recommended as actionable.
- A side-bearing forecast whose exact price is unavailable is stored Held + No Play with null price, market probability, edge, expected value, and stake. It is accuracy-eligible after lock but cannot enter actionable or ROI calculations.
- A true null-side/no-prediction hold remains excluded. MLB First Inning Toss-Up remains the only intentional no-side prediction state.
- Unlocked records from every sport are excluded from public accuracy because they can still change.

NFL derives an omitted market's immutable side/probability from the T-60 `outcomeConfidence` tuple and its reference line from the same captured market payload. WNBA preserves its writer-owned side/probability/line and marks only the missing economic tuple as Held. Neither path invents a sportsbook, price, consensus probability, edge, EV, or grade.

## Expected impact and rollback

The current NFL board has all 48 exact-price tuples, so candidate count impact is 0. Current WNBA history is already balanced, so existing locked-row impact is 0. The change prevents future data-source gaps from shrinking one market denominator and allows the existing sole writers to fill only missing unlocked/future identities naturally.

Rollback the NFL tracking record/writer, WNBA prediction-record contract, reader acceptance constant, and aggregate contract together if any true null-side forecast enters W-L, any null-price row enters actionable/ROI, any locked row mutates, or any market count exceeds one per eligible game.
