# CFB confidence / economics bridge r58 — predeclaration

Status: outcome-blind production-candidate declaration. No result join has been run for this
candidate.

## Trigger and scope

The provisional r57/r30 release correctly made forecast confidence primary and stopped a single
exact price or EV reading from erasing an otherwise strong play. Its remaining weakness was the
opposite presentation risk: the continuous confidence layer could replace the exact-decision grade
so completely that price and market economics appeared irrelevant to a premium Best Angle label.
The frozen 2024/2025 CFB policy evidence qualified Spread Leans but did not qualify the stronger
Spread Best Angle subgroup, so confidence alone is not sufficient authority for that premium tier.
September 4 results are incident evidence only and will not be used to select parameters.

This candidate changes CFB display-grade confidence only. It does not change the forecast PMF,
selected side, score projection, evaluated book/line/price, target-excluded fair probability, EV,
Bet/Shop execution, stake, provider calls, writer ownership, lease, T-60 timing, settlement, or
locked rows.

## Predeclared behavior

- Retain r57's selected-side model probability as the primary confidence signal.
- Retain r57's bounded, signed Circa, Playbook, same-book line movement, and same-book
  implied-price movement adjustment. Missing optional evidence stays neutral; no channel is an
  automatic veto, promotion, or side flip.
- Do not introduce a weighted model/market blend or a new disagreement formula. The market can
  affirm or resist the forecast only through the existing bounded evidence adjustment.
- Use the exact-price decision grade as a modest ordinal anchor on Spread confidence. Ordinarily,
  the final confidence grade may finish one tier above that decision grade, so price/EV context can
  distinguish premium placement without erasing a coherent Lean. A second-tier exception requires
  at least two independent, identity-valid affirming channels among strict Sharp splits, same-book
  movement, and public splits, with no resisting channel. A Spread may reach Best Angle only from an
  already-qualified Best Angle foundation or that same multi-channel affirmation. A lone signal is
  never a veto, promotion, or flip. The UMass regression remains eligible for Lean from Watchlist.
- Retain the graduated Moneyline price ceilings: -200 or better is uncapped, -201 through -499
  cannot exceed Lean, and -500 or worse cannot exceed Watchlist. These ceilings never create a No
  Play.
- Exact EV continues to choose Bet versus Shop. It does not directly set confidence or erase a
  prediction.

## Selection and acceptance gates

Apply the fixed ordinal rule without parameter search. Report the identical-input current board
and the release-pure locked diagnostic separately, including promotions, demotions, market mix,
extreme-price rows, and September 4 results. A board with unchanged actionables and premium-tier
demotions is acceptable: this release is a forward guard against confidence/economics decoupling,
not a requirement to manufacture picks. The result join is diagnostic and cannot be used to retune
the rule. Required focused and
full tests plus model-change verification must pass. Any unexpected side, probability, projection,
price, execution, stake, or locked-row change rejects the candidate. The sole writer remains under
`prediction_pipeline:cfb`.
