# CFB holistic confidence / price-portable execution r2

Status: production candidate; immutable locked rows remain unchanged.

## Change

The sole CFB writer now resolves the final confidence grade from the authoritative
selected-side probability plus one bounded signed market-evidence adjustment. Circa
money-minus-tickets, Playbook money-minus-tickets, same-book line movement, and
same-book implied-price movement can affirm or resist the forecast. Their combined
effect is capped at four confidence points. No individual ordinary channel is a veto,
automatic flip, or automatic promotion.

The evaluated named-book quote remains attached. Its exact EV now resolves execution
only: nonnegative EV is `bet`; negative EV is `shop`. It cannot change Best Angle,
Lean, Watchlist, or No Play. Identity, pregame timing, source/side/line coherence,
required target-excluded consensus, global health holds, and immutable T-60 locks
remain fail-closed.

This removes the former 24-point spread ceiling, American-price bands, conjunctive
EV/edge promotion floors, and categorical single-source resistance demotions from the
final grade path.

## Frozen evidence

The scorer and tier bands were frozen before the settled 2026-09-03 review. On the
28-market cohort, the incumbent board was 2 Best Angles / 4 Leans / 17 Watchlists /
5 No Plays; r2 was 6 / 11 / 6 / 5. That is 13 promotions and 6 demotions. Settled
confidence results were 4-1 for Best Angle and 4-5 for Lean. Displayed-quote Bet
actionables were 3-6; Shop confidence actionables were 5-0. UMass +29.5 was correctly
recovered as Lean / Bet from 53.48% model probability plus 2.4 bounded evidence points.

The 2026-09-04 current-board replay at 2026-09-04T19:38:54Z covered 8 games and 21
evaluated markets. It moved 0 / 4 / 14 / 3 to 5 / 6 / 5 / 5: 10 promotions, 7
demotions, 11 confidence actionables, 7 Bets, 4 Shops, zero side changes, and zero
unavailable evaluated quotes. Market mix was +5/-0 Moneyline, +5/-1 Spread, and
+0/-6 Total. Large spreads were evaluated continuously instead of being rejected by
line size: UTEP +40.5, Stanford +24.5, LIU +43.5, and Indiana State +35.5 were Leans;
NC A&T +28.5 remained Watchlist on its weaker 53.20 score.

## Safety and rollback

The authoritative PMF, selected side, forecast probability, exact evaluated quote,
target-excluded market probability, EV, provider-call budget, writer cadence, and
sport-scoped `prediction_pipeline:cfb` lease are unchanged. Tracking keeps a confidence
grade on Shop rows while excluding those rows from displayed-price ROI/actionability.
Rollback is the preceding r15 market-evidence grade path and r28 decision release.
Rollback triggers are mixed current-slate releases, a side or probability change,
missing-price rows presented as normal model decisions, writer/reader incoherence,
lease overlap, or an unexpected actionability collapse.
