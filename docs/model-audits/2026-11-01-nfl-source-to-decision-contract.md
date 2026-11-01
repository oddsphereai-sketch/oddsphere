# NFL source-to-decision contract repair

Production base `98628e14` integrated into the task's clean isolated branch before
editing. This continues PR908 and supersedes the private r99 candidate. It is not
a live-release or accuracy claim. Owner requested full reader repair after spot
checks kept exposing composition defects; forward results remain the accuracy test.

Scope: NFL Moneyline, Spread and Total, final score distribution, execution and
comparison quotes, existing T-60 Total interpreter, reader evidence. Existing
single writer, `prediction_pipeline:nfl` lease, provider cadence, stakes, UI, lock
immutability and release-separated tracking remain authoritative.

## Shared defects and repairs

1. Anchor probabilities could combine different spread/Total lines at their median
   line, manufacturing a probability that no book actually offered. Both axes now
   select complete exact-line cohorts; family count and probabilities describe
   only that cohort. Target-book exclusions and source freshness precede selection.
2. T-60 Total features read raw split gaps after market state rejected stale input.
   Feature construction now checks original source time, exact evaluated contract,
   and excluded book before any numeric contribution. A fresh small gap remains
   eligible. The historical coefficient artifact is not rewritten.
3. Execution/LOO selection did not enforce its evaluation clock. Both target and
   comparator quotes now reject stale/future observations, use canonical distinct
   families and retain source timestamps. A tempting stale price cannot generate
   an actionable grade from a fresh forecast.
4. Small real price changes were retained as numbers but removed from directional
   interpretation below one percentage point. Actual paired no-vig changes now
   retain direction down to numerical equality tolerance; size remains continuous
   and does not command a flip.
5. A partial buyback could appear 100% persistent because it never crossed the
   opener. Trails now retain the latest economic direction, peak clock and
   separate number/price retracement. Ledger and interpretation preserve these;
   late opposition must be resolved against current paired prices before a side
   correction. A partial retracement is not an automatic veto.
6. Stored Spread/Total EV discarded push refunds even though grade selection used
   them. New tuples now carry explicit push probability, and stored EV and the
   shared r14 coherence validator use the same refund-aware formula. Missing
   legacy push fields retain the original convention; locked records are not
   rebuilt. Source calculations, saved tuples and validators are tested together.
7. A tiny early opposite tick could block one named episode while an identical
   corroborated multi-book episode remained eligible. Early reversals now remain
   evidence rather than automatically preventing current-price corroboration.
   Missing or contrary current-price evidence still retains the forecast.
8. Whole-game price construction required every market cohort before giving any
   axis authority. Each market now retains its own evidence. Direct Moneyline
   probability is inverted through the existing margin distribution at zero;
   Spread and Total use their own exact-contract cohorts. Missing axes are null
   authority, never relabeled independent predictions. A supported coordinate can
   adjust while retaining the independent other coordinate in the final single
   physically valid score tuple. Tests cover absent unrelated markets, direct
   Moneyline inversion, and market-specific ledger values.

## Verification method

Use real state-builder composition and adversarial cases for each defect, then
audit every market in a single current-input no-write capture. The independent
product audit recomputes probabilities and EV from the final distributions,
checks score/pick consistency, exact source book/event/line/price/source-clock
identity, executable freshness, and final evaluated-book exclusions. It does not
accept an `interpreted` label as proof of correctness. The audit is a local
artifact; no shadow model is persisted in production.

The strict operator mode also requires complete game/market membership. It fails
if any eligible game is held or missing, rather than reporting zero defects from
only the surviving subset. Mean/median boundary cases are explicitly reported
separately: a skewed distribution can validly have an Over mean and a slight
Under majority. The audit checks mean/PMF identity and majority-side probabilities;
it does not falsify a score or change a pick solely to make those two summaries
identical.

Publication still requires a clean current-main PR, required checks and protected
merge policy, release coherence, writer/lease health and affected live behavior.
Roll back only future unlocked output to the complete existing production family;
stored locked records remain exact. Results and current board impact follow below.

## Final executed proof — r101

The final private family is writer r101, model r45, calibration r44, decision/grade
r53, member r50, fixture r65, snapshot r57; ledger r10, arbiter r26, runtime r11,
target-excluded outcome r25, state r6, unified Total r2 and shared validator r14.
All prior r100 results are local diagnostic artifacts, not production history.

At `2026-11-01T12:33:51.769Z`, strict no-write execution evaluated all 13 eligible
unlocked games / 39 markets. Previously locked games were not rebuilt. The
independent output audit reports zero contract findings and zero game failures;
all 13 final targets converge. All 39 EVs independently recompute with pushes,
every executable source clock is nonfuture and within 120 minutes, final signal
IDs are unique, and no eligible market disappears. Model/payload persistence,
member publication and tracking writes are all zero.

The proposed board has 8 Best Angles / 2 Leans / 11 Watchlists / 18 No Plays.
Same-run upstream-to-final actionables move 12 to 10: two demotions, zero
promotions. Existing promotion paths remain tested; no replacement quota or
accuracy claim is invented. This is not a whole-production-versus-candidate
accuracy comparison.

Independent review confirms the input-use checks as well as output arithmetic:
LV retains ML/Spread price authority with Total unavailable and corrects to NYJ
while preserving the scoring Total. MIN has only ML price authority and changes
the margin from 2.3248 to 3.9888 while holding Total 45.9566. ATL retains a genuine
paired Total of 44.1829 with Spread unavailable; it deliberately holds Over43.5
because the present price implication remains Over despite an Under price path.
Those signals are adjudicated rather than suppressed by an unrelated market.

The two informational mean/majority boundary cases (ARI and CLE Total) are near
50% No Plays. Their means match the final distributions and selected sides match
their actual majority probabilities. No artificial score change is applied.

Verification passed: full NFL production suite; real-builder source/episode,
exact-cohort, direct-ML inversion, partial-retrace, axis-availability, held-line
juice, joint-axis, target-convergence, immutable-lock, stale-feature, source-clock,
push-EV and corruption regressions; full `npm run verify:model-change` including
post-verification; TypeScript; webpack production build; diff check. Optional
local PostgreSQL proof remains skipped because its URL is unset. PR checks run
their independent hosted proof.

Source limitations remain explicit: the local Playbook key is absent, so the
read-only run uses stored timestamped production observations. Owl's off-line
or otherwise unqualified split scopes stay context-only; no source data or
medical clearance is fabricated. Current code is private until protected PR
publication and live writer/reader/lease/lock proof; this report is not a claim
that the deployed reader changed or that future outcomes are known.
