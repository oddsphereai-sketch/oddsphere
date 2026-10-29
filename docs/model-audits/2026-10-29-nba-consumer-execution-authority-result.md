# NBA consumer execution-line authority result

Date: 2026-10-29  
Status: live-slate candidate passed; production verification pending

## Provider proof

The read-only October 29 rehearsal matched all three games and normalized 214
complete rows across Bally Bet, BetMGM, BetParx, BetRivers, Betway, Caesars,
Circa, DraftKings, Fanatics, FanDuel, Pinnacle, and Rebet. It reported zero
incomplete book groups and zero provider or identity errors.

For CLE at ATL, the actual consumer board included:

- FanDuel ATL -1.5 -104;
- DraftKings ATL -1.5 -105;
- BetMGM ATL -1.5 -105;
- Caesars and Fanatics ATL -1 -110.

Circa's PK remains truthful internal evidence, but no longer owns the member
Spread. The candidate displays ATL -1.5 -104 at FanDuel. It does not fabricate
Hard Rock or convert Circa's number.

## Same-input board impact

The candidate was evaluated with the same independent artifact, injuries,
roster regime, price/split reader history, and evaluation time semantics as
the stored production board:

- games / markets: 3 / 9;
- scores changed: 0;
- directional changes: 1, POR -7 to MEM +7.5 because the unchanged POR by
  7.37 projection crosses the real consumer -7.5 line;
- actionables: 1 to 2;
- promotions: 1, ATL -1.5 -104 from Watchlist to Best Angle at 58.28%;
- demotions: 0;
- incomplete groups: 0;
- provider errors: 0.

Other real-line changes remain non-actionable Watchlists: SAC +6 becomes SAC
+5.5, SAC-NO Under 237.5 becomes Under 236.5, and MEM-POR Under 234.5 becomes
Under 233.5. Moneyline winners and every final score remain unchanged.

This result demonstrates source separation and exact-price coherence. It is
not a new historical accuracy claim and does not tune the independent model or
reader thresholds.
