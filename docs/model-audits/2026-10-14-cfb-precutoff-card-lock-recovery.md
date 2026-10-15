# CFB pre-cutoff card lock recovery

Date: 2026-10-14

## Defect

WKU at Sam Houston was scheduled for 8:00 PM EDT with a 7:00 PM T-60
boundary. An earlier writer failure prevented the formal T-60 capture. The
first later T-60 payload was stored at 7:39:48 PM EDT and correctly carried the
sole health hold `t60_capture_late`, zero evaluated bets, and three held
markets. Reader r35 treated that late health-hold row as the member lock, which
replaced the previously published grades with three No Plays.

That was not the card members saw before the cutoff. The append-only current
release evidence proves the last complete pre-cutoff publication at 5:39:48 PM
EDT:

- Moneyline: WKU Watchlist, 56.3641%, -111 FanDuel.
- Spread: WKU -1 Watchlist, 54.2897%, -108 BetMGM.
- Total: Under 53.5 Lean, 59.1339%, -105 FanDuel.
- Projected score: WKU 26.4, Sam Houston 23.9; representative 26-23.

## Correction

The member publication path now pairs a late T-60 row held only for lateness
with the exact latest complete same-release payload published no later than the
scheduled cutoff. It derives a scheduled-boundary member row from that source
without changing either stored payload. The derived row records the source
hash, source capture time, late recovery time, and
`writer_t60_cycle_interrupted` reason.

The late row is proof that the formal cycle was missed; it is never a source
for replacement picks, grades, prices, probabilities, projections, or market
evidence. Recovery fails closed if the pre-cutoff payload is incomplete,
unpublished, held, from another release, hash-invalid, or contains a quote
observed after its capture.

## WKU-Sam Houston replay

The candidate was replayed against the immutable production evidence and
produced:

- lock state `locked`;
- locked at `2026-10-14T23:00:00.000Z` (7:00 PM EDT);
- WKU Moneyline Watchlist;
- WKU -1 Spread Watchlist;
- Under 53.5 Lean;
- representative score WKU 26-23 Sam Houston.

## Safety

- No evidence snapshot or prediction record is updated or deleted.
- No model, PMF, market reader, probability, side, quote, grade, stake, or
  provider cadence changes.
- A generic late/unhealthy row without an eligible pre-cutoff source retains
  the existing fail-closed behavior.
- Existing valid T-60 and prior explicit recovery rows retain precedence.

## Validation

- `npm run test:cfb-v1-production`
- Daily Edge API regression suite
- Daily Edge experience suite
- TypeScript
- `npm run verify:model-change`
- production-evidence replay for provider game `457761`

## Rollback

Roll back writer / fixture / lifecycle / compact snapshot / reader to r119 /
r90 / r2 / r50 / r35 together. Preserve all append-only evidence and existing
prediction records.
