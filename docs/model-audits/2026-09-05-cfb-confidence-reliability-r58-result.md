# CFB confidence / economics bridge r58 — frozen result

Date: 2026-09-05

This result follows the outcome-blind predeclaration in
`2026-09-05-cfb-confidence-reliability-r58-predeclaration.md`. No rule was retuned after joining
settled results.

## Current-board comparison

- Evidence date: 2026-09-05; 63 games and 159 evaluated markets.
- Incumbent r57: 4 Best Angles, 57 Leans, 76 Watchlists, 22 No Plays.
- Candidate r58: 1 Best Angle, 60 Leans, 76 Watchlists, 22 No Plays.
- Three unqualified Spread Best Angles become Leans: VMI +55.5, Tulsa +13.5, and New Hampshire
  +33.5. None has the required two-channel, no-resistance market affirmation. There are zero
  actionable removals, promotions, or side changes.
- The 61 confidence-actionable rows contain 54 exact-price `bet` rows and seven `shop` rows.
- Large-spread actionables remain 21. Forecast sides, probabilities, score projections, named-book
  prices, edge, EV, execution status, and stakes are identical.

The premium-only change is intentional. It does not flatten the actionable board merely to make
price visible. It adds a forward invariant: a Spread cannot receive Best Angle solely from model
confidence when the historically qualified exact-price tier is lower. A strong confidence case can
still reach Lean, and two independent affirming market channels with no resistance preserve a
positive Best Angle path. The UMass +29.5 regression continues to exercise the supported
Watchlist-to-Lean path under its strict Sharp and movement evidence.

## Settled diagnostic (not used for tuning)

Across every available release-separated lock from August 29 through September 4, CFB Spread is
8-15-2 overall; the nine rows carrying 55%+ model probability are 1-7-1. This 25-row, multi-release
diagnostic is too small to support a side-flip or probability re-fit, but it rejects treating raw
confidence as sufficient Best Angle authority. On the already-frozen September 4 cohort (8 games /
21 markets), incumbent and candidate are both 0 Best Angles, 8 Leans, 9 Watchlists, and 4 No Plays.
There are no side or grade changes, and the audited Leans finished 2-5-1. No result selected a
threshold or a weighted model/market formula.

## Safety and rollback

The change is grade-only, forward-only, and provisional. It does not modify any already locked row.
Roll back the full r58 publication family to r57 if natural output produces mixed release tuples,
loses a current exact quote, changes a side/probability/projection, violates T-60 precedence, or
creates unexplained actionability outside the tested ordinal and multi-channel promotion boundary.
