# UCL current-strength independent scoring prior — November 4, 2026

## Identified problem and resulting behavior

R21's common mode-one attack/defense priors pull clubs with only about2.83
weighted UCL matches toward the same high-scoring competition reference. Its
later fixed25% Elo correction is a different, less direct way of distinguishing
those clubs. The R2 cache was createdOctober28, but the mirrored public CSV's
last actual rating observation isSeptember1. The mirror's README explicitly
identifies post-June1,2025 ratings as a provisional continuation, not original
ClubElo snapshots. A fresh cache timestamp cannot make those ratings current.

R22 uses the original official dated daily ratings as a current-ability prior
inside the independent scoring fit. A current strong club and a current weak
club no longer start with the same expected attack/defense ratios merely because
both have sparse UCL history. Observed goals/xG can still contradict that prior.
The old local/mirror foundation and postfit25% correction are inactive in this
runtime; explicit legacy callers remain stamped R21. No sportsbook input,
forced side quota, new price/grade threshold or fitted model/book blend is added.

## One statistical model

For club i, A_i=exp(beta*(Elo_i-reference)/400)*u_i and
D_i=exp(-beta*(Elo_i-reference)/400)*v_i. Current-ability goal rates are
H*A_home*D_away and A*A_away*D_home. The residuals u/v retain mode-one Gamma
priors with the existing four-match goal exposure; changing the arbitrary Elo
reference changes no rate or precision. H/A and residuals are fit by the same
weighted opponent-adjusted Poisson likelihood.365-day decay and35% xG blend
remain unchanged. This is a static current-ability MAP model, not a claim that
current Elo was observed before historical matches, and not independent evidence
from overlapping results. Ratings do not contain live roster availability.

The coefficient0.6748444915670129 per400 Elo points comes from147 of185
regulation matches in the frozen2024-season cohort with genuinely original,
strictly earlier rating observations. Exact Salzburg/Sturm aliases restore14
pairs; missing teams are excluded rather than backfilled with today's ratings.
The147 exact inputs,38 missing pairs, original-source cutoff,
source-range hash and deterministic fit are in
`2026-11-04-ucl-strength-prior-fit.json`. Working-Poisson curvature standard
error0.120655 is not calibrated predictive confidence. The available sample is
selected and its rating differences range from−569.34 to600.08; extrapolation
and the static-history assumptions remain limitations. No yesterday outcome,
current betting result or candidate win-rate selection was used.

## Input lifecycle, score law and market reader

- Original source: https://clubelo.com/ ; parsed asOfDay2026-11-04. The
  raw page hash, actual club/slug/ratings and all36 current provider identities
  are frozen in `2026-11-04-ucl-official-strength-source.json` for reproducible
  mapping checks. This is an audit fixture, never a bundled live fallback.
- The bounded parser reads table cells, including malformed omitted row/cell
  closers, without executing scripts. Original source day, response-completion
  availability, exact URL, hash, finite positive ratings and club coverage are
  distinct. A request spanning kickoff cannot invent earlier knowledge.
- Source slugs disambiguate Bayern/Atlético/Sporting/Brugge/Bodø/Slovan and
  Liverpool England versus its Uruguay namesake. Every required current club
  must resolve; unknown historical clubs explicitly retain cohort priors.
- The existing foundation loader under the existing sport prediction lease
  makes one bounded free original-source request when its ET-day cache is
  absent. A same-day source observation is retained for the board day; a
  previous-day publication is retried after15minutes. No new paid provider,
  writer, cadence, timer or independent refresh is introduced. Failure preserves
  the existing last-known-good member snapshot, not fabricated current ratings.
- The3.8-goal ceiling did not bind any of today's nine R21 independent rates.
  It is removed prospectively with adaptive Poisson support (tail below1e-12),
  rather than silently clipping a larger rate or renormalizing only0..8 goals.
  Invalid Dixon–Coles parameter domains fail explicitly. Neutral sites remove
  both venue intercepts symmetrically; designated-away travel is not invented
  there. Neither fix alone explains today's R21 result directions.
- Weighted effective sample counts replace the falsely hardcoded0/0 evidence.
- The R21 relative multibook/full-pregame market reader is unchanged: source
  profile changes reweight the independent joint law once. Current sportsbook
  levels are context, not score targets. That one final law still supplies all
  scores, MR/DC/Total/BTTS probabilities, picks and exact-price grades. A shared
  decimal illustration stays distinct from unconditional goal means and an
  exact-score certainty claim.

## Same-input current-board consequence

The normal14:47:49Z member snapshot and11973 stored history observations were
read without a provider call or production write. Future observations after the
snapshot clock are excluded; the official strength observation14:33Z predates
that clock. Both versions use the same saved goals/xG and market evidence. This
is a functional comparison, not a historical forecast evaluation or win-rate
qualification. Detail: `2026-11-04-ucl-current-strength-board.json`.

| Market | Before | After |
| --- | --- | --- |
| Match result |9Watchlist |2Lean,7Watchlist |
| Total |3Lean,5Watchlist,1NoPlay |4Lean,5Watchlist |
| BTTS |8Lean,1Watchlist |6Lean,3Watchlist |

Three actionable promotions and two demotions, net+1; no forced replacement
promotion, no selected-side changes and no Best Angle manufacture. All9 totals
still favor Over;8 BTTSYes/1No. That is not a forecast of9 Overs occurring.
All36 selected prices and90 outcome prices are retained, no holds or publication
errors. Grade thresholds are unchanged. Decimal values below are the common
card/reader presentation (away–home), not necessarily unconditional means:

| Fixture | R21 score | R22 score | Selected MR probability | MR grade |
| --- | --- | --- | --- | --- |
| Real Madrid at AEK Athens | 2.49–1.41 | 3.08–1.06 | 61.8% → 78.2% | watchlist → watchlist |
| Liverpool at Fenerbahce | 2.52–1.35 | 2.86–1.11 | 63.1% → 73.5% | watchlist → lean |
| Real Betis at Borussia Dortmund | 1.42–2.15 | 1.36–2.16 | 53.7% → 55.2% | watchlist → watchlist |
| Napoli at FC Porto | 1.16–1.79 | 1.12–1.77 | 52.9% → 53.2% | watchlist → watchlist |
| Como at Lens | 2.00–1.40 | 2.00–1.40 | 48.0% → 51.5% | watchlist → watchlist |
| Club Brugge at PSV Eindhoven | 1.40–2.20 | 1.40–2.10 | 51.2% → 47.9% | watchlist → watchlist |
| Manchester City at RB Leipzig | 1.90–1.40 | 1.97–1.41 | 45.5% → 49.6% | watchlist → watchlist |
| Arsenal at Slavia Prague | 2.50–0.40 | 2.50–0.40 | 73.1% → 81.6% | watchlist → watchlist |
| Sabah FK at Viking FK | 1.47–2.52 | 1.12–2.84 | 60.7% → 73.0% | watchlist → lean |

## Locked records and verification

New source input is never backdated into an elapsed fixture. Historical R7
scaffolding is explicitly ineligible for any new R22 record, even if request
start preceded kickoff. The writer's release/calibration gate rejects it while
allowing a future game on the same board. The existing immutable reader accepts
an already-stored, internally consistent current-release lock without needing a
new post-kickoff writer proposal. This cannot excuse a contradictory fresh
proposal. Existing stored probability/score/pick/grade/price/stake/evidence fields
and legacy presentation semantics remain authoritative and unchanged.

New functional tests cover original-pair fit reproduction, all36 current names,
source malformed HTML/date/future/stale/conflicts/bounds, Liverpool/Slovan wrong
club rejection, source completion crossing kickoff, sparse-team differentiation,
Elo-reference invariance, contrary history, neutral designation symmetry,
weighted counts and adaptive tails. Paired existing market/grade tests exercise
promotion and demotion. DB tests cover no scaffolding writes, future coexistence,
current and legacy stored-reader precedence and fresh tuple mismatch rejection.
Independent source/math and lock/publication reviewers found no remaining
blocking defect after the completion-clock and stored-cohort corrections.

Required publication proof: focused UCL suite, full verify:model-change,
production webpack build, TypeScript/lint, clean fresh-main integration gate,
protected PR up-to-date checks and exact remote tree. After merge, verify the
production SHA, normal scheduled refresh, R22/R25/R15/R13/R24 member/record tuple,
source receipt/36 mappings, shared-law coherence, prices, cron and unchanged
locked baseline hashes. No extra refresh cycle is authorized by this change.

Rollback restores the complete R21/R24/R14/R12/R23 tuple from #987 while
preserving every lock made under either release. Functional correctness is
established by these checks; improved prediction accuracy must be assessed from
future results by release and lock timestamp.
