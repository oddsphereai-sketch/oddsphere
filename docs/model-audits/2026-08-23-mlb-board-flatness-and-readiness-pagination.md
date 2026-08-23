# MLB board-flatness and readiness pagination audit

Date: 2026-08-23

Status: operational repair candidate. No prediction, probability, side, grade,
stake, provider call, writer, lock, tracking, or model-release behavior changes.

## Production state

The audit was read-only. It did not invoke a cron, provider, prediction writer,
repair path, or database mutation.

At 2026-08-23T16:14Z production contained exactly 45 current MLB records for
15 games: 15 Moneyline, 15 Total, and 15 First Inning. All rows carried the
current r67/v27/v55/v45 release family and the correct active market-specific
probability head. All 45 rows were high quality and unlocked at the observation
time.

Current record-level grades were:

- Moneyline: one Best Angle, four Leans, ten No Plays;
- Total: one Best Angle, two Leans, twelve non-actions;
- First Inning: three Leans, nine Toss-Ups, two explicit Held rows, and one
  additional non-action.

That is 11 actionable records and 34 non-actions. The current Moneyline count
was five actions, the same count as the first coherent morning reconstruction
at 08:15Z. The board temporarily reached seven Moneyline actions at 14:15Z.
Between 14:15Z and 16:15Z, ATH at HOU and STL at PHI demoted from Lean to No
Play, with no contemporaneous Moneyline promotion:

- HOU moved from about 62.0% to 59.9%, fell just below the r67 60% strong-winner
  floor, and had 1.88 percentage points of same-book movement against the pick
  plus the retained signed SharpAPI resistance warning.
- PHI remained a strong projected winner at 66.2%, but the evaluated Saba quote
  had moved 1.47 percentage points against the pick and the signed SharpAPI
  resistance warning remained present. Adverse evaluated-book movement is an
  explicit r67 blocker.

Other visible morning-to-current Moneyline changes were also attributable to
stored inputs rather than a release or ingestion regression: NYY had a 2.39pp
adverse same-book move plus signed resistance; MIA was 59.3%, below the r67
60% exception floor, with signed resistance; SD had a 0.69pp adverse move; and
MIL's probability declined from 55.5% to 52.7% while its current market was
thin enough to fail the normal-completeness contract. ARI remained Best Angle,
while CHC, CLE, TEX, and BOS remained Leans.

The release-owned read-only r67 replay produced 11 current actions and 11
same-input candidate actions, with zero promotions, zero demotions, and zero
observed changes. CLE at COL exercised the intended r67 path: 62.1%, bounded
price, neutral evaluated-book movement, signed resistance retained as context,
and a Lean capped by `ml_strong_winner_resistance_lean_v1_2026_08_22`.

## Data and pipeline health

- Latest completed leased slate cycle at 16:05Z succeeded: 2,980 records
  updated, 82 provider calls, no error.
- The three preceding hourly cycles also succeeded. Earlier partial cycles
  were limited to optional SharpAPI history recovery or an upstream 503.
- Current records contained authentic SharpAPI and Playbook Moneyline/Total
  split pairs for all 15 games. The data-health monitor reported 15/15 current
  price, probability, movement, consensus, Sharp, and Market Read coverage for
  Moneyline and Total.
- The 15:05Z season refresh wrote 539 batting and 479 pitching rows; a later
  batting refresh wrote 540 rows. All 30 probable starters had usable current
  or permitted prior-season pitching evidence in the readiness audit.
- A bounded read-only availability verification at 16:24Z resolved all 15
  matchups from the official MLB 40-man injury fallback with
  `official_fallback_current` health and current freshness. The stale or
  implausible Playbook report was not presented as current availability.
- Seven later games correctly had lineups not yet announced at the audit time.
  This was a provisional context state, not a missing-ingestion finding.
- The MLB data-health monitor reported zero findings and normal-reader display
  safe. MLB tracking refreshes were successful.

## Confirmed operational defect

The readiness service loaded every slate line in one unpaginated PostgREST
query. Today's slate had 1,217 current `lines` rows, exceeding the default
1,000-row response cap. The truncated result falsely reported zero full-game
market rows for PIT at LAD, CIN at ARI, and ATL at MIL, and zero First Inning
market rows for the last two games, even though the database held fresh rows.

The candidate range-paginates the read in stable `id` order and chunks game
identities. The same read-only production audit then reported all 15 games
ready for both V2.2 and FI V2, with the exact late-game market counts restored.
This prevents false repair eligibility and unnecessary repair attempts. It does
not enter the prediction writer and therefore has zero grade-board impact:
zero promotions, zero demotions, and no probability or price change.

Rollback is the prior single-query readiness read.
