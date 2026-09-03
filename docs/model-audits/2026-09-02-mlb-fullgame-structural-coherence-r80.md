# MLB full-game structural coherence r80 result

Date: 2026-09-02

Status: production candidate; not yet published. The protocol was frozen in
`2026-09-02-mlb-fullgame-structural-coherence-r80-predeclaration.md` before
this current-slate replay or any additional outcome inspection.

## What this release changes

This is a narrow structural correction, not a fitted market-reading formula.

1. When a full-game Moneyline or Total has only one accepted complete named-
   book pair, that evaluated pair retains its exact offered price and no-vig
   probability for EV and grade economics but has zero authority to validate
   its own forecast. A singleton Moneyline pair cannot own the team scoring
   share, and a singleton Total pair cannot own the scoring environment. Each
   dimension falls back to the independent baseball projection while a
   separately corroborated market dimension can remain available; when both
   are singletons, the posterior receives the exact independent projection
   before the unchanged baseball-only team residual correction. Moneyline and
   Total probabilities are not shrunk toward either singleton evaluated quote.
2. Because a singleton has no target-excluded corroboration, it cannot by
   itself self-authorize a Best Angle. It may still produce a Lean from the
   independently derived forecast and exact offered-price economics, subject
   to the existing two-distinct-cycle / 20-minute Moneyline promotion-stability
   contract and every existing market-resistance stand-down.
3. A downstream Moneyline or Total correction may stand down or grade the
   authoritative forecast, but it may not publish the opposite side while
   retaining the original decimal score and PMF. A favorite No Play remains a
   favorite forecast, not an underdog pick.

No universal market percentage, underdog quota, outcome-fitted reversal,
provider call, query, writer, cron, lease, reader, lock, tracking, or stake path
is added. Broader flips remain unavailable until persistent target-excluded,
source-diverse forward evidence qualifies one upstream posterior.

## Same-input current-board replay

The read-only operator
`scripts/operator/audit-mlb-fullgame-structural-coherence-r80.ts` ran at
2026-09-02T22:45:48.544Z with `--only-unstarted`. It issued zero writes and
zero provider calls. Incumbent and candidate runs used the same in-memory
feature snapshot, baseball prior, prices, timestamps, and model code; only the
new singleton eligibility branch differed.

- Fifteen games existed on the slate and six had not started. One of those six,
  MIA-KC, had an evaluation-only singleton Total; none had a singleton
  Moneyline.
- MIA-KC retained its away winner and Over side. Its decimal projected total
  changed from 8.7413031698 to the independent 8.7366202612 and Over
  probability from .5295892297 to .5091739427; its exact Bally Bet -136 quote
  remained the evaluation price and its Total remained No Play. Moneyline
  remained Lean at +102.
- The complete 30-record dry publication stayed 0 Best Angle / 6 Lean / 12
  Watchlist / 12 No Play. There were zero promotions, zero demotions, zero
  public-side changes, and no hidden flattening on the eligible unstarted
  cohort.

An all-slate diagnostic at 2026-09-02T22:31:05.322Z found three Moneyline and
three Total singletons, all in games that had already started and whose public
records were locked. The pure model branch changed three decimal score pairs
and zero sides. It would have changed SD-CIN Total and ATL-WSH Moneyline from
Watchlist to Lean upstream; the downstream dry build also exposed the existing
SD-CIN Moneyline promotion state. Those rows included post-start price shapes
as extreme as +3300 and -1385 and are not valid publication evidence. r80 does
not rewrite them, and this report does not use their outcomes or grades to tune
the rule. They establish only that the structural branch is reachable.

The existing MLB Moneyline stability contract retains a new public promotion
until two distinct natural writer cycles separated by at least 20 minutes
confirm coherent exact-price economics. Adverse movement, conflicting verified
splits, and other existing stand-down rules remain immediate.

ATL-WSH therefore illustrates the intended three-state contract. The
independent score continues to forecast ATL; exact-price and market-resistance
logic may make it Watchlist or No Play; nothing in r80 relabels WSH as the
winner. A future WSH flip would require qualified target-excluded evidence to
change the upstream posterior, decimal score, and winner together.

## Release-pure prediction quality

Prediction accuracy remains separate from price/grade economics. The frozen
locked chronology contains only 14 settled rows with the active r76 full-game
projection/head, all from the September 1 slate, split across r76/r77/r78.
There are no settled r80 rows and no settled Phase-A capture cohort, so no r80
accuracy or ROI claim is made.

| Exact release | n | Model winner | Market favorite | Model Brier / log | Market Brier / log | Model chose favorite | Actual favorite wins | Upset recall / precision |
| --- | ---: | ---: | ---: | --- | --- | ---: | ---: | --- |
| r76 | 6 | 33.3% | 50.0% | .310060 / .824430 | .231310 / .654861 | 50.0% | 50.0% | 33.3% / 33.3% |
| r77 | 6 | 33.3% | 50.0% | .291885 / .778481 | .246873 / .685623 | 83.3% | 50.0% | 0.0% / 0.0% |
| r78 | 2 | 0.0% | 50.0% | .280565 / .754445 | .301521 / .799859 | 50.0% | 50.0% | 0.0% / 0.0% |

Five model-versus-market disagreements went 1-4 for the score-derived model
and 4-1 for the market favorite. Four publication sides opposed the decimal-
score winner and happened to go 3-1 while the score winner went 1-3. These
tiny, already-opened samples are warnings, not coefficients or permission to
retain incoherent publication. They demonstrate why the forward capture must
measure persistent target-excluded evidence before any broader reversal rule.

A separate incident audit at 2026-09-02T22:12:43.755Z found six settled r79
ML/Total records from three games: Moneyline was 1-2, Total was 3-0, and the
two exact-price Leans were 0-2. All three Moneyline forecasts agreed with the
pregame market favorite, so that snapshot contained no model-versus-market
disagreement from which a justified underdog reversal could be inferred. The
six later records carrying the Phase-A capture contract retained the exact
r79 full-game release tuple and had zero material public-tuple mismatches;
`production_gate_enabled` was false. This incident evidence caused no r80
coefficient or side-rule change. It supports keeping prediction quality,
market-favorite performance, and exact-price grade economics separate.

## Grade economics and reachability

The current replay is unsettled and does not support ROI. Exact offered prices
remain downstream inputs to break-even probability and EV. Existing focused
fixtures retain both promotion and demotion reachability on the authoritative
side; the new singleton rule adds only a Best Angle corroboration block and
does not remove the existing Lean path. The eligible unstarted board retained
all six actionables with no promotion or demotion. The separate all-slate
reachability diagnostic increased actionables by two, but those already-started
rows are not treated as publication evidence.

## Acceptance and monitoring

Before publication, the exact candidate must pass the focused V2.2,
prediction-record, pipeline-safety, lock-coherence, TypeScript, changed-file
lint, `verify:model-change`, production build, diff, and fresh-main integration
gates. Live acceptance requires one natural leased writer cycle proving:

- all unlocked full-game rows stamp r80/v68/v31 and the r80 layer IDs;
- singleton audit fields and exact evaluation prices are present;
- public Moneyline and Total sides match the authoritative decimal score/PMF;
- pending promotions preserve the prior public tuple;
- locked rows remain byte-identical;
- provider/query/write topology and writer/lease ownership are unchanged; and
- current odds, lines, splits, scores, board counts, and member snapshot are
  healthy.

Forward monitoring must continue to report release-pure favorite buckets,
model-versus-market disagreements, Brier/log loss, upset recall/precision,
grade promotions/demotions, and exact-price results. It must not pool r80 with
prior releases or tune a reversal rule from a single day.
