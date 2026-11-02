# NBA neutral tie and corroborated opposition result — 2026-11-02

## Outcome

The bounded r32/r34/r23 candidate repairs the two owner-approved product defects
without changing the independent score, causal market-consequence law, source
hierarchy, executable price, provider load, writer, lease, stake, or any locked
member record. It does not claim improved future betting accuracy.

## Exact same-input board report

The read-only November 2 comparison used one pipeline result at
`2026-11-02T16:39:57.477Z` for both the incumbent r22 and candidate r23 grade
policies. It contained 15 games and 45 priced markets.

| Market | r22 Best | r22 Lean | r22 Watch | r23 Best | r23 Lean | r23 Watch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Moneyline | 0 | 8 | 7 | 0 | 7 | 8 |
| Spread | 1 | 7 | 7 | 1 | 5 | 9 |
| Total | 0 | 5 | 10 | 0 | 2 | 13 |

- actionables: 21 before, 15 after;
- live promotions: 0;
- live demotions: 6;
- net actionable change: -6;
- nonpositive-EV candidate actionables: 0;
- all three markets retain actionable representation;
- paired synthetic grade fixtures prove clean causal Lean-to-Best promotion and
  corroborated Lean-to-Watch demotion across home/away, favorite/underdog
  prices, and Over/Under sides.

The six same-input demotions were CHI-PHI Moneyline, Spread and Total; NO-MEM
Total; TOR-LAC Spread; and MIA-LAL Total. Every one contained opposition from
both Circa and Pinnacle. Single-source or risk-only evidence produced no new
demotion.

## Exact 50/50 repair

OKC-CLE Total was the only exact 50/50 coordinate on the 45-market board.
Incumbent ordering labeled Over and recorded an Under-to-Over causal flip even
though the final projected Total exactly equaled 229.5. The candidate retains
the independent Under side, records no flip (`correct`), and remains a
non-actionable Watchlist at 50.0%. No other side changed from this rule.

## Verification

Passed before publication:

- NBA distribution and exact-tie unit assertions;
- named-book opposition and mirrored grade scenarios;
- market-signal consequence and reader-decision tests;
- the complete `test:nba-named-book-opposition` suite;
- locked-member and lock-coherence tests;
- TypeScript and `npm run verify:model-change`;
- clean latest-main integration safety.

The final command receipts and pull-request checks remain the publication
authority; this document does not substitute for post-merge live proof.

## Production publication proof

PR #927 merged to production as
`67f84c4fdda8943b9540c284623908e74e885dbb`. Immediately before merge,
`origin/main` remained `baf5f9234c9dc1ec89cd2977c0861a517937cfb8`,
the candidate contained that base, integration safety passed, the required
`current-main-ancestor` check passed, and GitHub reported the PR clean and
mergeable. Vercel then reported the exact merge commit deployed successfully.

The existing authenticated `/api/cron/nba-daily-refresh` writer completed as
production log 349237 and published the member snapshot at
`2026-11-02T16:50:05.897Z`. It was operationally partial because the Owls event
identity endpoint did not match the 14 scoped games; unmatched rows were
preserved by the existing fail-safe. This did not create a market-data hole in
the published current slate: the final read found current prices observed from
`2026-11-02T16:48:45.781Z` through `2026-11-02T16:48:52.208Z`, two-sided price
trails, public splits, and sharp-book splits for every one of the 45 markets.

The existing leased `/api/cron/tracking-refresh?sport=nba&date=2026-11-02`
writer completed successfully as production log 349257 with 45 updated rows.
Read-back proved:

- 45 of 45 rows on model/prediction release r32;
- 45 of 45 rows on market marriage r34 and consequence r6;
- exactly 15 games with 15 Moneylines, 15 Spreads, and 15 Totals;
- 14 Leans and 31 Watchlists on the moving live input, with zero Best Angles;
- zero stored/member side, grade, score, or market mismatches;
- zero missing selected prices, opposing-side trails, public splits, or
  sharp-book splits;
- zero nonpositive-EV actionables;
- OKC-CLE Total at 229.5 and exactly 50% remained Under/Watchlist, rather than
  manufacturing an Over flip;
- zero locked rows on this pregame slate, so publication had no locked payload
  eligible for mutation. The focused and full gates separately proved writer
  immutability and locked-reader precedence.

This is product-contract and publication evidence, not a future hit-rate claim.

## Rollback

Rollback for future unlocked decisions is the complete r31/r33/r22 tuple with
consequence-r6 and posture-r8. Never rewrite or reinterpret an existing locked
row. Hold or roll back on mixed release identifiers, a nonpositive-EV
actionable, unexpected additional board contraction, writer/lease failure,
missing required market evidence presented as a normal grade, score/pick/grade
incoherence, or member/stored snapshot disagreement.
