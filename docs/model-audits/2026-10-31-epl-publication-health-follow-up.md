# EPL current-price publication follow-up — October 31, 2026

Starting base: `506315ba36d12c2b6d2fa2ee0837c22bddce310b` (PR #893).
Owner direction remains the all-product data-health repair, with no current MLB props after season end.

The first protected deployment passed local and PR checks. Its live verification
proved UCL r13/r16 published at 12:58:42 UTC with 49/72 current selected prices,
23 explicit holds, zero hard errors and the shared soccer lease. No paid calls
were made: the account retained 947 credits below the unchanged 1,000 reserve.
MLB's current-date production game/props readers returned zero rows and no fallback.

The same live verification caught a remaining EPL gate: r22/v27 wrote 36 current
scheduled-market records but did not publish its member snapshot because one
exact 2.5 total price was unavailable (35/36 scheduled selected prices, 88/90
outcomes). One started game's four immutable markets remain separate. The
source recovery is real; an all-prices gate prevented those fresh prices reaching
the member page. No success was declared from the preview.

EPL r23/v28 and member lifecycle r7 allow an honestly held missing quote to remain
visible without freezing every complete market. Missing scheduled fixtures,
missing market forecasts, unavailable prices without Held/No Play, incomplete
priced outcome vectors and total current-price loss remain publication errors.
Final/live fixture behavior, all locked writer/reader precedence, exact provider
timestamps, the sole leased writer, provider budget/reserve and request cadence
remain unchanged. No replacement writer or shadow production path is introduced.

This is publication correctness, with no fitted coefficients or threshold changes.
The paired frozen 40-market response remains byte-identical: 39 prices, one hold,
nine actionables, zero new promotions, zero demotions, zero forecast/probability/
price/stake changes relative to r22/v27. The incumbent gate rejects that same
response; the candidate admits it with two explicit coverage warnings. Existing
locked payloads are neither reconstructed nor changed. The prior #893 source
repair's five EPL promotions / zero demotions remain documented separately.

Regressions cover a held partial market, dishonest holds/actionables, all-price
loss, missing fixtures/markets, incomplete priced vectors, and unchanged input
payload. Existing EPL immutable-lock suites remain mandatory. Required checks:
focused EPL suites, full model-change verification, TypeScript, focused lint,
production build, clean current-main integration safety, protected PR/tree proof,
and production release/publication/source-age/coverage/lock verification.

Rollback: revert this follow-up family for future unlocked rows only to r22/v27
and member lifecycle r6, preserving every existing locked field. This restores
the publication blocker and is not a fix for upstream exact-price absence.
