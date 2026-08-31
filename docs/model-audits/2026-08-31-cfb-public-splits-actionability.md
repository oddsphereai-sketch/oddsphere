# CFB public-consensus market integration release audit

Date: 2026-08-31

## Decision

Advance the bounded public-consensus market input and exact-economics grade-ladder update as one
versioned CFB release. The change corrects the prior production boundary where Playbook ticket and
handle percentages were fetched, stored, and rendered but never entered projections or grades.
It does not classify aggregate public consensus as verified sharp betting.

## Model and evidence contract

- The authoritative outcome distribution remains 25% immutable independent-football PMF plus 75%
  canonical current-market PMF.
- Same-game, pre-evaluation, cadence-fresh Playbook money-minus-ticket divergence outside 8pp can
  move the market anchor by at most 0.75 margin/Total points. Spread and Total require a Playbook
  context line within 0.5 points of the canonical line.
- Strictly matched fresh Circa retains its 1.5-point maximum. When both qualify, the Circa shift is
  primary, the public shift is halved, the combined shift remains capped at 1.5 points, and
  opposing public data cannot reverse Circa's direction.
- The one adjusted PMF supplies expected scores, representative score, winner and exact-line
  probabilities, prediction side, EV, and grade inputs. No reader recomputation or override exists.
- Public, strict-sharp, and same-book movement directions are stamped separately in each evaluated
  tuple. Public support can promote only complete positive-EV near-threshold evidence. Strong
  public resistance begins at 12pp and joins the existing immediate resistance demotion path.
- The bounded ladder additions are the exact frozen thresholds in the predeclaration: Moneyline
  55% / 2pp / 1% EV / -300..+300; Spread 10.5..24 at 54% / 3pp / 3% EV / -500..+500; Total
  52% / 2pp / 1.5% EV. All require no resistance.

## Current-slate read-only replay

Final audit timestamp: 2026-08-31T12:06:46.086Z. Evidence wave timestamp:
2026-08-31T08:54:48.673Z. The audit made zero writes and one bounded BALLDONTLIE prior-result read
to reproduce the weekly feature input.

- Window: Sep. 3-7; 87 FBS-involved games.
- 81 games had canonical anchors; six retained explicit game-scoped missing-anchor holds.
- 162 exact-price markets were comparable.
- Before: 1 Best Angle / 18 Leans / 97 Watchlists / 46 No Plays; 19 actionable.
- Candidate: 1 Best Angle / 23 Leans / 92 Watchlists / 46 No Plays; 24 actionable.
- Five promotions, zero demotions, zero side changes, zero exact-quote changes, 157 unchanged tuples.
- Promotions: Tulsa +14 at BetMGM -108; NIU-Iowa Over 46.5 at Caesars -106;
  Jacksonville State -20.5 at BetRivers -110; WKU-Nevada Under 52.5 at FanDuel -105; Notre Dame
  -20.5 at BetMGM -110. Each independently passed the frozen model-probability, target-excluded
  edge, exact-price EV, price/line, and resistance requirements.
- Public direction across comparable markets: three support, one resistance, 142 neutral, 16
  unknown. This explains why public consensus changes some projections but is not used to force
  an arbitrary actionable percentage.
- Actionable mix moves from 0 Moneyline / 9 Spread / 10 Total to 0 / 12 / 12. No Best Angle is
  created from the new public input or ladder.
- Public split evidence is eligible in the forecast for 76 games and crosses the bounded point-
  shift threshold in five. Those five projections change, with maximum absolute expected-team-
  score movement 0.6099 points and maximum exact-market probability movement 0.6413pp.

The zero-demotion current-slate result is an output, not an omitted safety path. Focused tests
prove a strong selected-side public resistance demotes Lean to Watchlist, two resistance sources
demote Best Angle two rungs, Circa remains stronger when public consensus opposes it, stale/future
public evidence is unavailable, mismatched Spread/Total lines are unavailable, negative EV cannot
become actionable, and spreads above 24 remain Watchlist or No Play.

## Release and operating impact

The exact new release tuple is recorded in `docs/current-model-releases.md`. The writer, cron,
sport-scoped lease, provider request plan, database tables, append-only write count, tracking
settlement, and stake behavior are unchanged. Existing r14/r23/r21 and prior T-60/settled rows
remain immutable and readable during the atomic transition.

Rollback is the complete r44/r8 model/publication tuple. Roll back on mixed releases, a public
source labeled verified sharp, provider/load growth, writer/reader or PMF/tuple incoherence,
locked-row mutation, tracking failure, or an unexplained board collapse.

## Verification record

- Focused market/sharp/public-consensus forecast and grade test: PASS.
- Focused CFB production contract: PASS.
- Full `test:cfb-v1-production`: PASS.
- `npm run verify:model-change`: PASS.
- `npm run verify`: PASS.
- TypeScript: PASS.
- Focused touched-file lint: 0 errors / 0 warnings.
- Next.js webpack production build: PASS.
- Fresh-main integration safety, protected PR, deployment, natural-cycle release proof, and live
  desktop/mobile QA: recorded at publication.
