# NBA point-in-time player-state ledger r1 predeclaration

Date: 2026-10-29

Status: data-foundation contract only. No production model, writer, member,
grade, stake, lock, market-reader, board, or persisted-shadow authority.

## Why this is next

The external-review loop exhausted the checked-in aggregate team feature
families without finding a practically meaningful independent-score gain. The
existing live roster-regime residual uses static prior player profiles, a
current active roster, exact reported OUT exclusions, and retained-minutes
thresholds. It is not a reproducible historical decision-time player-state
ledger.

The repository does not currently contain the historical raw player archive,
immutable injury/roster observations, or the training operator needed to
rebuild that residual end to end. Its release record says historical rotation
membership came from game participation; the replacement ledger must prove
that only games before the forecast cutoff contributed to each row.

No further model fitting is allowed until the data gates below pass.

## Frozen decision boundary

Use the existing T-60/lock lifecycle boundary as the decision cutoff. A later
observation may create a later unlocked snapshot under the normal lifecycle,
but may not rewrite an earlier snapshot or any locked record.

Missing, partial, ambiguous, future-dated, or structurally malformed evidence
is `unknown`. It is never interpreted as healthy, active, zero-impact, or a
reason to borrow the target-game result.

## Append-only source observations

Retain raw, content-addressed observations for:

1. schedules and original scheduled tip times;
2. player box and advanced rows with result-availability timestamps;
3. active-roster and transaction observations with effective timestamps;
4. ESPN exact-game and official NBA injury reports with source-published and
   fetched timestamps;
5. team-section completeness and every provider identity used in resolution.

Every observation must store source, source record id, game/team/player ids,
raw and normalized status, injury reason when available, published/effective
time, fetched time, payload hash, and collector release. Later corrections are
new observations, never updates in place.

## Identity and membership

- Freeze effective-dated BALLDONTLIE, ESPN, and official-NBA game/team/player
  crosswalks.
- Names are display fields, never the sole join authority.
- Team membership has explicit `valid_from` and `valid_to` evidence.
- Trades, signings, waivers, re-signings, and two-way assignments cannot leak
  backward.
- Ambiguous or duplicate player-game identities fail unavailable.

## Immutable decision-time snapshot

For each game and cutoff, select only observations published/effective at or
before the cutoff. Store the selected raw observation ids, input hashes,
collector releases, completeness state, and final snapshot hash. Replay must
produce the same hash after future data arrives.

Using only earlier games whose results were available before the cutoff,
calculate:

- rolling appearances, starts, minutes, usage and same-team tenure;
- expected rotation membership and participation probability;
- expected minutes with prior-season shrinkage;
- point-in-time player impact and PIE;
- reference rotation and rotation overlap;
- absence duration and first-game-back state from evidence known at cutoff.

Current-game starters, active list, minutes, usage, box score, DNP reason, and
post-tip reports are forbidden inputs.

## Expected rotation

Normalize each team's expected regulation rotation to 240 minutes. In the
first model experiment, set expected minutes to zero only for a verified OUT
designation published before cutoff. Redistribute those minutes only across
players known available at cutoff using prior rotation evidence. Preserve
original and replacement allocations and fail unavailable when a coherent
240-minute allocation cannot be produced.

Minimum player fields:

- expected participation and minutes;
- prior/current impact and PIE;
- roster membership and team tenure;
- injury state, absence duration and evidence timestamps;
- provenance, completeness and uncertainty.

Minimum team fields:

- unavailable expected-minute share;
- unavailable impact-minutes and top-one/top-three unavailable share;
- expected rotation net/PIE shock;
- retained expected-rotation minutes and overlap loss;
- replacement-quality gap;
- roster turnover, evidence completeness and uncertainty.

## Data gates before fitting

- zero post-cutoff inputs;
- zero current-game participant/minute/usage inputs;
- zero duplicate or ambiguous identities;
- target-game outcome and future-record mutation tests leave the feature hash
  unchanged;
- post-cutoff injury updates leave the cutoff snapshot unchanged;
- every complete team rotation sums to 240 minutes within tolerance;
- complete/partial/unknown coverage is reported by season and cohort;
- at least 1,000 complete 2023-24 selection games and at least 300 genuine
  verified-availability or roster-change games;
- the complete ledger and its schema receive frozen hashes.

If any gate fails, stop without fitting.

## First bounded experiment after the ledger passes

Run three chronological arms:

- A: rebuilt portable point-score baseline;
- B: chronologically rebuilt incumbent roster-regime r2 recipe using the new
  genuine point-in-time ledger;
- C: one continuous expected-rotation residual replacing B's correction.

C uses exactly six continuous features:

- home-minus-away and home-plus-away expected net-impact shock;
- home-minus-away and home-plus-away expected PIE shock;
- home-minus-away and home-plus-away expected rotation-overlap loss.

Fit zero-intercept margin and Total residual heads at alpha 1000. There is no
retained-minutes activation threshold, cap, alternate window, feature subset,
hyperparameter search, market input, or questionable/doubtful probability in
the first experiment.

Selection compares C against B; B versus A is attribution only. Use 2023-24
selection, a season-stratified calendar-week paired bootstrap, fixed incumbent
margin cohorts, and the existing independent-score acceptance gates including
at least 0.10 team-score MAE improvement. Report verified-OUT, roster-change,
stable/disrupted rotation, top-impact OUT, short/extended absence, no-shock,
and unavailable-evidence cohorts. No-shock rows must remain exact or
numerically negligible.

If C fails, do not search thresholds. Diagnose the ledger or stop. If it passes,
open 2025 once as already-opened replication evidence, then require current
2026-27 forward locked confirmation. Only after the independent challenger
passes may the unchanged market reader be evaluated on the same exact rows,
with correction/harm, flip, promotion/demotion, and board-count ledgers.

Any later production proposal must replace the current roster-regime data path
rather than add a parallel writer, bump every affected release identifier,
preserve the shared `prediction_pipeline:nba` lease and locked-record
precedence, pass `npm run verify:model-change`, latest-main integration safety,
a protected pull request, and post-deploy verification.
