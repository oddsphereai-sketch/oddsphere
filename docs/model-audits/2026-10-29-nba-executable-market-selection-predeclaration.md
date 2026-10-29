# NBA executable market selection and fair-reference repair — predeclaration

Date: 2026-10-29

Status: candidate verified against the October 29 production inputs. Publication
still requires a clean, latest-main pull request, merge, and live verification.
No locked record may be rewritten or reinterpreted. Results:
`docs/model-audits/2026-10-29-nba-executable-market-selection-result.md`.

## Incident

The October 29 CLE at ATL board contained fresh complete pairs at Circa and
Pinnacle, but all three markets published `No Play / no_market`. The incumbent
selected Circa ATL pick'em at -110, Circa Over 238 at -110, and Pinnacle ATL
moneyline -110. It then excluded the selected sportsbook from the no-vig fair
reference. No second sportsbook offered the identical number in each market:
Pinnacle had ATL -1 and Over 238.5, while Circa had no moneyline. The exact-line
fair probability therefore became null even though each selected quote had a
complete, fresh, coherent opposite side at the same sportsbook.

The displayed `ATL 0` was an actual Circa pick'em, not a fabricated number, but
`0` is not acceptable member notation. It must display as `ATL PK`.

## Candidate contracts

- Model / prediction record:
  `nba_professional_unified_2026_10_29_r23_executable_market_selection`
- Market marriage:
  `nba_market_marriage_2026_10_29_r24_executable_market_selection`
- Grade policy:
  `nba_grade_policy_2026_10_29_r14_coherent_same_book_fair_fallback`
- Locked member snapshot:
  `nba_locked_member_snapshot_2026_10_29_r5_executable_market_selection`
- Member lock publication:
  `nba_member_lock_publication_2026_10_29_r7_executable_market_selection`

The score artifact, roster residual, heavy-tail margin calibration, categorical
market reader, writer, lease, refresh cadence, injury authority, stakes,
tracking start, and lock boundary are unchanged.

## Predeclared behavior

1. Moneyline, Spread, and Total continue to require a complete two-sided quote
   at one sportsbook. Books and handicap points are never crossed.
2. A target-book-excluded exact-line no-vig reference remains preferred.
3. If that reference is absent, the selected sportsbook's complete exact-line
   pair may supply a clearly versioned no-vig fallback. A missing opposite
   price still fails closed.
4. Spread and Total evaluate every complete offered pair from books already
   accepted by the incumbent consensus/outlier filter. The executable quote
   with the greatest expected return under the existing coherent model
   distribution owns the displayed number, price, probability, and grade.
   No alternate number is invented.
5. A zero spread remains numerically `0` for settlement and tracking but renders
   as `PK` on future unlocked member output.
6. Market-reader movement remains same-book and categorical. This repair does
   not convert public splits into prediction authority or create a weighted
   market blend.

## Gates

- Focused unit tests must prove target-excluded precedence, selected-book
  fallback, rejection of incomplete pairs, expected-value selection across
  differing offered numbers, and `PK` display.
- The October 29 production-input no-write comparison must report every side,
  line, price, probability, grade, promotion, demotion, and actionable count.
- Every actionable promotion must have a complete exact quote, positive model
  expected return, high-quality inputs, known injuries, and an already
  validated grade lane. No actionable demotion may be hidden.
- Locked records must retain exact reader precedence and must not be migrated.
- `npm run verify:model-change`, focused NBA suites, and integration safety must
  pass from a clean committed worktree based on current remote `main`.
- After merge, production verification must confirm the live release IDs,
  refreshed unlocked records, coherent selected prices/lines, unchanged locked
  rows, cron/lease health, and member snapshot.

## Rollback

Restore r22/r23/r13 and the incumbent executable-line selector for future
unlocked rows. Never rewrite a row already locked under either release.
