# NBA player props exact-price grade recalibration predeclaration

Date: 2026-10-22  
Status: completed offline audit; focused private candidate awaits explicit release approval; no public or member activation

## Objective and scope

Recalibrate the exact-price actionability layer after the active-role integrity
repair without changing the accepted independent projections, market-side
arbitration, provider cadence, product layout, member copy, lock behavior, or
writer topology. The affected model family is NBA player props across points,
rebounds, assists, threes, points+rebounds+assists, points+rebounds,
points+assists, and rebounds+assists.

The starting releases are:

- frozen runtime:
  `nba_player_props_frozen_runtime_artifact_2026_10_22_r5_active_role_integrity`
- model tournament:
  `nba_player_props_model_tournament_2026_10_22_r13_active_role_integrity`
- exact-price grade:
  `nba_player_props_exact_price_grade_2026_10_22_r12_active_role_integrity_private_only`
- decision:
  `nba_player_props_forward_decision_2026_10_22_r5_active_role_integrity_disabled`
- product/member snapshot:
  `nba_player_props_product_candidate_2026_10_22_r6_active_role_integrity` /
  `nba_player_props_member_snapshot_candidate_2026_10_22_r6_active_role_integrity_disabled`
- sole writer:
  `nba_player_props_private_writer_2026_10_22_r5_active_role_integrity`

The authoritative write path remains the sole private NBA player-props writer
inside `prediction_pipeline:nba`. Stored locks and previously written private
rows remain immutable.

## Frozen inputs and chronology

The audit reuses the immutable 360-game archive stamped
`1e1f05debac2e9789d92be7c61045ec959d79f8d567e65259e0a21440a64ab09`.
It makes zero provider calls and zero database or member writes. The chronology
remains 50% development, 10% model selection, 10% reliability fitting, 10%
grade-policy selection, and 20% confirmation. Grade candidates may use only the
reliability-fit and grade-policy windows. The final confirmation block may be
opened once for the frozen candidate and may not be used to retune it.

The active-role projection repair and selected forecast candidates are frozen.
This audit may rank or grade their already selected exact-price side only; it
may not change a line, price, side, projection, probability distribution, or
market-reader decision.

## Candidate families

The recalibration will compare the inherited policy with pre-confirmation
selected, market-specific candidates built from:

- calibrated selected-side probability;
- raw model probability and standardized projection distance;
- target-book-excluded no-vig probability and exact-price expected value;
- target price implied probability;
- independent/final agreement, reference-book confirmation, role stability,
  back-to-back state, and Over/Under direction;
- within-slate relative rank, used only after absolute coherence, price, and
  data-quality requirements pass.

No candidate may use the settlement result, future availability, retrospective
starter identity, a target book inside its own fair reference, or a cross-book
synthetic move. Opening-only research cannot claim to validate intraday
movement, closing-line value, or lock-time market reading.

## Acceptance gates

A production candidate must satisfy all of the following on release-pure
confirmation evidence:

1. Every actionable has selected-side probability at least 50%, a complete
   exact price, nonnegative exact-price expected value, and target-book-excluded
   evidence.
2. The combined actionable tier has positive units/ROI and at least 55%
   direction accuracy. A Best Angle tier must outrank Leans in accuracy or
   exact-price return and have enough clustered support to be distinguishable.
3. Results are reported by market, grade, side, price band, slate date, player,
   and game cluster. Row count is not treated as an independent sample size.
4. Every demotion is paired with an eligible promotion search. Before/after
   promotions, demotions, market mix, actionable count, and board share are
   reported. The board may not be made to look better merely by hiding most
   opportunities.
5. Current-slate rehearsal retains every game and canonical prop, produces no
   projection/side contradiction, uses no non-positive projection, and changes
   only future unlocked private grades under a new release family.
6. Public/member activation remains disabled unless the frozen candidate,
   current-slate rehearsal, focused tests, full model-change gate, current-main
   integration safety, protected PR checks, production release readback, and
   next refresh/lock verification all pass.

If no honest policy clears these gates, the repaired private forecast remains
active for forward evidence while the member gate stays disabled. A failed
candidate may not be rescued with a quota, invented label, outcome-informed
threshold, or lock rewrite.

## Result

The broad market-specific search did not qualify. Its preconfirmation record
looked strong, but the frozen candidate fell to 41-51 (44.57%) and -18.97% ROI
on confirmation. Both the game- and player-clustered 95% ROI intervals were
negative. It is rejected and cannot become a release.

The exact-price-positive replacement also failed product safety. Requiring
every actionable to have nonnegative displayed EV reduced the confirmation
board from 147 to 58 plays and moved accuracy from 61.90% to 60.34%. Although
its ROI remained positive, this was an unacceptably flat board and its paired
cluster intervals did not establish an improvement. This confirms that EV is
a diagnostic, not a substitute for release-pure directional evidence.

One focused sensitivity candidate remains credible: preserve seven frozen
market policies and replace only the rebound one-per-slate selector with the
pooled policy selected before confirmation:

- signal: conservative raw-model/target-excluded market EV;
- established role: at least ten prior games and minutes standard deviation at
  most five;
- one rebound Lean per slate;
- selected-side probability at least 50%;
- candidate expected value at least -3%;
- exact price at least -130; and
- at least one target-excluded reference book.

This candidate is a re-ranking only. It does not change projections, sides,
probabilities, lines, prices, Best Angles, market arbitration, copy, layout,
refresh cadence, locks, or writer topology.

| Window | Frozen board | Rebound candidate | Board count |
|---|---:|---:|---:|
| reliability fit | 68-52, 56.67%, +3.26% ROI | 67-49, 57.76%, +5.39% ROI | 120 -> 116 |
| grade policy | 87-47, 64.93%, +18.82% ROI | 85-47, 64.39%, +17.91% ROI | 134 -> 132 |
| confirmation | 91-56, 61.90%, +13.05% ROI | 93-54, 63.27%, +15.53% ROI | 147 -> 147 |

Across the three chronological windows, the frozen board is 246-155 on 401
actionables (61.35%, +12.05% ROI). The focused candidate is 245-150 on 395
actionables (62.03%, +13.35% ROI). It therefore reduces total historical board
count by six (1.50%) while adding nine tested promotions and making paired
demotions. On confirmation specifically it promotes five rebound rows and
demotes five, so the current-window board does not flatten. Every one of the
eight markets retains actionables.

The candidate confirmation result remains positive under both resampling
units: game-clustered accuracy 55.06%-71.07% and ROI +0.53%-29.78%; player-
clustered accuracy 55.41%-70.67% and ROI +1.27%-29.08%. The paired improvement
interval overlaps zero, so this is evidence of a safer selector rather than a
claim of a statistically certain lift.

Because confirmation had already been opened for the failed broad candidate,
the rebound-only sensitivity is not represented as a new untouched test. It is
eligible for an explicitly approved private forward release, with a new
calibration/release family and unchanged public gate, but it is not itself
authorization to activate the member surface. No runtime, provider, database,
member, or locked-record state was changed by this audit.
