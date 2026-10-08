# CFB multi-book exact-price coverage predeclaration

Date: 2026-10-08

Status: owner-approved production candidate after historical qualification and exact current-board replay

## Problem

Missing public or sharp splits are already neutral and do not force a CFB market to No Play. The
October 8 exact writer replay contains actionable Spreads and Totals without split evidence. The
larger coverage gap is exact-price identification: 30–31 Held markets have a target quote but fewer
than two other named books at the identical line, so the target-excluded fair-price denominator
cannot be formed.

The paid The Odds API FCS request currently asks for only FanDuel, DraftKings and Rebet. The provider
charges the same three credits for up to ten requested bookmakers with the same three markets. A
read-only live request confirmed that BetRivers is currently returned for 27 of 43 FCS events while
the existing request omitted it.

## Frozen candidate

Keep the provider hierarchy, identity checks, exact away/home orientation, paired two-sided quote
requirements, timestamps, pregame chronology, hourly/T-60 cadence, request ceilings and 5,000-credit
reserve unchanged. Expand the same existing sport-level request to ten supported book keys:

- execution-eligible: the already released FanDuel, DraftKings and Rebet targets;
- consensus-only: BetMGM, BetRivers, Caesars, Fanatics, theScore Bet, BetOnline and Bally Bet.

The lower tier may fill only a missing sportsbook identity and cannot replace that sportsbook from
BALLDONTLIE, SharpAPI or CFBD. The seven added books can corroborate a different evaluated quote but
cannot become the evaluated target themselves and cannot enter the score/side market reader,
opening trail or movement arbitration. The candidate does not reduce the required two
target-excluded same-line comparators, manufacture a line, use missing splits as resistance, change
the independent score model, or add a request.

## Required replay

Run the sole writer with `apply:false` and its exact in-memory PMF. Report paired Moneyline, Spread
and Total quote coverage, Held-market recovery, every grade promotion/demotion, actionable-board
count, outlier-price behavior and provider credit headers. The candidate may advance only if the
request still costs three credits, all accepted rows pass the existing strict identity/pair checks,
the target-excluded denominator remains independent of the evaluated quote, and the board does not
flatten. No locked game or settled tracking row may change.

The audit also exposed intermittent statement timeouts when the sole writer projected market-only
history for the complete 86-game board in one large `IN` query. The candidate partitions the same
bounded, ordered, release-compatible read into 25-game batches. It does not change selected rows or
add provider calls; exact replay must prove byte-equivalent input history and complete successfully.

The owner approved the bounded lane after reviewing its 18 current-board Spread promotions and
confirmed that recovered non-actionable markets may publish as Watchlist. The approval does not
authorize broad actionability, a Best Angle exception, fabricated prices, or member-facing copy.

## Publication gate

If replay succeeds, bump the complete CFB evidence/member/decision/writer/fixture/snapshot/tracking
release family, update the release registry, run the CFB production suite and `npm run
verify:model-change`, rebase onto the latest production base, pass integration safety, publish by
protected pull request, and verify the live release and next natural refresh. Otherwise retain the
candidate as audit-only.

## Historical exact-price result

The replay reconstructed each FCS game's independent forecast chronologically and added the paid
provider's verified T-60 exact prices only for grading. Game results were never model inputs. The
selection block covered September 19–27; the frozen confirmation block covered October 3–4.

Removing the full-game anchor hold without a market-specific lane was rejected. It created 130
actionables over the full sample but went 20–24 and lost 7.48 units on untouched confirmation.
Confirmation Moneylines were 10–12, Spreads 11–12 and Totals 9–15. Best Angles were 6–13. Missing
splits therefore cannot be treated as either support or resistance, and broad grade recovery is not
authorized.

The predeclared Lean-only tournament selected one lane: a Spread already graded Lean by the existing
exact-price and market-evidence policy with model probability at least 58%. It was 25–9 (+14.31
units) in selection and 10–7 (+2.10 units) in untouched confirmation. Combined performance was
35–16 (68.63%, +16.41 units). No Moneyline candidate met the minimum ten-row selection requirement;
the Total Lean candidates were 3–5 in selection. Moneyline and Total actionability therefore remain
unauthorized when the canonical full-game anchor is absent. An anchorless Best Angle is also
unauthorized; every otherwise actionable non-qualifier is capped at Watchlist.

Historical reads used 750 paid credits for selection and 360 for confirmation. The final provider
header reported 14,052 credits remaining. These were read-only calls and produced zero database
writes.

## Exact current-board result

The October 8 live-provider replay covered 86 upcoming games and performed zero writes. Compared
with the same refreshed input run without the lane, the candidate changes 163 evaluated / 95 Held
market slots to 242 / 16. Grade counts move from 15 Best Angles / 79 Leans / 55 Watchlists / 14 No
Plays to 14 / 96 / 115 / 17. That is a net increase of 16 actionables, not a flattened board: 18
previously Held FCS Spreads become Leans while two formerly actionable anchorless tuples are capped
below actionability. Seventy-nine previously Held markets gain a real side, price and grade; the
Moneyline and Total recoveries remain non-actionable.

All 86 reconstructed forecasts reproduced their input means with zero absolute difference, no
negative team score was created, provider fallback cost remained three credits per current pull,
and the writer proposed zero database inserts in audit mode. The candidate does not alter any score,
PMF, prediction side, locked game, settled tracking row, stake, copy, label or layout.
