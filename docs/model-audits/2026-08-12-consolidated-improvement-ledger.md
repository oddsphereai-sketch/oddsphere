# Daily Edge consolidated improvement ledger

Date: 2026-08-12

Status: research and combined-release preparation; nothing in this ledger is live unless the
production registry and live snapshot both carry its final release identifier.

## Release approach

Do not deploy the findings piecemeal. Complete the cross-market search, resolve interactions,
run one combined paired board replay, assign one superseding release identifier, verify the full
model-change suite, then deploy and prove that exact release live.

The local r35 and r36 commits are inputs to this package, not declarations of live production.
The narrow -120 r36 Moneyline sleeve is superseded before deployment by the broader tier research
below. A final combined release must replace its identifier and documentation rather than changing
behavior under r36.

An unrelated uncommitted pitcher-shadow implementation is present in the shared worktree. It is
explicitly excluded from this package: the requested product decision is actionable now rather
than dependent on prospective shadow accumulation. Preserve those files until their ownership is
resolved, but do not include their registry, scripts, or runtime wiring in the combined release.

## Live publication coherence check

- The 09:00 ET member snapshot and the 09:07 ET writer state briefly showed opposite MLB
  Moneyline sides while the 09:05 slate cycle was still running. The stored member snapshot was
  internally coherent and intentionally remained last-known-good during the writer transaction.
- After the slate cycle completed, production republished an 09:07 ET snapshot and the live board
  matched the current writer side/price/probability/grade tuples (including ATH +175 rather than
  the prior TB -200 card).
- Conclusion: no persistent reader-side mapping defect was reproduced. Preserve the current
  atomic old-snapshot-until-success behavior; final deployment verification must still prove that
  every successful writer run publishes the matching response snapshot before completion.

## Final r37 candidate inventory

### MLB Moneyline neutral-consensus Best Angle

- Exact selected-side SharpAPI tickets and money must both be at least 70%, movement must be
  neutral, price must be -200 through +200, quality must be high, and no correction or inversion
  may have fired. Model probability is context only.
- Evidence: 45-15, +26.4% ROI; 27-9 train, 14-5 validation, 4-1 holdout. Slate-date bootstrap
  fifth-percentile ROI was +10.8%.
- Threshold sensitivity: 65% was 52-25, 70% was 45-15, 75% was 34-11, and 80% was 24-8.
  The incremental bands below 70% were not separately healthy, so they are not labeled Lean.
- Final grade: Best Angle only.

### MLB Moneyline movement Lean

- Exact selected-side SharpAPI evidence, high-quality/fresh data, unchanged final side, no
  correction/inversion, price -200 through +200, at least 1.5 points of movement toward the pick,
  and money-minus-tickets below 10.
- Full cohort: 15-5. Incremental outside the existing top-one ranker: 11-5, with validation and
  holdout at 9-2. The early incremental slice was 2-3, so this remains a Lean, never Best Angle.
- The broad one-point trigger was rejected after the corrected cohort went 4-4 in train.

### MLB Total SharpAPI-support Under Lean

- Under only; -145 through +145; high quality; no movement against; exact selected-side SharpAPI
  money-minus-tickets at least +10.
- Evidence: 17-5; 8-1 train, 5-3 validation, 4-1 holdout.
- The Over branch was rejected: although 33-24 overall, it was 6-6 in validation and 6-6 in
  holdout. The rule does not use that aggregate strength.

### MLB first-inning availability

- A complete two-sided FI market and publishable lineups now produce a non-actionable Toss-Up
  when a probable starter is genuinely unpublished. It becomes directional when the starter and
  required history arrive. Missing markets, lineup failures, and scratches remain held.
- This changes visibility, not actionable count, side, edge, price, or stake.

### WNBA spread projection/rest Lean

- A Watchlist spread can promote when the selected side has positive canonical projection gap,
  rest is not against it, at least ten books quote the market, an exact selected-side price exists,
  and public conflict is absent.
- Evidence: 22-10, +29.7% ROI; 9-6 train, 7-2 validation, 6-2 holdout. Slate-date bootstrap
  fifth-percentile ROI was +6.3%. The incremental cohort outside the existing v4 home agreement
  rule was 11-7.
- Current August 12 effect: none; all three current spreads fail at least one gate.

## Rejected findings

- Neutral-consensus MLB Moneyline Lean below 70%: its apparent aggregate strength was borrowed
  from the 70% Best Angle subset.
- MLB one-point movement Lean and movement-based Best Angle: corrected early-period evidence did
  not support those grades.
- MLB SharpAPI-support Overs: flat validation and holdout.
- WNBA playable-price Moneyline support: no robust practical-price cohort.
- WNBA Total support: no cluster-robust candidate, and the exact read is generated after the
  authoritative model writer; no second writer or post-hoc grade path was added.
- WNBA public-support spread rule: historically negative.

## Combined board impact

The read-only consolidated replay reports 130 unique historical promotions across 44 dates:
60 Moneyline Best Angle upgrades and 70 Lean promotions, with no demotions. This is an average
of about 2.95 added actionables on dates with at least one qualifier and a maximum of ten. These
are promotion-pool counts across immutable historical releases, not a claim that every row would
have remained nonactionable under every later rule. Current-slate paired dry runs remain the
authority for exact live deltas.

The August 12 MLB dry run adds Arizona Moneyline as a Best Angle. At the latest inputs, the new
movement and Under-support sleeves add no further current full-game actionables, and the FI
availability change converts the genuinely unpublished-starter case from Held to Toss-Up when
its market/lineup gates are complete. The WNBA dry run adds no current play.

## Release checklist

- Superseding MLB release: `mlb_daily_edge_decision_2026_08_12_r37`.
- Superseding WNBA grade policy: `wnba_grade_policy_v5_projection_rest_spread_agreement_2026_08_12`.
- One authoritative writer per sport and the existing sport-scoped `prediction_pipeline` leases
  are preserved.
- No new rule changes a side, projection, probability, price, or stake, and no rule bypasses
  hold, no-bet, freshness, missing-price, or data-quality gates.
- Props are explicitly outside this task and are not included in this release.
