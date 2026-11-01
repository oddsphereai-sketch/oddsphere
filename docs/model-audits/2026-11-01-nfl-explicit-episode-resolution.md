# NFL explicit market episode resolution

Starting production base: `9241e0a6020bc8af93caa89b0fbab8e700ebe7ea`.

Owner requested repair of the spot-check findings and forward evaluation of accuracy.
Scope is NFL Moneyline, Spread, Total, the existing full-game arbiter, sole forward
writer and member snapshot reader. No new writer, provider loop, cadence, stake,
member copy or layout. The existing `prediction_pipeline:nfl` lease is unchanged.
Locked records retain exact stored precedence.

The preceding private candidate was writer r97 / model r41 / calibration r40 /
decision and grade r49 / member r46 / fixture r61 / snapshot r53. The production
predecessor remains r43 decision / r40 member / r55 fixture / r47 snapshot.

This repair exposes an unconfirmed named episode separately from confirmed market
direction. Only the full-game arbiter may corroborate a stable lone named episode
using a matching current target-excluded paired-price implication, backed by at
least two distinct fresh families. The ordinary confirmed-direction contract in
other NFL layers is preserved. Buyback, reversing and number/juice-conflicting
episodes cannot acquire authority through this path.

Opposing qualified flow is explicitly resolved against the current paired-price
implication before a side correction. A reverse-flow observation may favor the
price path; it is not an automatic veto or proof of bookmaker intent. Without
corroborating price direction the forecast is retained. Each market records the
actual value held or changed, price implication, named direction, split-source
agreement, supporting/opposing/context signal IDs and resolution reason. A Total
that did not change cannot report an applied scoring-environment change merely
because the side changed. These fields are internal evidence, not member copy.

The existing production snapshot predecessor key now includes its actual decision
release. The regression proves the stored payload is returned unchanged.

New candidate family: writer r98, model r42, calibration r41, decision/grade r50,
member r47, fixture r62, snapshot r54; market state r5, ledger r8, arbiter r24,
runtime r8 (`2026_11_01_*_explicit_episode_resolution`). Other model equations and
grade thresholds are unchanged. Existing symmetric grade eligibility remains;
there is no new conflict-driven demotion or quota-driven promotion.

Verification records are appended after execution. Current-input functional
rehearsals measure coverage and decision consequences, not historical accuracy.
Publication requires complete checks, same-input board impact, fresh-main
integration safety and protected PR publication. Roll back only unlocked future
outputs to the preceding complete production family; never rewrite locks.

## Executed verification

- `npm run test:nfl-v1-production`: passed, including writer and immutable lock tests.
- `npm run verify:model-change`: passed, including post-verification. Optional
  PostgreSQL proof skipped because `MARKET_BRAIN_POSTGRES_URL` is unset.
- `npx tsc --noEmit --pretty false`: passed.
- Independent AI review caught and corrected family-count self-confirmation,
  missing-price flow labeling, cross-market reason attribution, and Total
  story/reason consistency. Final review found no critical issue.
- Current-input r98 rehearsal: 13 games / 39 evaluations; zero database writes,
  13/13 complete named paired-price histories, zero rejected price pairs.
  Public Playbook observations use stored timestamped fallback in this local
  workspace. Owl's partial/mismatched contract qualifications remain explicit;
  unqualified splits cannot direct predictions.
- Same-run upstream to final reader: 9 Best Angles / 1 Lean / 11 Watchlists /
  18 No Plays becomes 5 / 2 / 8 / 24. Zero actionable promotions, three
  demotions, four market side changes; actionables 10 to 7. This comparison
  measures the final stage, not a full current-production-versus-candidate
  comparison. It does not establish accuracy or create replacement promotions.
- PHI@WSH resolves to 18.04–24.34: opposing moneyline flow is explicitly
  resolved toward the corroborated price path, Total held with a price/path
  disagreement reason. LV@NYJ resolves to 22.96–24.49: conflicting flow
  sources are recorded, NYJ ML Lean, LV Spread No Play. BAL@BUF retains
  23.22–32.14: current paired prices do not corroborate opposing spread
  movement. These are source-clock-specific functional checks.

Release qualification remains separate from the passing implementation checks:
the current board has three actionable demotions and no replacements. The broader
candidate must not be declared fully production-qualified from this rehearsal.

## Requested random post-repair checks

A random draw excluding the original defect examples selected MIN@DET, CHI@SEA,
and NE@MIA. Exact quote probabilities and EV recompute correctly for all nine
markets. Every selected side agrees with the single final score.

NE@MIA's apparent history discrepancy was resolved against the original stored
October 27 captures: Circa and Pinnacle were both NE -7.5 before the later -7
tape. A Miami cover correction can coexist with a New England outright winner.
Both evaluated side prices have negative EV, correctly remaining No Play. The
Under remains Watchlist because the current paired-price implication does not
confirm an actionable Under at the evaluated line.

MIN@DET exposed a genuine additional defect: the evaluated Under 46 was receiving
split qualification against representative Total 46.5. R99 now derives each
contract from the selected quote, checks source lines exactly (no half-point
tolerance), and includes selected line in target resolution convergence. It
passes that contract through public/sharp qualification, named/professional
factories, unified Total, the final state and ledger. Narrow line-only contexts
never manufacture sportsbook prices. The new focused test reproduces and rejects
46.5 flow at an evaluated 46 contract while retaining matching 46 evidence.

The subsequent 13-game r99 no-write capture confirms MIN's off-line Total flow is
context only, with its score and evaluated Under 46 unchanged. The three random
scores remain MIN21.82–DET24.14, CHI19.31–SEA23.43, NE24.26–MIA17.66. Chicago's
old Circa source clock is excluded despite a later retrieval time. Source-timed
Pinnacle resistance is retained; current prices still support Seattle, so no
automatic winner flip is inferred. R99 candidate counts are 5 Best Angles /
2 Leans / 9 Watchlists / 23 No Plays at that source clock.

Post-contract focused NFL tests, full model-change verification, TypeScript and
webpack production build pass. The Turbopack build rejects this worktree's shared
node_modules symlink; webpack compiles and prerenders successfully. The repaired
snapshot reader loads the existing production r47 snapshot, 14 games/42 markets,
with no critical health findings and no writes.

## Final evaluated-target ordering and repeat sample

After a score changes, price shopping can change its evaluated book or line.
The final writer now rebuilds exclusions, paired prices, exact split contracts
and the reader from the original released forecast until those final targets
match. It never compounds corrections, adds a provider request, or invents a
price. A bounded cycle/unavailable case retains the exact original score/grades
and records an explicit target-resolution hold. Tests cover changed books,
same-book line changes, convergence and cycles. Final target-exclusion and
Owl qualification coverage reflect final selected contracts.

The final zero-write r99 capture has 12 stable games and one explicit two-step
cycle (NE@MIA), with 5 Best Angles / 2 Leans / 11 Watchlists / 21 No Plays.
The same-run final-stage impact remains zero actionable promotions and three
demotions. The final random checks independently recompute all nine exact-price
EVs and confirm all score/pick sides. MIN and CHI stabilize in one iteration;
NE preserves its original 24.79–17.13 score and exact grades after its cycle,
rather than publishing a self-referential quote correction. Its reader is
neutral and does not claim an applied market resolution.

MIN's retained October 27 Circa opening was 45.5, followed by 46.5 and a return
to 45.5. It is a buyback, not simply an opening-to-current Under move. The
earlier spot-check summary beginning at the later tape observation cannot
replace that original source history. Final MIN Under46 excludes public46.5
and Circa45.5 flow from directional authority; stale CHI Circa flow remains
excluded. No new defect was found in the repeated random sample.
