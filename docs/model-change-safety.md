# Model change safety protocol

This is the required release checklist for any change that can affect predictions, model
inputs, probabilities, projections, grades, promotions/demotions, calibration, prices used,
or stakes. It exists to prevent mixed model eras, competing writers, accidental board
flattening, and load spikes.

## Owner-approved provisional exception: CFB confidence / execution PR #374

Approval and scope: Daniel Mengel, owner/operator of OddsphereAI, explicitly approved this
exception on 2026-09-04 after reviewing the limited independent holdout and the identical-board
impact. It applies only to PR #374 at remote head
`5df51da44d118121693df08261915b6c4039579a` before this governance amendment and to the CFB
confidence candidate `cfb_holistic_confidence_2026_09_04_r2_price_portable_execution`. The final
PR head may add only this approval record and verification metadata. It does not authorize a
similar exception for another sport, market, model, future threshold change, or stake change.

The owner acknowledges that the settled 2026-09-03 diagnostic is one independent date and does
not meet the normal held-out sample requirement in section 4. As a narrow exception, the reviewed
CFB policy may become active after all remaining protected-PR and live-proof gates pass. The
authoritative selected-side probability plus a maximum four-point combined contribution from
strict-identity Circa money-minus-tickets, Playbook money-minus-tickets, same-book line movement,
and same-book implied-price movement determines confidence. Ordinary evidence remains signed and
bounded; no individual channel is an automatic veto, promotion, or side flip. The evaluated
named-book quote and exact EV remain attached and determine only `bet` versus `shop` execution.

The reviewed September 3 board moves 2 Best Angles / 4 Leans / 17 Watchlists / 5 No Plays to
6 / 11 / 6 / 5, with 13 promotions, 6 demotions, and zero side changes. Massachusetts +29.5 is
recovered as Lean / Bet from 53.48% probability plus 2.4 bounded evidence points. The September 4
current-board replay moves 0 / 4 / 14 / 3 to 5 / 6 / 5 / 5, with 10 promotions, 7 demotions,
zero side changes, 7 displayed-quote Bets, and 4 Shops. These counts are evidence outcomes, not
quotas.

No stake creation or increase is authorized. Shop rows remain `no_bet=true`, zero-stake, and
excluded from exact-price ROI while retaining their confidence grade and locked-side accuracy.
The forecast PMF, side, probability, projection, exact quote, provider budget, T-60 immutability,
sole CFB writer, and `prediction_pipeline:cfb` lease are unchanged. MLB first inning is excluded.

Before merge, the amended exact tree must pass focused CFB tests, TypeScript, lint, `npm run
verify:model-change`, `npm run verify`, production build, latest-main integration safety, required
GitHub checks, and protected-PR up-to-date enforcement. Live acceptance requires a successful
natural CFB writer cycle, one empty released lease, a release-coherent member/tracking board, the
reviewed Bet/Shop separation, unchanged stake behavior, and preserved locked rows. Mixed releases,
side/probability drift, a writer or lease failure, missing-price rows presented as normal wagers,
tracking/reader incoherence, a stake change, or an unexpected actionable collapse triggers rollback
to the preceding r53/r28/r15 release family without rewriting locked evidence.

## Owner-approved emergency exception: CFB PR #265 provisional release

Approval and scope: Daniel Mengel, owner/operator of OddsphereAI, approved this exception on
2026-08-29. It becomes effective only when this governance change lands on protected `main` and
applies only to the CFB market/sharp-aware candidate reviewed in PR #265 at commit
`0e86abf4b02e55b26af0516e6c5a1eecc1403bcb`, whose candidate identifier is
`cfb_market_sharp_aware_shadow_2026_08_29_r3_borderline_spread`. It does not authorize later
changes to that candidate, any other sport or market, or any reusable relaxation of this
protocol. PR #265 remains a zero-write candidate and is not, by itself, a production cutover.

The owner acknowledges that chronological, source-specific historical CFB split validation is
unavailable for this provisional release. As a narrow exception to the shadow-only requirement
in section 4, the identified candidate may advance after all gates below pass. Current canonical
market movement and strictly matched sharp evidence may influence the single authoritative joint
PMF and every value derived from it: expected scores, representative score, winner probability,
same-line Moneyline/Spread/Total probabilities, predicted sides, exact-price EV, predictions,
and play grades. Sharp evidence must retain the candidate's exact league/team/date/market identity
rules, including exact-line identity for Spread and Total; missing or mismatched evidence is
unavailable, never neutral, inferred, relabeled, or fabricated. Movement evidence must remain the
same evaluated sportsbook's exact operational opening-to-current comparison.

The authorized math is bounded to the reviewed candidate: exactly 25% market/sharp PMF weight and
75% independent-football PMF weight, with sharp anchor adjustments capped at one point of home
margin and one point of game total. The reviewed balanced promotion/demotion and bounded spread
recalibration rules may affect grades, including the tested TCU-UNC case, but cannot create or
increase a stake. This exception forbids stake inflation, fabricated or loosely matched evidence,
rewriting locked or settled records, historical backfill presented as forward evidence, parallel
prediction writers, a second refresh path, or bypass of the sport-scoped `prediction_pipeline:cfb`
lease. The sole existing CFB writer remains authoritative.

Production activation requires a new immutable and internally coherent set of every affected
model, distribution, probability, calibration, public-outcome, decision, grade, schema, collector,
member, writer, fixture, tracking, and presentation release/version identifier. Generated
snapshots and tracking evidence must stamp that set. Old rows remain immutable, and evaluation
must separate forward results by exact release set and locked timestamp; mixed-era aggregates may
not be reported as current-release performance.

Before merge, the production cutover must pass focused CFB tests, TypeScript, lint,
`npm run verify:model-change`, `npm run verify`, build, and integration safety against the latest
remote `main`. It must report before/after promotion, demotion, actionable, No Play, and coverage
counts for the same eligible board. It must use a clean, up-to-date protected PR and retain every
testing, current-main-ancestor, no-overlap, deployment, and live-proof requirement in this file
and `AGENTS.md`; this exception authorizes no bypass of branch protection or integration safety.

Prepare the preceding coherent release and reader snapshot before activation. Roll back or hold
the provisional release upon any mixed current-slate release identifiers, reader/writer release
or value incoherence, missing required price coverage presented as a normal model No Play,
writer/reader crash, overlapping writer or lease failure, stale pre-release snapshots resurfacing
during refresh, or unexpected actionable-board collapse relative to the preceding release on the
same covered cohort. After rollback, preserve all new rows as release-stamped evidence rather than
rewriting them. Live success requires production database and member-site proof of the expected
release set, one leased writer, coherent board and T-60 locks, current price coverage, reader
freshness, tracking separation, and site responsiveness.

### Owner-approved stabilization amendment: actionable CFB grade ladder

On 2026-08-29, after inspecting the first production r12 forward wave, Daniel Mengel explicitly
approved one additional provisional grade-ladder amendment for this same identified PR #265 CFB
candidate. This amendment does not authorize different PMF math, another sport, later threshold
tuning, outcome-informed recalibration, a stake, or a second writer. The 75% independent / 25%
market PMF and maximum one-point sharp anchor adjustments remain unchanged. It exists only to
repair the release-transition failures and allow a usable, still bounded actionable board from
complete exact-price evidence while a later normally validated recalibration is prepared.

The owner explicitly rejected limiting promotion eligibility to American prices from -125
through +125 as too narrow. The sole CFB writer may apply these three additional actionable-tier
rules after the already authorized market/sharp PMF, probability grade, strict-evidence resistance
checks, and existing balanced promotion/demotion rules:

1. An existing `Lean` may become `Best Angle` only when its exact-price tuple has model
   probability at least 55%, target-excluded edge at least 5 percentage points, exact-price EV at
   least 6%, American price from -500 through +500, and neither strictly matched sharp evidence nor
   same-book movement resists the selected side.
2. A complete Spread `Watchlist` may become `Lean` only when its exact-price tuple has model
   probability at least 53%, target-excluded edge at least 2.5 percentage points, exact-price EV
   at least 2%, absolute spread no larger than 10 points, American price from -500 through +500,
   and neither strictly matched sharp evidence nor same-book movement resists the selected side.
3. A complete Total `Watchlist` may become `Lean` only when its exact-price tuple has model
   probability at least 52%, target-excluded edge at least 2.5 percentage points, exact-price EV
   at least 1.5%, American price from -500 through +500, and neither strictly matched sharp
   evidence nor same-book movement resists the selected side.

The frozen 2026-08-29 15:56:08Z r12 FBS wave contains 20 evaluated tuples after the failed legacy
TCU lock is excluded from recomputation. Before this amendment it is 0 Best Angles / 2 Leans / 12
Watchlists / 6 No Plays. Applying the thresholds above with explicit home/away abbreviation
identity and without using game outcomes yields 2 Best Angles / 2 Leans / 10 Watchlists / 6 No
Plays under the first two rules. The owner-approved Total rule yields the final 2 Best Angles / 4
Leans / 8 Watchlists / 6 No Plays: two existing Leans advance one tier, two Spread Watchlists and
two Total Watchlists become Leans, and two stored Watchlists correctly become No Play when the
selected team is mapped to resisting sharp evidence.
That is six tier promotions, two demotions, and four additional actionable tuples. Existing
resistance demotions remain active and can reduce live counts as prices or evidence move. No rule
can create or increase a stake. These frozen counts are an audit result, not a target, quota, or
required live distribution; every live grade must arise naturally from its own complete tuple and
evidence gates.

The production implementation requires another complete immutable release/version set and the
same protected-PR, integration-safety, focused/full testing, normal deployment, single leased
writer, release-separated tracking, and live database/member proof required above. A held legacy
T-60 row may not satisfy a new release's lock requirement; a genuinely valid immutable prior lock
must remain frozen. Historical same-book price observations may be used across release boundaries
for reader-only movement provenance, but model outputs, decisions, locks, and performance remain
release-separated. No missed or started game may be retroactively represented as an on-time lock.
Roll back or hold on mixed releases, value/reader incoherence, missing price coverage presented as
normal No Play, a writer/reader crash, lease failure, stale snapshot resurfacing, failed future
T-60 creation, or another unexpected actionable-board collapse.

## Owner-approved provisional exception: UCL EPL-grade transfer r6

Approval and scope: Daniel Mengel, owner/operator of OddsphereAI, explicitly
approved this exception on 2026-09-03 after reviewing the live forecast-only
UCL board. It applies only to the unchanged UCL model
`ucl_goals_coherent_2026_09_03_r6_authenticated_match_stats_manifest` and the
grade release
`ucl_grade_policy_2026_09_03_r6_owner_approved_epl_v23_transfer`.

The owner directed UCL play grades to inherit the established Premier League
foundation rather than remain universally No Play while new UCL exact-price
outcomes accrue. The UCL implementation must own and freeze the EPL v23
hierarchy; it may not call the mutable EPL grade runtime. UCL forecast sides,
the coherent regulation-time PMF, probabilities, expected scores, and target-
excluded evidence rules remain unchanged. Every actionable requires a complete
current quote and positive exact-price forecast-side EV. Match Result remains
forecast-first, sparse club priors retain their caps, and Double Chance remains
monitoring-only. No stake, quota, contrarian side, or parallel writer is
authorized.

This is a provisional transfer policy, not a UCL-specific historical price-
validation claim. Production and tracking must stamp the exact UCL calibration
release and report forward T-60 results separately. Before merge, the frozen
18-game board replay must report coverage, promotions, demotions, market mix,
side changes, and nonpositive-EV actionables; focused UCL tests, TypeScript,
lint, `npm run verify:model-change`, production build, protected PR, integration
safety, deployment, and live proof remain mandatory. A total current-price
collapse may not replace a priced member LKG. Roll back future unlocked rows to
r5 on any nonpositive-EV actionable, side substitution, mixed release, broken
four-market lock, or unexpected actionable-board collapse, while preserving
all locked r6 evidence unchanged.

Evidence: `docs/model-audits/2026-09-03-ucl-epl-grade-transfer-r6-predeclaration.md`
and `docs/model-audits/2026-09-03-ucl-epl-grade-transfer-r6-result.md`.

## 1. Declare scope before editing

- Name every affected sport, market, model family, calibration layer, writer, reader, and cron.
- Record the current champion version/release identifiers.
- Identify the single authoritative write path and its sport-scoped lease.
- Check the worktree and preserve unrelated changes.

## 2. Version behavior, not filenames

- Any behavioral change requires a new immutable model or calibration release identifier.
- A release identifier must be stamped into generated snapshots and tracking evidence.
- Old rows remain historical evidence. Do not rewrite them to the new version.
- Reports must separate release eras and show the exact start time/date of each era.
- A fallback may read an older snapshot only for availability; it must remain visibly stamped
  as old and must never be counted as the active release.

## 3. Prove data and runtime coherence

- All scheduled prediction writers for a sport must use the shared `prediction_pipeline`
  lease. Do not create a second independent writer or timer.
- Odds, stats, context, model generation, publication, and locking run in that order.
- Frequent lock sweeps remain targeted to games entering the lock window; they must not turn
  into full-slate refreshes.
- Confirm provider coverage, stored-price coverage, model version, calibration version, and
  published-reader version agree before publication.
- Missing required evidence creates an internal hold/data-health finding. The
  member contract may present that exception as `NO_PLAY` only with an explicit
  incomplete-evidence reason and separate operational-exception accounting; it
  must not fabricate or count a completed model evaluation.

## 4. Calibrate with promotion/demotion balance

- Never tune on the same outcomes used for final evaluation.
- Use chronological train/calibration/holdout splits and report each separately.
- Report record, locked-price units/ROI, Brier score/log loss, calibration gap, and board count.
- Treat multiple correlated props from the same player/game as clusters when estimating
  uncertainty; row count alone overstates the independent sample.
- Every demotion rule must be paired with a tested promotion rule from an eligible candidate
  pool. Report promoted count, demoted count, net actionable-board change, and market mix.
- A promotion must improve held-out value or calibration without bypassing price, lineup,
  freshness, or data-quality gates.
- With insufficient held-out evidence, ship only shadow labels/audits—never live grades/stakes.

## 5. Bound load and failure behavior

- Reuse cached slate-level feature bundles; do not add per-card or per-user provider calls.
- Bound concurrency, pagination, snapshot size, retry count, and database writes.
- Failure must preserve the last coherent published snapshot and must not partially publish a
  new release.
- Do not clear or rewrite locked predictions as part of a model release.

## 6. Required verification

Run:

```bash
npm run verify:model-change
```

Then run focused tests/backtests for every affected model and a dry-run or shadow comparison
that reports old-versus-new decisions. Verify that unchanged markets remain unchanged.

## 7. Deployment and live proof

- Commit only intended files and deploy that exact commit.
- Verify production reports the expected release/version identifiers.
- Verify the latest writer completed under the shared lease with no overlapping writer.
- Verify odds/stat coverage, actionable counts, snapshot freshness, lock coherence, error rate,
  and site responsiveness.
- Re-run the live check after the next scheduled update and the next lock sweep.
- Do not say a change is live until production evidence proves it.

## 8. Rollback criteria

Prepare the previous release identifier and reader snapshot before promotion. Roll back or
hold the new release when any of these occur:

- mixed release identifiers on the same current slate;
- missing prices or required features presented as normal `NO_PLAY`;
- unexpected actionable-board collapse without the approved balanced replacement;
- overlapping prediction writers, timeout growth, snapshot-size failure, or reader crash;
- material disagreement between stored predictions and the member-visible snapshot.
