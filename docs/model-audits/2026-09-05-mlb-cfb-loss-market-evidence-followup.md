# September 4 MLB and CFB outcome / market-evidence follow-up

Status: SELECT-only, release-separated diagnostic. MLB first inning is listed by the generic
record audit but is excluded from conclusions and behavior changes.

## Method

`scripts/operator/audit-daily-edge-loss-market-evidence.ts` read the immutable September 4 locked
records for MLB and CFB. The same predeclared movement, sharp, and public-evidence ballot was
applied to winners and losses. No outcome selected a threshold and no automatic flip rule was
introduced.

## Findings

- Tracking is coherent: the all-sport, CFB-only, and MLB-only September 4 consistency audits each
  report zero mismatches between the settled immutable rows and the public aggregate.
- CFB contained 24 locked predictions and 10 losses. Five losing actionables were present: Eastern
  Michigan Moneyline and four large-underdog Spreads. Eastern Michigan Moneyline carried movement
  resistance, but public support; Fresno State +21.5 carried movement support and UTEP +41 carried
  sharp support. A universal resistance flip or sharp-follow rule would therefore not explain the
  slate.
- The slate does not support a universal CFB side flip, sharp-follow rule, or new weighted
  model/market formula. The losing actionable rows contained both affirming and resisting market
  evidence, and the same warning ballots also appeared on winners. Those patterns should remain
  signed context in the existing bounded holistic read, not become a hard-coded result-chasing rule.
- The complete forward lock set from August 29 through September 4 contains 25 settled/pushed CFB
  Spreads: 8 wins, 15 losses, and 2 pushes. The nine rows at 55%+ model probability finished 1-7-1.
  This is too small and too release-mixed for a probability re-fit or side-flip rule, but it is a
  direct warning against assigning Spread Best Angle from raw confidence alone. The frozen
  historical qualification likewise passed Spread Lean and rejected the stronger Best Angle tier.
- MLB contained 42 locked predictions and 12 losses. Excluding first inning, the clearest losing
  actionable resistance was Tampa Bay–Texas Under: movement and public evidence both opposed the
  pick. The Eastern Michigan and Tampa Bay examples are warning evidence, not proof of a safe side
  flip; September 4 also contained several winning MLB predictions with net opposing ballots.
- Missing optional evidence remains neutral. Integrity, identity, stale-price, and lock failures
  remain fail-closed. Price and EV remain attached execution evidence and cannot independently
  erase forecast confidence.

## Production disposition

CFB r58 adopts a modest ordinal confidence/economics bridge and preserves the supported UMass +29.5
Watchlist-to-Lean path. A Spread Best Angle now requires an already-qualified exact-price Best Angle
foundation or at least two independent affirming market channels with no resistance. It does not add
a weighted model/market blend, makes zero retrospective September 4 grade changes, and removes zero
current actionables. MLB full-game retains its existing release because this one slate does not
establish a new universal market-reading rule. MLB props separately adopts graduated
price-confidence ceilings under r42. No stake or historical locked-row change is authorized.
