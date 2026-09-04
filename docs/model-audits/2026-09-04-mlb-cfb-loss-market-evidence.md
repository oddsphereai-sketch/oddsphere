# September 3 MLB and CFB outcome / market-evidence review

Status: release-separated diagnostic. Outcomes did not choose any new threshold or automatic flip.

## Method

The repeatable audit reads immutable locked `prediction_records`, groups by sport, market, release,
grade, and wager status, and evaluates the persisted pregame movement, source-specific sharp, and
public-split directions. The evidence ballot is outcome-blind: every persisted directional channel
gets one vote, with unknown remaining unknown. The report includes wins as counterexamples so a rule
is not learned only from losses.

```bash
npm run audit:daily-edge-losses -- --sport=cfb --date=2026-09-03 --include-rows
npm run audit:daily-edge-losses -- --sport=mlb --date=2026-09-03 --include-rows
```

## CFB

September 3 contains 30 locked predictions: 19 wins, 10 losses, and one push. Moneyline was 9-1,
Spread 4-5-1, and Total 6-4. The grade results were Best Angle 1-1, Lean 1-2, Watchlist 7-7-1, and
No Play 10-0. The No Play wins are prediction-accuracy rows, not ten missed wagers; they expose why
forecast confidence must not be conflated with execution economics.

Only one loss had a clean opposing evidence ballot: Colorado–Georgia Tech Over 52.5, where public
evidence resisted and Under won. That does not authorize an automatic flip: UAB +25.5 won despite
public resistance, and UAB Over 54.5 won despite movement resistance. The actionable Merrimack Over
had no directional evidence; Lindenwood Under was neutral/unknown but carried missing weather and
injury warnings; Georgia Tech Moneyline had sharp support and still lost.

UMass +29.5 was a useful winning counterexample. The last complete tuple had 53.48% probability,
3.48 percentage-point edge, 2.54% EV, and Circa splits of 74% tickets / 91% money. It was absent at
T-60 because the optional SharpAPI odds fallback failed at the writer boundary. The correction is
evidence continuity and optional-network isolation—not a UMass, large-underdog, or spread-size rule.

## MLB

September 3 contains 27 locked predictions: 11 wins, 15 losses, and one void Toss-Up. Moneyline was
5-4, Total 3-6, and directional first inning 3-5.

The strongest negative ballots were San Francisco–Pittsburgh Over (movement and sharp resistance),
Toronto–Cleveland home Moneyline (sharp and public resistance), Miami–Kansas City Under (movement
support but sharp/public resistance), Boston–Baltimore Under (public resistance), and
St. Louis–Los Angeles Over (movement resistance). Counterexamples again prevent a blanket flip:
Boston–Baltimore away Moneyline and Tampa Bay–Texas home Moneyline both won despite multiple
resistance channels.

One real implementation defect was found: the published
`total_sharpapi_money_over_tickets_support_lean` validation was Under-only, but runtime also allowed
Over. Milwaukee–Chicago Over entered that invalid sleeve and lost. The candidate corrects runtime to
the already-validated Under scope without changing first inning.

First-inning snapshots lack comparable persisted movement/public/sharp direction. No claim about an
ignored FI sharp signal is supportable from this data, and FI behavior remains untouched.

## Decision

There is no safe universal “follow sharps” or “flip on resistance” rule. The supported changes are:
persist complete comparable evidence, keep unknown neutral, surface accumulated split movement,
isolate optional-provider failures, correct the MLB Under-only scope mismatch, and review future
wins and losses by exact release and locked timestamp.

