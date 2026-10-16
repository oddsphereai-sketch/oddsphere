# MLB foundational scoreboard and innings-weighted Total shadow

Date: 2026-10-16
Status: **shadow/audit only; not an active MLB release**
Historical window: 2026-06-07 through 2026-10-15
Locked unique games: 1,488
Exact counterfactual cohort: 1,192 games with preserved feature capture and an exactly reconstructable uncapped posterior

## Decision

Do not change the active MLB release from this audit alone.

The audit found and implemented a disabled-by-default structural candidate that fixes one real
independent-score defect: the incumbent applies both the opposing starter factor and bullpen factor
as full-game multipliers even though they divide the same nine innings. The candidate blends those
factors by expected innings, changes only the projected Total, and preserves the incumbent
independent home-away margin exactly. This prevents a Total repair from silently changing the
Moneyline winner.

The structural candidate improves score and Total results in chronological confirmation. The audit
now also replays the exact current production writer over frozen lock evidence, measures alternate-
line miss distance, and tests a train-selected action policy. It found a real Total-side candidate
and a replacement action policy that remains positive in each chronological block. It also disproved
the earlier run-line conclusion: a naive always-underdog +1.5 baseline is more accurate than the
distribution selector at the main line, so no run-line model improvement is claimed.

The scoped Total candidate is not active. The final audit resolves the earlier action-accuracy
tradeoff with a two-layer grade contract: final-board price/value qualification is required first,
then the independent Poisson/regime grade separates Best Angle, Lean, and Watchlist. The resulting
177-play actionable board is 103-74 (58.19%, +21.84u), including 46 Best Angles at 29-17 (63.04%,
+9.74u). It is positive in development, opened validation, and chronological confirmation and
retains 76% of the 233-play repaired board rather than flattening it. The candidate's structural
scope was still discovered during an already-opened 2026 analysis, so activation remains an
owner-approved future-unlocked release rather than a retroactive claim.

## Evidence contract

- Source rows are immutable `prediction_records` locks plus their settled scores.
- No stored lock was changed, relabeled, or reconstructed over a stored value.
- The counterfactual reconstructs only rows with preserved feature factors, starter workload,
  independent scores, posterior scores, trust, residual correction, and no active posterior cap.
- Chronology uses one fixed full-window partition:
  - train: 893 games, June 7 through August 16;
  - validation: 298 games, August 16 through September 7;
  - holdout: 297 games, September 7 through October 15.
- The paired counterfactual cohort contains 626 / 282 / 284 games in those partitions. These are
  development, opened validation, and chronological-confirmation blocks, not untouched holdouts.
- Historical output spans many decision releases. It is historical architecture evidence, not a
  claim about the eight settled rows currently stamped r91.
- Competitor figures come from owner-provided screenshots. Dates, prices, pushes, game inclusion,
  and alternate-line construction are not normalized, so percentage comparisons are directional,
  not head-to-head certification.

## Baseline scoreboard

Unique-game historical output across mixed release eras:

| Market | Oddsphere | Screenshot benchmark | Interpretation |
|---|---:|---:|---|
| Moneyline | 864-624, 58.06%, +25.01u | 1366-1081, 55.82% | Oddsphere is higher on an unequal cohort. |
| Total | 746-725-17, 50.71%, -38.70u | 1192-1183, 50.19% | Accuracy is similar; pricing/economics are poor. |
| Total favorable +1 | 868-609-11, 58.77% | 1406-955, 59.55% | Screenshot is higher by 0.78pp. |
| Total favorable +2 | 1005-469-14, 68.18% | 1635-747, 68.64% | Screenshot is higher by 0.46pp. |
| Derived run line | 703-783, 47.31% | 1330-1117, 54.35% | Material unresolved weakness. |
| Derived run line favorable +1 | 938-548, 63.12% | 1626-821, 66.45% | Material unresolved weakness. |
| Derived run line favorable +2 | 960-526, 64.60% | 1762-685, 72.01% | Material unresolved weakness. |

Run-line results in the baseline table are accuracy-only mathematical derivations. A later
price-aware audit recovered 825 same-book ±1.5 pairs from retained pregame `lines` rows, but those
rows are mutable last-retained observations rather than immutable T-60 snapshots. They can falsify
a proposed selector, but they cannot establish official historical run-line tracking or CLV.

## Architecture diagnosis

The independent score equation uses:

`league runs × offense × opposing starter × opposing bullpen × park × weather × handedness`

The starter and bullpen terms are both applied at full strength. That double-counts two components
that share nine innings. It also explains the loss-audit bias pattern:

- good starters were under-projected by 0.735 total runs;
- bad starters were over-projected by 1.296 total runs;
- strong bullpens were under-projected by 0.888 total runs;
- weak bullpens were over-projected by 0.409 total runs.

The candidate uses an arithmetic innings blend for every starter/bullpen pair, then recomposes team
scores from the new Total and the exact incumbent margin. Moneyline margin, winner direction, and
margin MAE are therefore unchanged by construction.

## Paired structural result

### Score accuracy

| Partition | Stored Total MAE | Candidate Total MAE | Stored bias | Candidate bias | Margin MAE change |
|---|---:|---:|---:|---:|---:|
| All 1,192 | 3.451 | **3.413** | -0.143 | **-0.014** | 3.414 → 3.414 |
| Train 626 | 3.438 | **3.432** | -0.073 | +0.105 | 3.547 → 3.547 |
| Validation 282 | 3.658 | **3.601** | -0.167 | **-0.080** | 3.263 → 3.263 |
| Holdout 284 | 3.276 | **3.185** | -0.273 | **-0.211** | 3.269 → 3.269 |

### Total direction from the repaired posterior mean

| Partition | Record | Accuracy | Units | ROI |
|---|---:|---:|---:|---:|
| All | 626-558-8 | **52.87%** | +20.08u | +1.70% |
| Train | 330-288-8 | 53.40% | +13.80u | +2.24% |
| Validation | 149-133 | 52.84% | +3.63u | +1.31% |
| Holdout | 147-137 | 51.76% | +2.65u | +0.93% |

Paired favorable-line accuracy is 60.98% at +1 and 70.79% at +2. On the unequal screenshot
comparison, that is +2.68pp for the main Total, +1.43pp at +1, and +2.15pp at +2.

### Moneyline preservation

The candidate's independent and posterior margins equal the stored margins. On the paired cohort,
the stored posterior winner is 692-500 (58.05%) and remains 692-500. The shipped final Moneyline is
691-501 (57.97%). The candidate does not discard the market reader or create a new Moneyline head.

### Standalone run-line selector — rejected as a model improvement

Reusing the Moneyline side for the run line is the architectural error behind the 47% baseline.
The shadow now evaluates each actual market favorite/underdog ±1.5 pair with the joint Poisson run
distribution and chooses the higher cover-probability side independently of the Moneyline pick.

| Window | Standard run line | Favorable +1 | Favorable +2 |
|---|---:|---:|---:|
| All 1,192 | **692-500, 58.05%** | **844-348, 70.81%** | **913-279, 76.59%** |
| Train 626 | 58.31% | 69.97% | 75.88% |
| Validation 282 | 58.87% | 73.05% | 79.43% |
| Holdout 284 | 56.69% | 70.42% | 75.35% |
| Screenshot benchmark | 54.35% | 66.45% | 72.01% |

The apparent benchmark win is composition-driven. On the exact same 1,192-game cohort, blindly
taking every market underdog +1.5 produces **699-493 (58.64%)**, beating the selector's 692-500
(58.05%). At +1 the selector is 70.81% versus 70.47% for the naive baseline; at +2 it is 76.59%
versus 77.43%. The selector chooses the favorite -1.5 in 217 games and goes only 105-112 (48.39%)
there, while its 975 underdog selections go 587-388 (60.21%).

Therefore this is not evidence of predictive run-line lift and is not a production candidate.
Historical locks also did not store run-line prices, so the price-aware market reader, units, CLV,
and actionable tiers cannot be validated retrospectively. Forward run-line line/price capture and a
price-normalized favorite/underdog comparison remain prerequisites.

## Probability, market reader, and final-board findings

The current Total pipeline is not one decision layer. It contains the score posterior, Poisson
probability, target-excluded price regularization, the trailing run-environment prior, score/side
reconciliation, and later writer market arbitration.

The repaired mean-direction candidate stays positive in train, validation, and holdout. The current
probability/regularization path does not: on the paired holdout it is 137-147 and -7.81% ROI. Market
price direction itself is 147-149 and -8.30% ROI on the full holdout. This is evidence that market
context is useful but cannot automatically own direction in every era.

Whole-number totals expose an additional probability defect: `P(over)` excludes pushes, but the
existing complement `1 - P(over)` assigns push mass to Under. Removing push mass before normalizing
the two decision probabilities improves the paired candidate only slightly (623-561-8 to
624-560-8) and weakens the candidate Best Angle cohort overall. It remains a documented shadow
finding, not a production change.

Current historical layer attribution also shows:

- stored posterior mean direction: 51.60%, approximately flat at available prices;
- stored raw probability direction: 50.42%, -3.30% ROI;
- stored holistic direction: 51.06%, -0.79% ROI;
- shipped final direction: 50.71%, -2.64% ROI;
- replacing shipped historical sides with the stored mean direction corrects 12 net losses over
  the full window and improves holdout from 46.80% to 51.18%.

This does not authorize deleting the market reader. It identifies where the current score,
probability, and reader layers need distinct responsibilities instead of blending the offered price
into the independent probability and then reading that market a second time.

## Moneyline predictive-value audit

Moneyline profit does not prove predictive lift. Across 1,486 games with a frozen market anchor,
blindly selecting the market favorite is 868-618 (58.41%) but loses 9.02 units at the recorded
prices. The shipped final side is 864-624 across 1,488 games and +25.01 units. On the exact paired
rows, the shipped model's 281 departures from the favorite correct 138 favorite losses and create
143 new losses: **five net accuracy harms**. The price/value result is real, but it is not evidence
that the model calls more winners than the favorite baseline.

The audit therefore fits four fixed ridge-logistic architectures on the first 60% only and evaluates
the later 40% without refitting: market probability alone; independent margin alone; market plus
independent margin; and market/independent plus captured starter, offense, opposing-pitcher, and
bullpen matchup factors. It also tests a fixed-grid, train-selected policy that leaves the favorite
unchanged unless the fitted model makes a sufficiently confident upset call.

| Architecture | Validation | Validation favorite | Holdout | Holdout favorite | Verdict |
|---|---:|---:|---:|---:|---|
| Independent only | 58.72% | 61.07% | 54.88% | 60.61% | Rejected |
| Market + independent | **62.42%** | 61.07% | 58.92% | **60.61%** | Rejected; does not repeat |
| Market + independent + matchups | 61.17% | **61.51%** | 59.04% | **60.41%** | Rejected |

The selective-override policy does not rescue the result. Market plus independent makes 22 upset
overrides in validation, corrects 13 and harms nine (+4 net), then makes 15 in holdout, corrects five
and harms ten (-5 net). The richer matchup version is -1 net in validation and -4 in holdout. No
candidate beats the paired favorite baseline in both later windows, so **no Moneyline challenger is
approved**.

The failure is not simply poor input coverage. High-quality shipped overrides are 55.17% in
validation but 46.55% in holdout. Large independent disagreements (absolute margin at least one
run) are especially unstable: the shipped rule is +4 net corrections in validation and -11 in
holdout. The current independent inputs can occasionally find a valuable upset, but their upset
ranking is not temporally stable enough to own the winner. The next Moneyline iteration must add
prior-only expected-quality, bullpen-availability, lineup, platoon, defense, rest, and travel
features and prove incremental correction lift with rolling-origin validation. It must not be a
favorite/underdog heuristic or a threshold fitted on all settled games.

## Exact current-writer replay

The audit reconstructs the current r91 writer inputs from immutable lock snapshots and replays both
the incumbent and candidate with identical frozen lines, openers, splits, prices, and game metadata.
It covers 1,180 of 1,192 candidate games; 12 are explicitly omitted because `lines_at_lock` is empty.
No database writes occur.

### Candidate A: repaired score plus incumbent Poisson/regime head

| Output | Incumbent current-writer replay | Candidate A |
|---|---:|---:|
| Final Total record | 600-573-7, 51.15%, -23.80u | **616-557-7, 52.51%, -5.16u** |
| Actionable Totals | 130-112, 53.72%, +3.30u | 88-80, 52.38%, -0.50u |
| Best Angles | 26-16, 61.90%, +6.56u | 4-1, 80.00%, +2.47u |
| Actionable board size | 242 | 168 |
| Best Angle count | 42 | 5 |

Candidate A corrects 16 net final Total decisions, but its holdout final record remains 138-146 and
the action board gets both smaller and worse. This fails the promotion gate even though aggregate
side accuracy improves.

### Candidate B: train-only independent score-gap probability

The second replay removes market-price regularization and trailing regime weighting from the
independent probability head. Direction comes from the repaired score relative to the line. A
zero-intercept logistic slope (0.084810) is fitted on 618 decided training games only; validation
and holdout are untouched. The market remains fully available to the downstream writer as a reader,
price, movement, and split signal.

| Partition | Incumbent final record | Candidate B final record |
|---|---:|---:|
| All replayed | 600-573-7, 51.15%, -23.80u | **616-557-7, 52.51%, +18.90u** |
| Train | 326-293-7, 52.67%, +9.57u | **330-289-7, 53.31%, +19.38u** |
| Validation | 136-134, 50.37%, -14.04u | **141-129, 52.22%, +1.92u** |
| Chronological confirmation | 138-146, 48.59%, -19.34u | **145-139, 51.06%, -2.40u** |

This candidate improves final-side accuracy in all three chronological blocks, keeps every Moneyline
side unchanged, and converts the full replay from -2.47% to +1.96% ROI. Its inherited action
calibration is not transferable:

- actionable Totals fall from 242 to 162 and Best Angles from 42 to zero;
- the preserved-probability writer creates 162 Leans that are only 76-84-2 and -12.21u;
- the inherited `mlb_total_confidence_value_context` rule is 45-62-1 and -18.75u after the
  probability-head change, demonstrating that its old fitted context cannot transfer;
- Moneyline side is invariant, but 37 Moneyline grades/actions move because `computeConfidence`
  currently couples Moneyline confidence to the Total probability.

That last point is a cross-market architecture defect: changing the Total probability must not
silently retier a Moneyline whose side, win probability, and projected margin are unchanged.

### Unit accounting and claim boundary

The +45.30u difference between the incumbent (-23.80u) and the legacy-second-calibration replay
(+21.49u) is a diagnostic
flat-stake replay of **every priced final Total prediction**, not the return of the recommended
action board. Of 1,180 replayed games, 964 decided rows have a frozen price and 216 rows are either
unpriced or pushes. Candidate B flips 317 sides:

| Side relationship | Rows | Both sides priced | Incumbent units | Candidate units | Delta |
|---|---:|---:|---:|---:|---:|
| Unchanged side | 863 | 718 | +6.57u | +6.57u | 0.00u |
| Corrected loss to win | 166 | 132 | -132.00u | +128.92u | +260.92u |
| Harmed win to loss | 150 | 114 | +101.63u | -114.00u | -215.63u |
| Other flip/push | 1 | 0 | 0.00u | 0.00u | 0.00u |
| **All** | **1,180** | **964** | **-23.80u** | **+21.49u** | **+45.30u** |

This reconciles exactly: 166 corrections minus 150 harms create 16 net wins, while unequal plus-
money payouts on the priced flips produce the additional unit difference. It does not justify a
production profit claim. Candidate B's inherited actionable board is 76-84-2 and -12.21u; its Best
Angle count is zero. Competitor screenshots do not include prices or units, and the historical
run-line locks do not contain run-line prices, so
neither competitor-unit comparisons nor run-line unit claims are available. The cleaner replay that
preserves the train-only score-gap probability without applying the legacy fitted transform a second
time is +18.90u, as reported above.

### Candidate C: scoped score repair plus train-selected action policy

Loss-context analysis found that applying the innings-weighted repair only to high-quality rows,
while preserving the incumbent score when average starter ERA is at least 4.75 or average bullpen
factor is at least 1.05, improves direction without discarding the rest of the model. On all 1,192
reconstructable games the repaired posterior mean is 632-552-8 (53.38%, +31.98u), positive in all
three chronological blocks. Total MAE improves from 3.451 to 3.436; the broader unscoped repair is
still better on MAE at 3.413.

Through the exact current writer on 1,180 priced-evidence games:

| Partition | Incumbent | Scoped Candidate C |
|---|---:|---:|
| All | 600-573-7, 51.15%, -23.80u | **622-551-7, 53.03%, +25.15u** |
| Development | 326-293-7, 52.67%, +9.57u | **334-285-7, 53.96%, +23.75u** |
| Opened validation | 136-134, 50.37%, -14.04u | **142-128, 52.59%, +2.25u** |
| Chronological confirmation | 138-146, 48.59%, -19.34u | **146-138, 51.41%, -0.85u** |

It changes 301 Total sides, corrects 161 losses, harms 139 wins, and nets 22 corrections. Moneyline
side never changes. The exact favorable-line results are 60.99% at +1 and 70.52% at +2, versus the
screenshot's unequal 59.55% and 68.64% benchmarks.

The inherited action rules fail on the new score: 111-113-3 and -6.93u. A fixed 192-policy grid was
therefore selected using the development block only. The selected rule requires model probability
at least 51%, an absolute projection gap of at least 0.5 runs, nonnegative offered edge, and a price
of -150 or better. It demotes the incompatible legacy Leans and promotes qualifying candidate-side
Market Aligned rows:

| Partition | Candidate action record | Units | ROI |
|---|---:|---:|---:|
| All | **124-109 (233)** | **+8.44u** | **+3.62%** |
| Development | 52-44 (96) | +4.09u | +4.26% |
| Opened validation | 31-27 (58) | +3.18u | +5.48% |
| Chronological confirmation | 41-38 (79) | +1.17u | +1.48% |

The incumbent action board is 130-112 (53.72%, +3.30u) over 242 rows. Candidate C is almost the
same size and improves units, but its 53.22% accuracy is 0.50pp lower. Of its 233 actions, 46 are
retained incumbent slots (28-18, +8.48u) and 187 are promotions (96-91, approximately flat). It
demotes 196 incumbent actions that were 104-92 and approximately flat. This satisfies the required
promotion/demotion accounting, but it does not yet justify claiming that action accuracy improved.

## Best Angle and board impact

The structural candidate's pure-model Total grades, before writer-time confirmation and quality
gates, are:

| Grade | Record | Accuracy | Units | ROI |
|---|---:|---:|---:|---:|
| Best Angle | 45-30 | **60.00%** | +9.05u | **+12.07%** |
| Lean | 56-62-2 | 47.46% | -4.60u | -3.90% |
| Market Aligned | 414-376-5 | 52.41% | -4.51u | -0.57% |

Candidate Best Angles are 21-17 in train, 13-8 in validation, and 11-5 in holdout. The 75-game
candidate base board is smaller and stronger than the 193-game incumbent base-eligible cohort
(104-87-2, 54.45%, +1.83% ROI). Relative to incumbent base eligibility, the candidate adds 31
rows at 18-13 (+9.12% ROI) and removes 149 rows at 77-70-2 (-1.85% ROI); the removed cohort is
19-19 in validation and 11-17 in holdout.

Those base grades looked encouraging in isolation, but the exact writer replay above supersedes
them for production decisions. Candidate C's explicit 233-row action replay is the relevant board;
the pure-model grades are retained only to show why grading cannot be evaluated before writer-time
market arbitration.

## Independent-score calibration and full-product ablation

The next audit did not replace the product architecture. It fit candidate corrections inside the
independent score layer, reconstructed the incumbent posterior, recomputed the existing Poisson
probability heads, and then replayed the same frozen market reader, exact-price arbitration, final
writer, and grade logic. The fixed affine calibration was fit on the first 60% only; validation and
holdout were not used to fit it.

The full Total-and-margin calibration improves independent Total MAE from 3.651 to 3.516 and
posterior Total MAE from 3.474 to 3.424 on its paired cohort. Through the complete writer it moves
Moneyline from 770-571 (57.42%) to 782-559 (58.31%) and Total from 678-652-11 (50.98%) to
679-651-11 (51.05%). Those aggregate gains are not promotable:

- Moneyline holdout falls from 166-118 to 165-119 and unit return falls from +5.45u to +0.23u.
- Total development falls from 404-372-11 to 390-386-11 even though validation and holdout improve.
- Moneyline Best Angles fall from 148 to 43 and Total Best Angles from 46 to 4 under the inherited
  confidence scale.

The controlled ablations identify the source. Calibrating Total while preserving the independent
margin leaves all 1,341 final Moneyline sides and their flat-stake record unchanged, while producing
the same later Total improvement. Calibrating margin while preserving Total creates all 150
Moneyline side changes and the holdout regression. Therefore the defensible repair target is the
independent Total head, not a wholesale replacement of the independent model or market reader.

A prior-only rolling affine version was also rejected. It tied incumbent Moneyline accuracy over
its paired cohort, but dropped holdout from 166-118 to 162-122 and reduced Moneyline units from
+5.45u to -5.26u. Continuous recalibration does not remove the failure.

### Run-line truth test

Every affine candidate's derived run-line side matched the same-cohort **always take the market
underdog +1.5** baseline exactly. For the full affine posterior cohort that is 827-582 (58.69%),
997-412 (+1 run), and 1,092-317 (+2 runs). Those percentages beat the screenshot benchmarks but
contain zero demonstrated selection lift. They are a property of the alternate line, not proof of
model skill, and must not be promoted or advertised as such.

The price-aware retained-row audit confirms the rejection. It requires a real-book same-book
home/away ±1.5 pair observed from 48 hours through one hour before first pitch. Across 825 paired
games, always taking the underdog is 477-348 (57.82%) but **-51.94u**; the stored and repaired
Poisson selectors are both 470-355 (56.97%) and -45.03u. A train-only favorite-cover classifier
selects the favorite only 24 times, remains 477-348 overall, and falls to -53.86u. Its late
101-game block is positive, but validation is worse than the underdog baseline, so it is not stable
enough to ship. The correct conclusion is not “take every underdog”; it is that MLB run-line
selection remains unconfirmed and should stay out of the public prediction board.

### Final-grade and market-reader diagnostics

Three probability/edge-only Best Angle thresholds were tested inside Candidate C's 233-row
qualified board. None remained positive in holdout: balanced was 15-18, strict 9-11, and
conservative 6-7. High model probability alone is therefore not a valid MLB Total Best Angle
ranker.

The successful calibration uses the independent statistical grade as a second gate rather than
inventing a still-higher confidence cutoff. Candidate C first has to pass the train-selected final
board contract: writer-qualified Market Aligned side, model probability at least 51%, absolute
projection gap at least 0.5 runs, nonnegative offered edge, and price no worse than -150. Then:

- an independent statistical `Best Angle` remains **Best Angle**;
- an independent statistical `Market Aligned` row becomes **Lean**;
- a legacy statistical Lean/No Bet becomes **Watchlist**.

This produces a meaningful hierarchy:

| Final grade | Record | Accuracy | Units | Development | Validation | Confirmation |
|---|---:|---:|---:|---:|---:|---:|
| Best Angle | **29-17 (46)** | **63.04%** | **+9.74u** | 11-6 | 9-7 | 9-4 |
| Lean | **74-57 (131)** | **56.49%** | **+12.11u** | 37-28 | 18-17 | 19-12 |
| Watchlist | 21-35 (56) | 37.50% | -13.41u | 4-10 | 4-3 | 13-22 |
| Actionable total | **103-74 (177)** | **58.19%** | **+21.84u** | 48-34 | 27-24 | 28-16 |

The board is smaller but not flattened: 177 of 233 repaired opportunities stay actionable and 46
remain Best Angles. Relative to the incumbent 242-action board, the final contract retains 38
actions (24-14, +8.21u), promotes 139 (79-60, +13.64u), and demotes 204. The demoted incumbent
cohort is positive in development but loses in both later blocks (25-26 validation, 24-26
confirmation). That later-period separation is the key safety result: the policy both promotes a
winning cohort and removes a cohort that stopped transferring.

The existing market reader is informative, but the relationship is not a simple "follow the move"
rule. Within the Candidate C action board:

| Lock-time line context | All | Validation | Holdout |
|---|---:|---:|---:|
| Unknown/no comparable move | 85-70, +10.03u | 24-20, +3.88u | 9-6, +2.06u |
| Neutral | 8-5, +2.85u | 2-2, -0.01u | 6-3, +2.86u |
| Against candidate | 22-25, -2.87u | 3-3, -0.19u | 19-22, -2.68u |
| Toward candidate | 9-9, -1.57u | 2-2, -0.50u | 7-7, -1.07u |

Movement context was unavailable in the development block, so this table is a late-period
diagnostic, not an untouched rule-selection result. A veto on directional movement is plausible but
must be frozen in shadow and confirmed on new games before it can control grades. The finding does
show why the market reader must remain a separate arbitration layer: both blindly following and
blindly fading line movement fail.

The current conclusion is narrow: Candidate C is a real Total-direction improvement through the
complete product and the two-layer Total grade hierarchy is a viable production candidate.
Moneyline margin calibration and run-line selection remain rejected. Production stays unchanged
until the candidate is versioned, reviewed, explicitly approved, and deployed only for future
unlocked rows.

## Moneyline and run-line disposition

The existing Moneyline should be preserved. On the exact 1,341-game full-writer cohort it is
770-571 (57.42%, +8.52u); its 499 actionables are 310-189 (62.12%, +24.97u), and its 148 Best
Angles are 101-47 (68.24%, +14.92u). Actionables remain above 61% in each chronological block.
The Total-only candidate preserves every Moneyline side, so the Total repair does not discard the
existing Moneyline architecture or market reader.

Run line is not production-confirmed. The repository now contains a behavior-neutral r2 forward
capture candidate that freezes up to four coherent, same-book main ±1.5 pairs and their same-book
openers on the unlocked Moneyline snapshot. It rejects alternates, crossed books, incoherent side
numbers, stale/future rows, and side timestamps more than two minutes apart. The capture is
`production_gate_enabled=false`: it changes no forecast, side, probability, grade, price, stake,
lock, or public tracking row. Once deployed, future T-60 locks will finally support an honest
price-normalized run-line model audit.

## Feature coverage still missing from the independent model

The existing model uses team OPS, starter ERA/WHIP/K9 or pitch-quality proxy, bullpen ERA proxy,
starter workload, park, weather, and lineup availability. It does not yet provide a professional
complete MLB feature set:

- expected batting quality such as xwOBA/wRC+ rather than OPS alone;
- expected pitching estimators such as xERA/FIP/xFIP/SIERA;
- bullpen availability, leverage, and recent workload;
- implemented platoon/handedness aggregation (`handednessFactor` currently returns 1.0);
- defense and baserunning run value;
- travel, rest, series, and schedule interactions.

These gaps should enter through versioned, prior-only feature capture and chronological shadow
tests. They are not permission to add many correlated factors at once.

## Implemented shadow boundary

- `projectIndependent` accepts disabled option
  `useInningsWeightedTotalPreserveMargin`.
- The option blends starter/bullpen factors by expected innings for every starter.
- It recomposes team scores from candidate Total plus incumbent margin.
- V2.2 records enabled/applied, legacy Total, and candidate Total in audit output.
- The operator audit now includes the exact frozen-evidence r91 writer A/B, train-only score-gap
  calibration, scoped Candidate C, miss-distance ladders, naive run-line baselines, train-only
  action-policy search, cross-market grade-integrity count, paired promotion/demotion counts,
  train-only Moneyline architecture comparisons, selective upset overrides, chronological
  override-cohort stability, a price-aware run-line falsification test, and the final two-layer
  Best Angle/Lean/Watchlist calibration.
- Default behavior remains disabled.
- Focused MLB model tests: 182 passed, 0 failed.
- TypeScript: passed.
- Targeted ESLint: passed.
- No release identifier, writer, lease, schedule, lock, stored prediction, or live board changed.

## Promotion requirements

Before this candidate can affect a member forecast:

1. Freeze the documented 177-play two-layer grade contract in a versioned, future-unlocked runtime
   candidate. Do not substitute one of the rejected probability-only Best Angle thresholds.
2. Decouple Moneyline confidence/grade from Total probability and prove the Moneyline public tuple
   remains invariant when only the Total head changes.
3. Freeze the structural scope as a versioned model artifact or choose the more principled unscoped
   innings-weighted repair. The scoped thresholds were found in an opened 2026 analysis and must not
   be described as untouched validation.
4. Do not promote the run-line selector. Deploy the behavior-neutral r2 price capture first, then
   require a selector to beat the same-cohort always-underdog baseline after favorite/underdog and
   price normalization on release-separated immutable evidence.
5. Do not promote a Moneyline challenger until it beats the paired favorite baseline in both
   validation and chronological confirmation while retaining calibrated probabilities and selective
   upset corrections. The current four architectures and their train-selected override policies fail.
6. Bump every affected release identifier and update `docs/current-model-releases.md` in the same
   production commit.
7. Run `npm run verify:model-change`, focused MLB suites, the no-write current-board rehearsal,
   latest-main integration safety, protected PR checks, and post-deploy live proof.
8. Obtain explicit owner approval for the production promotion.

Rollback for the current shadow work is deletion of the disabled option and audit script; active
production remains the October 9 r91 family with October 16 input-eligibility v3.

## Reproduction

```bash
npx tsx --env-file=.env.local scripts/operator/audit-mlb-foundational-scoreboard.ts \
  --from=2026-06-07 --to=2026-10-15 \
  --out-dir=/tmp/oddsphere-mlb-foundational-results-20261016
```

Artifacts:

- `/tmp/oddsphere-mlb-foundational-results-20261016/mlb-foundational-scoreboard-2026-06-07-to-2026-10-15.json`
- `/tmp/oddsphere-mlb-foundational-results-20261016/mlb-foundational-scoreboard-2026-06-07-to-2026-10-15.md`

Evidence classification: exact 2026 production counterfactual over immutable lock evidence, with a
development-only fitted probability slope and action-policy grid plus opened chronological
confirmation. No future-forward evidence is claimed.
