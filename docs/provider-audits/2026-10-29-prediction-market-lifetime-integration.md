# Prediction-market lifetime display integration

Starting production base: `3713fcef00a54230632e22aa8ef60ad3654a7671`.

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
