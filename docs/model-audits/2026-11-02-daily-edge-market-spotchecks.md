# Daily Edge market spot checks

Read-only November 2 checks used published snapshots, canonical stored sportsbook
lines, existing book-history tape, and the independent CBB source replay. No
provider request, prediction write, or locked-record modification was needed.

| Game | Checks and result |
| --- | --- |
| OKC–Cleveland | At the 15:31 UTC board, all three selected book/side/line/price tuples match canonical stored lines: BetMGM Over228.5 -110, DraftKings OKC ML +150, Caesars OKC +4 -110. Public and Circa split lanes remain separate; conflicting Total money signals do not become unanimous agreement. The 52.18% Total forecast stays Watchlist, below -110's break-even probability. |
| Chicago–Seattle | The 15:21 UTC snapshot has a 61.19% Seattle winner forecast at Caesars -170, correctly No Play: its forecast is below the price's 62.96% break-even probability. Under46.5's BetMGM -108 tuple is present in the existing tape. The later NFL writer independently verifies its 3/3 complete price set, current source receipt/hash/law contracts and all 13 historical records unchanged. Its later partial-buyback grade change is fresh market evidence, not a stored-history rewrite. |
| Ohio–Akron | The 15:30 UTC weekly board retains Ohio's 87.49% winner view separately from a steep -480 exact-price Watchlist; Ohio -13.5 -110 is Lean. Over51 -110 is Watchlist with a 51.75% exact-line forecast. Public fractions are displayed as coherent two-sided percentages and actual same-book trails retain their timestamps. |
| Detroit–Florida | At 15:30 UTC all three book/side/line/price tuples match canonical stored lines: Pinnacle Under6 -117, Circa Florida ML -168, Circa Detroit +1.5 -170. Same-book histories exist for all three. Public, DraftKings and Circa lanes remain distinct rather than relabeled as one source. Florida's 57.48% winner view does not make -168 actionable. |
| Everton–Newcastle | At 15:07 UTC Over2.5 -130 and Newcastle +120 remain No Play when model probabilities are below price break-even. Unavailable split evidence is not invented. |
| Murray State–Tennessee State, UTSA–San Jose State, Pepperdine–Cornell | All nine stored CBB probabilities reproduce exactly from their stored score distribution and uncertainty. Actual named quote orientation, prices, source split fractions and exact institution/Kalshi contracts were reviewed. The review found and reproduced the opposing-spread display error and professional-reference direction error repaired by the CBB r2 grade release. |

Quote observation timestamps are retained when a later poll confirms an
unchanged quote. A recent board refresh is not represented as a newly changed
price. Optional historical backfill budget deferrals are separate from current
price/split collection. Zero matching rows in a shared table are not treated as
missing football/soccer evidence: those products own separate authoritative
evidence snapshots and collectors.

These checks establish tuple/interpretation consistency for sampled published
decisions, not future betting performance or universal data completeness. CBB's
market-adjusted projected-score authority remains unqualified; the historical
St. Thomas venue/prior recovery remains internal. See the dedicated CBB repair
and qualification reports before claiming those gaps complete.
