# Private CBB r22 opportunity-weighted factor test: predeclaration

Scope: the unpublished men's college basketball r2 score correction only.
Production CBB stays disabled. This research may replace only score-feature
indices 7–14 (the four matchup-factor differences and sums) in a private
replay; it may not change the base ratings, other features, final-score
coherence, market probabilities, grades, stake, writer, reader, cron or locks.
`cbb_candidate_2026_10_28_r2_score_precision` is the frozen comparison.

The specific hypothesis follows the r21 sensitivity result: raw Four Factors
have incremental predictive value, but the current implementation averages
each game's rate with equal weight. A 40-attempt game and a 70-attempt game
therefore contribute equally to a team's eFG estimate. This test pools actual
numerators and opportunity denominators from completed prior game boxes.
For each team, use its pooled offensive rate and opponents' pooled allowed
rate; the matchup formula, neutral fallback, and feature scaling remain the
same as r2. The four denominators are field-goal attempts for eFG and FT rate,
estimated possessions for turnover rate, and offensive-rebound opportunities
`OREB + opponent DREB` for ORB rate. Only exact same-game accepted box pairs
may enter. The six-hour post-start lag remains the pregame cutoff.

Two variants are fixed now: (1) pooled opportunities with equal game weight,
and (2) pooled opportunities with the same 90-day exponential recency weight
used by r2 ratings. No league-wide tuning or opponent-adjustment ridge is
added. Each variant's correction coefficients fit on 2023 labels, then the
exact same 2024 game IDs are compared with r2 for winner correctness, margin
and Total MAE, Brier/log loss, paired corrected/harmed winners and prediction
deltas. The variants are also refit through 2024 and replayed on already-opened
2025 only as a stability diagnostic, never an untouched holdout.

The candidate qualifies for *further* exact-quote ML/Spread/Total analysis
only if both MAEs, winners and Brier improve on 2024 without a material 2025
directional regression. That is a research gate, not permission to activate.
For production consideration, a new immutable release, genuinely new
chronological evidence, all-market exact-line record/units, score coherence,
play-grade board impact and standard model-change safety checks remain
mandatory. Any variant that merely reduces an easy subset or changes the
denominator of evaluation is rejected.

Source data are the timestamped `games`, `boxes` and `venues` local archives
for 2022–25 plus the cached r2 2023/24 feature arrays. The audit must verify
source-game and feature regeneration parity, strict as-of filtering, source
hashes, a clean committed source SHA, and zero production writes. Both 2024
and 2025 have already been opened and cannot support an unbiased future win
claim.
