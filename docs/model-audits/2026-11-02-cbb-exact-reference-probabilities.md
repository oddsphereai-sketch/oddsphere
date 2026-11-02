# CBB exact-reference correctness repair

Starting main: `84e2f5a9b7e33f64693c9953146123b979f003f2`.
Owner requested independent market-reading review, numerical and grade correctness,
and efficient board/reader operation. The reviewer found two reproducible errors.

## Predeclared scope

Correct only professional-reference direction, using the existing exact discrete
distribution at the actual target line. Spread removes impossible tied finals;
its 50% center is not the raw threshold. For a different reference line, invert
its exact no-vig probability, then evaluate the target with the same uncertainty,
conditioning on non-push outcomes. An identical line uses its no-vig probability
directly, avoiding unnecessary numerical inversion. Moneyline uses its own fair
probability. Selected-side P above/below .5 by more than 1e-7 means support/opposition.
Neutral references add neither; all-neutral is explicit neutral. No change to
EV thresholds, quote validity, price bounds, target/source hierarchy, source age,
scores, model inputs, uncertainty, stake, writer, lease, schedule or provider budget.

The displayed opposing spread +10.5/-10.5 is a valid same-book pair. Correct the
derived display comparison, retaining the exact stored source fields. Different
books or magnitudes remain unmatched; totals require equal lines. No stored
locked field is changed or reconstructed.

## Independent captured-source evidence

Original source cutoff: 2026-11-02T13:51:07.663Z. 116 current member IDs, 115 still
before T-60, 345 markets; Queens is excluded from re-evaluation. Frozen primary
Owls quotes, verified BDL fixture identities, official ESPN venues and unchanged
r2 forecasts/uncertainty are used on both sides. Seven markets in this capture
have no usable quote. No old observation is made fresh and no provider is called
by replay. Source hashes and three full reproducible paired cases are committed
in `scripts/fixtures/cbb-exact-reference-probabilities-20261102.json`.

| Grade | Incumbent | Corrected |
| --- | ---: | ---: |
| Best Angle | 49 | 49 |
| Lean | 84 | 84 |
| Watchlist | 100 | 98 |
| No Play | 105 | 107 |
| Held | 7 | 7 |

Eight actionable promotions pair with eight demotions; total actionables remain
133. There are18 grade changes and34 reference-state changes. These are captured
source shadow counts, not the latest live impact. Arkansas State -3.5 (-112)
promotes Watchlist->Best: Pinnacle implies50.2226% selected fair cover probability,
while the old raw-center comparison falsely opposes it. Old Dominion +1.5 (-112)
demotes Best->Watchlist: its sole Circa reference is exactly50%, falsely corroborated
by the old rule. UCLA +4.5 (-106) demotes Lean->Watchlist: Pinnacle49.3320% opposes,
while Circa is neutral. Tests must exercise all three, with inputs unchanged.

## Locked release ownership and efficiency

New boards stamp grade r2. Tracking derives the frozen board's grade release;
known unstamped legacy board releases map to their actual r1 policy. Existing
tracking rows must remain byte-semantically identical and idempotent after
deployment. Unknown unstamped releases fail closed. The existing single writer
returns locked DTOs before adaptation or new grading.

Unopened CBB cards defer chart/split arrays through the already-required exact
game detail fetch. Published scores, probabilities, picks, prices and grades stay
on the card; an opened/deep-linked reader retains its full stored payload. This
reduces repeated browser transfer without adding a provider request or writer.

Full model-change verification, focused model/grade/store/tracking/reader tests,
TypeScript, lint, production build, fresh-main integration safety, protected PR
checks, and production release/cron/reader/lock proof remain required. Roll back
the entire r2grade/r5board/r8publisher/r3tracking family together, preserving all
already locked public records and their original release stamps.

## Projection authority remains a separate research gap

The current r2 score forecast uses efficiency, matchup, rest/form and verified
venue. Prices set evaluated lines and grades; splits/movement/Kalshi do not
modify scores. This repair cannot be described as a qualified market-adjusted
score model. Three spot-checked games reproduce all nine probabilities exactly
from their stored score distributions, including large real forecast/market
disagreements. A future projection change requires separate chronological
qualification and release, not a guessed market weight.
