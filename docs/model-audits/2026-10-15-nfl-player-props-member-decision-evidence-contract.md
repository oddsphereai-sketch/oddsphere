# NFL Player Props member decision-evidence contract

## Scope

This release starts from merged production commit `808a750c4cf73a1e2839ee6b97f715192923f64b`.
It extends the stored decision contract for a later OddSphere-native reader without changing the
current UI. It does not copy BettingPros, add filler, alter the independent model, grant market
authority to another prop family, or change a projection, probability, side, grade, threshold,
stake, canonical line, provider call, cadence, settlement, or tracking eligibility rule.

The evidence block is created only on a newly evaluated row before that row can lock. A legacy
locked row remains exactly as stored and may legitimately have no decision-support block. The
member reader passes that absence through and never reconstructs new semantics onto the public
record.

## Verified member fields

Each newly evaluated row stores one versioned `decisionSupport` block:

| Product need | Stored contract | Provenance |
| --- | --- | --- |
| Independent model probability | `probability.independentSelectedSide` | Existing stored `rawModelProbability` |
| Published model probability | `probability.publishedSelectedSide` | Existing stored `finalProbability` |
| Fair American price | `probability.fairAmericanPrice` | Deterministically derived from the stored published probability and labeled `derived_from_stored_published_probability` |
| Target-excluded market probability | `probability.targetExcludedMarketSelectedSide` | Existing stored `marketProbability`; not relabeled as Sharp-only |
| Best evaluated exact price/book | `price` | The existing runtime best-price winner after exact game/player/market/line/side grouping |
| Same-book opening/current | `movement.opening` / `movement.current` | Existing selected-book opening and current quote |
| Independent/published projection | `projection.independent` / `projection.published` | Existing projection provenance and stored published point |
| Distribution | `projection.centralRange` | Existing empirical-residual central 80% range |
| Market-specific usage/matchup evidence | Existing sibling `forecastContext` | Timestamped raw production, role/opportunity, opponent allowance, team/QB, availability, weather/context inputs |
| Qualified reference no-vig evidence | `qualifiedReference` | Target-book-excluded Pinnacle/NoVig source line, target line, source and transported selected-side probability, observation time, and confirmation flag |

The contract deliberately reports two fields as unavailable:

- `movement.prior` is null with `unavailable_not_persisted_in_member_snapshot`; the current member
  snapshot has true opening/current quotes but no verified intermediate same-book stop.
- feature percentile status is `unavailable_no_validated_reference_distribution`; raw model inputs
  are present, but no validated population/reference distribution exists from which to publish an
  honest percentile.

These availability states are product data, not placeholders. A later reader can omit them or label
them unavailable, but cannot infer or fabricate either value.

## Qualified reference boundary

Only the already-qualified Receptions source-aware lane can populate qualified-reference evidence.
For each evaluated target book, the evidence excludes that book, retains only Pinnacle and NoVig,
uses the same frozen residual distribution to transport a nearby source line to the target line,
and records each book separately. `confirmsSelectedSide` means the transported selected-side
probability is at least 50%; it is not a ticket split, handle split, limit, bet-size, or sharp-origin
claim.

Passing Attempts, Passing Completions, Passing Yards, Receiving Yards, Rushing Attempts, Rushing
Yards, and Anytime TD report `market_not_qualified`. A Receptions row with no retained qualifying
reference reports `qualified_reference_not_captured_for_decision`. Neither state changes the
forecast.

## Week 6 rehearsal and board impact

The zero-write Week 6 rehearsal at `2026-10-15T15:28:39.106Z` reads 40,174 observations, 15,951
exact offers, and 1,946 qualified reference observations (746 Pinnacle, 1,200 NoVig). It produces
1,194 member rows; all 1,194 newly evaluated rows carry decision support and 226 carry qualified
reference evidence. The reference cache error is null and source-aware availability is true.

On that provider capture the complete board remains 15 Best Angles, 28 Leans, 217 Watchlists,
1,473 No Plays, and 189 held rows, with 43 total actionables. Those counts are a current-slate
observation, not a quota. The support block is attached only after price selection, posterior,
side, grade, and deduplication are complete, and no decision rule reads it. Model and calibration
release identifiers therefore remain unchanged.

## Releases, immutability, and rollback

- Runtime / board / decision: `nfl_player_props_runtime_2026_10_15_r32_member_decision_evidence` /
  `nfl_player_props_board_2026_10_15_r35_member_decision_evidence` /
  `nfl_player_props_decision_2026_10_15_r31_member_decision_evidence`
- Member / lifecycle: `nfl_player_props_member_2026_10_15_r43_decision_support_evidence` /
  `nfl_player_props_member_lifecycle_2026_10_15_r26_decision_support_evidence`
- Writer / tracking: `nfl_player_props_writer_2026_10_15_r53_member_decision_evidence` /
  `nfl_player_props_tracking_2026_10_15_r31_member_decision_evidence`
- Decision-support evidence / member support: `nfl_player_props_decision_support_evidence_2026_10_15_r1` /
  `nfl_player_props_member_decision_support_2026_10_15_r1`
- Unchanged model / calibration: `nfl_player_props_distribution_model_2026_10_15_r25_receptions_reference_required` /
  `nfl_player_props_distribution_calibration_2026_10_15_r27_receptions_reference_required`

Focused validation must prove newly evaluated support completeness, qualified reference
provenance, explicit unavailable states, exact legacy-lock reader precedence, member transport
bounds, runtime parity, one writer/lease, and zero UI/copy changes. Publication additionally
requires `npm run verify:model-change`, current-main integration safety, protected PR checks, and
live proof of the release tuple and support telemetry.

Roll back future unlocked publication to runtime r31, board r34, decision r30, member r42,
lifecycle r25, writer r52, and tracking r30 if the evidence contradicts its decision, snapshot size
fails, the reader reconstructs a legacy lock, releases mix, the board contracts, or any prediction
field changes unexpectedly. Existing locks and all captured reference/observer/private records
remain unchanged.

## Validation record

The collector foundation, runtime parity, production one-writer/T-60/lock contract, and snapshot
envelope suites pass. The production-contract test proves that the member reader leaves every
legacy locked row without reconstructed support. The runtime test proves that a newly evaluated
qualified Receptions row retains its exact Pinnacle source/target-line evidence, fair-price
derivation, explicit missing-prior state, and explicit percentile unavailability. TypeScript passes
with an 8 GB Node heap, and the complete `npm run verify:model-change` preverification and model
safety suite passes on the candidate tree.
