# Soccer exhaustive loss-ledger predeclaration

Date: 2026-10-13

Status: frozen read-only audit contract; no production behavior change

## Objective

Explain every eligible settled loss in the Premier League, Champions League,
and inactive World Cup prediction records under the complete Daily Edge loss-
review standard. The audit must identify repeatable pregame defects in the
independent model, market reader, coherent-score reconstruction, probability
calibration, grade policy, or data pipeline without converting postgame facts
into historical pregame features.

The live Premier League r20 release remains the production champion while this
audit runs. No candidate may replace it merely because it flips memorable
losses. Existing locked records are immutable.

## Competition and settlement contracts

- Premier League: regulation-time three-way Match Result, Double Chance,
  full-game Total, and BTTS. Active model
  `epl_goals_coherent_2026_10_13_r20_coherent_total_margin_matchup`; active
  calibration `epl_grade_policy_2026_10_10_v25_exact_match_result_price_tiering`.
  Settled r18/r19 locks are diagnosis evidence; r20 has no settled forward
  sample yet and may not inherit their observed record.
- Champions League: regulation-time three-way Match Result, Double Chance,
  full-game Total, and BTTS. Active model
  `ucl_goals_coherent_2026_10_06_r7_target_excluded_opening_market_score`;
  active calibration `ucl_grade_policy_2026_10_06_r7_opening_market_score_inputs`.
- World Cup: historical regulation-time records only. It is inactive and no
  runtime activation is authorized by this audit.

Each market decision is one ledger row. A game-level score or context finding
may be linked across rows but may not be copied as the market disposition.

## Frozen population and exclusions

The primary empirical population is every immutable soccer
`prediction_records` row that:

1. has a non-null lock timestamp;
2. has an exact competition identity;
3. belongs to Match Result, Double Chance, Total, or BTTS;
4. has a settled regulation-time result; and
5. is not an operational hold or void.

Rows are release-separated. Superseded records never replace a later record
and later semantics never reinterpret stored locked fields. Duplicate or
partial same-game release cohorts, missing exact competition identity, voids,
and held rows are reported with one exclusion reason rather than silently
dropped.

The chronological blocks are frozen before candidate testing:

- development: earliest 50% of eligible games by kickoff;
- confirmation: next 25%;
- later holdout: final 25%.

Where a competition's genuine forward release is smaller, the exact release-
pure forward cohort is reported separately and never pooled to inflate the
holdout. Candidate selection uses development only; confirmation can reject or
advance a frozen candidate; holdout is opened once for final evaluation.

## Required immutable fields per row

The exporter must retain:

- record, game, event, competition, market, side, line, price, sportsbook,
  kickoff and lock identities;
- model, calibration, outcome, reader, writer and lifecycle releases available
  in the locked payload;
- stored result, actual regulation score, grade, no-bet/held/stake fields;
- the exact stored final probability and projected score;
- the stored independent forecast before market evidence when present;
- the stored market-reader recommendation, authority, adjustment, provenance,
  source class, target exclusion and freshness when present;
- opening, intermediate, prior and lock-time same-book observations when
  present, plus cross-book vectors without relabeling them as same-book moves;
- public/sharp split values, source, captured time and availability state;
- pregame form, xG, shots, shots on target, possession, lineup, availability,
  rest, travel and competition context captured at lock;
- explicit missing/stale/defaulted fields; and
- reconstruction provenance for a field that was genuinely never stored.

Unknown evidence stays unknown. Current providers are not called to recreate
historical state.

## Ordered review and dispositions

Every loss and a matched set of wins from the same competition, market,
release, grade, favorite/underdog state, line band and evidence regime pass the
same ordered review:

1. lock, identity, and data health;
2. independent, market-reader, and final decision layers;
3. independent strength/form, matchup/process, personnel, opportunity, venue,
   rest/travel and variance inputs;
4. complete stored pre-lock market sequence, source authority, persistence,
   reversal/buyback, target exclusion, cross-market agreement and split state;
5. score, margin, total, side-probability and grade calibration errors;
6. postgame decomposition, strictly isolated from candidate inputs;
7. one primary disposition, secondary tags, confidence, and follow-up state;
8. recurrence across losses and matched wins; and
9. chronological candidate proof.

Allowed primary dispositions are exactly those in
`2026-10-13-daily-edge-loss-review-standard.md`. `Insufficient evidence` is
required when the record cannot support a causal claim. A loss cannot be called
variance without sport-appropriate process evidence.

## Soccer-specific diagnostics

- Three-way result and Draw probability, recall, precision and calibration are
  mandatory. A draw is never converted into a home/away win for diagnosis.
- One coherent regulation-time score distribution must reconcile Match Result,
  Double Chance, Total, BTTS and displayed decimal scores.
- Score metrics include team-goal MAE/bias/correlation, margin and Total
  MAE/bias/correlation, median absolute error, 90th-percentile error and
  projected-versus-actual dispersion.
- Goal-discrete alternates are diagnostic only. They never change the main-line
  outcome.
- Red cards, penalties, finishing, goalkeeping and sequencing are postgame
  decomposition fields unless an authentic pregame analog was already stored.
- EPL, UCL and World Cup retain separate team-strength, schedule, competition,
  lineup and market-authority contracts. No coefficient or rule transfers
  automatically between them.

## Candidate families

Candidates may be formed only from recurring ledger findings and must expose
their targeted losses and at-risk matched wins. The initial family tournament
is:

1. independent score structure: dynamic attack/defence, home advantage,
   opponent-adjusted goals/xG and lagged shot/shot-on-target/possession process;
2. draw structure: Dixon-Coles/bivariate or diagonal-inflation alternatives
   without draw quotas;
3. derived Total/BTTS calibration from the shared score PMF;
4. competition-specific market arbitration using only target-excluded stored
   opening/sequence evidence, with confirm, resist, adjust and flip outcomes;
5. data-health and availability gating that preserves predictions when optional
   market evidence is absent; and
6. grade recalibration only after the forecast candidate is frozen.

No universal threshold, blind market follow, market center, postgame feature,
target-book leakage, release blend, or hard-game exclusion is eligible.

## Promotion gates

A production candidate must improve its intended primary metric in confirmation
and later holdout, not only pooled history. It must report:

- full and actionable records by market and release;
- corrections, harms and net corrections versus the champion;
- multiclass/binary Brier and log loss where applicable;
- all score error, bias, dispersion and tail metrics;
- Draw, upset and underdog precision/recall;
- performance with and without optional market/split evidence;
- promotions, demotions, board count and market mix on the same eligible board;
- missing/stale evidence behavior and zero provider calls for historical replay;
- runtime parity and unchanged locked records.

Forecast improvement may not be manufactured by flattening the board. Every
actionable demotion requires a tested promotion pool. Exact-price return is
secondary to prediction/projection accuracy and calibration.

Any production publication requires new immutable release identifiers, focused
and full model-change verification, latest-main integration safety, protected
PR checks, merge, and live writer/lease/release/coverage/lock proof. Until those
gates pass, outputs remain audit-only.
