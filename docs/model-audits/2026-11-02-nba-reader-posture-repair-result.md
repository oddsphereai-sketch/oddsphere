# NBA reader posture and audit coherence result — 2026-11-02

## Outcome

The bounded r31/r33/r22, consequence-r6, posture-r8 candidate passed the
functional and repository safety gates. This result does not claim improved
future betting accuracy. It proves that the three predeclared reader defects are
repaired without changing the independent score artifact, causal score law,
provider requests, authoritative writer, stake policy, or any locked member
record.

## Exact same-input current-board report

The read-only November 2 board evaluation used one pipeline result for both the
incumbent r21 grade posture and candidate r22 posture. It contained 15 games and
45 markets.

| Market | r21 Best | r21 Lean | r21 Watch | r22 Best | r22 Lean | r22 Watch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Moneyline | 0 | 8 | 7 | 0 | 8 | 7 |
| Spread | 1 | 6 | 8 | 1 | 6 | 8 |
| Total | 0 | 5 | 10 | 0 | 5 | 10 |

- actionable markets: 20 before, 20 after;
- Best Angle promotions: 0;
- Best Angle demotions: 0;
- all actionable promotions/demotions: 0;
- nonpositive-EV promotions: 0;
- complete market evidence: 15 of 15 games;
- qualified reads: 2 Moneyline, 1 Spread, 4 Total;
- actual independent-to-final flips: 0 Moneyline, 2 Spread, 3 Total.

The prior operator audit could report zero flips because it depended on stale
receipt token names. The repaired audit compares the stored independent and
final picks first and uses tokens only as backward-compatible fallback evidence.
It therefore reports the actual two Spread and three Total flips above.

The clean causal promotion path is covered by paired positive and negative unit
fixtures, but no live November 2 market met that path. Static sharp-book
agreement, public pressure, held quotes, or source counts did not promote a
grade. Off-contract static Spread and Total quotes are translated through the
released residual CDF for support/opposition posture only; they still have zero
score authority.

## Verification

Passed:

- `npm run test:nba-named-book-opposition`;
- professional candidate, market-specific grade, market-reader audit,
  display-separation, source-eligibility, runtime-artifact, and locked-member
  focused tests;
- `npx tsc --noEmit --incremental false`;
- `npm run verify:model-change` (exit 0; local Market Brain PostgreSQL proof was
  skipped because `MARKET_BRAIN_POSTGRES_URL` is unset, as specified by the
  repository script).

The exact board reports are retained as task evidence at
`/private/tmp/nba-r31-grade-impact.json` and
`/private/tmp/nba-r31-reader-audit.json`; they are not runtime inputs.

## Independent-model disposition

The reviewed independent-score challengers did not pass their own selection
gates. In particular, the residual experiment selected no candidate and the
four-factors candidates failed production gates. This release therefore does not
pretend to cure projection error with blanket margin widening, an early-season
Total offset, fixed star-player points, or a hidden market blend. Independent
model improvement remains a separate predeclared model change.

## Publication and rollback

The candidate may publish only through an up-to-date protected pull request
after latest-main ancestry and overlap verification. Post-merge production proof
must verify the exact release tuple, sole `prediction_pipeline:nba` writer/lease,
fresh data coverage, coherent score/pick/grade output, and locked-reader
precedence.

Rollback for future unlocked decisions is the complete predecessor tuple
r30/r32/r21/consequence-r5/posture-r7. Never rewrite, relabel, suppress, or
reconstruct an existing locked row during rollback.
