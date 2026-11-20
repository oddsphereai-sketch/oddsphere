# NBA frozen Total and Spread performance — November 20

Starting remote-main base: `ea547d8f812481ead8d065f72d502a9b8503fc06`.
Task branch: `codex/nba-total-spread-integrity-20261120`.

## Finding and limits

The owner reported very weak recent NBA Totals and possible Spread problems.
The November 17–19 frozen cohort confirms the slump: Total 5–15–1 and Spread
8–13 across all predictions. Best Angles plus Leans were Total 1–3 and Spread
3–7. These are different denominators; Watch/No Play direction must not be
presented as recommended wagers.

No numerical behavior change is authorized by this report. The work repairs
an operator diagnostic that was still a scaffold and returned no calibration
report once 30 settled games existed. That monitoring defect did not cause the
losing picks. It prevented that operator command from measuring them.

## Exact frozen release cohort

The bounded read returned 309 locked records / 103 games from November 6–19:

- Model: `nba_professional_unified_2026_11_04_r36_paid_consumer_book_coverage`.
- Marriage: `nba_market_marriage_2026_11_04_r38_paid_consumer_book_coverage`.
- Grade: `nba_grade_policy_2026_11_06_r31_moneyline_wager_price_boundaries`.
- Locked from `2026-11-06T23:00:33.178Z` through `2026-11-20T00:00:57.090Z`.

| Market | All frozen predictions | Best Angles + Leans | Wager units |
|---|---|---|---:|
| Moneyline | 69–34 | 23–10 | −0.624 |
| Spread | 47–56 | 12–21 | −9.818 |
| Total | 53–49–1 | 13–11 | +1.006 |

Units risk one unit at each saved actionable price; they are not stake-weighted
member returns. Pushes return the unit. There was no November 19 Total Lean or
Best Angle: its four losing Total predictions were non-actionable.

Spread actionable mean probability was 60.02% versus 36.36% observed wins
(Brier .289474). Total actionable mean probability was 58.91% versus 54.17%
observed wins (Brier .247353). Small recent samples are not independent evidence
for new coefficients or automatic reversals.

The saved independent sides, evaluated at the same frozen handicap, were:

| Market | Independent wins | Final wins | Changed to win | Changed to loss |
|---|---:|---:|---:|---:|
| Moneyline | 71 | 69 | 2 | 4 |
| Spread | 52 | 47 | 12 | 17 |
| Total | 56 | 53 | 2 | 5 |

This establishes that market reading runs and sometimes changes direction. It
is an attribution diagnostic, not a validated replacement backtest. Opposite-side
prices are not invented to claim hypothetical ROI. Most recent Total losses
were already present in the independent forecast; turning off the reader is
not an established repair. The paired side-change samples are too small to
establish a reliable causal effect.

## Pipeline and integrity checks

- All 309 locked records are graded. Canonical finals match all 103 games'
  actual home/away scores; saved side, line, probability and price match their
  frozen DTOs. No settlement or tuple-binding disagreements were found.
- No inspected lock/capture was postgame or used a future source clock.
  Two locks were more than 15 minutes late relative to T−60, but remained
  pregame; this does not explain the reported three-day slump.
- Current-season professional input storage contains 226 finals, matching the
  canonical final count through November 19. The latest input capture is
  November 20 at 11:30:22.466Z. This is not evidence of a stale stats feed.
- The saved November 20 reader publication at 12:30:55.707Z has nine current-day
  games with all 27 market prices. It also contains future schedule cards;
  their missing prices must not be mistaken for current-day missing prices.
- The normal NBA refresh remains partial because six later-day games lack
  18 executable price scopes. Named-book history backfill is deferred to
  preserve provider allowance. Retained current quotes remain available;
  these warnings should not be described as universally green health.
- Current-day records retain five ML Leans, two Spread Leans, three Total
  Leans, no Best Angles. This change has zero promotions, zero demotions,
  zero score/side/price/probability/stake changes and no runtime version bump.

## Operator repair

`calibration-report.ts` now reads bounded, paginated scalar frozen evidence,
not duplicate full member cards. It separates model/calibration/grade releases
and lock ranges, actionable wagers from all forecasts, and results by date.
It reports saved-price units, Brier/log loss, probability buckets, calibration
gap, pushes, pending/unpriced rows and same-input independent/final directions.
It flags contradictory settlements, invalid clocks/probabilities, held
recommendations and duplicate release slots. It fails rather than reporting a
truncated page budget or overwriting an existing output file. It never fits,
calls a provider, writes the DB, changes a lock or recalculates a member pick.

Run explicitly with an inclusive range of no more than 31 days:

```bash
node --env-file=/absolute/path/.env.local --import tsx scripts/audit/nba/calibration-report.ts \
  --from=2026-11-06 --through=2026-11-19 --output=/private/tmp/nba-frozen-report.json
```

Verification: the new focused audit tests; existing continuous-consequence,
professional candidate, point-in-time inputs/features, professional market
reader, lock-coherence and immutable locked-member-reader suites; ESLint; and
a SELECT-only 309-row production rehearsal with zero issues. Focused TypeScript
checking passed. The full repository TypeScript check exhausted Node’s default
4 GB heap before reporting diagnostics; it is not claimed green.

The next numerical challenger must test source-level and movement information
jointly with the independent residual, preserve causal chronology/target-book
exclusion, and validate confidence as well as direction and exact-price value.
November 6–19 outcomes are now development evidence; they must not be reused
and called an untouched confirmation. No challenger, automatic flip, blanket
confidence cut, new timer, new writer or provider request is released here.

Private evidence and the compressed original locks are retained under
`ops-local/learning-lab/nba-total-spread-audit-20261120/`; raw payloads are not
committed. The performance problem is not declared fixed by this operator repair.
