# NBA rating identity, verified availability, and exact-price coherence (r14)

Date: 2026-10-21

Status: accepted candidate for future unlocked NBA rows only. Publication still requires the full
model-change gate, latest-main integration safety, protected pull-request checks, and live proof.

## Combined release

- Model / prediction record: `nba_professional_unified_2026_10_21_r14_rating_identity_verified_availability`
- Market marriage: `nba_market_marriage_2026_10_21_r16_complete_team_rating_inputs`
- Grade policy: `nba_grade_policy_2026_10_21_r8_rating_identity_no_count_cap`
- Daily refresh: `nba_daily_refresh_schedule_2026_10_21_r13_current_slate_active_registry`
- Team-rating refresh: `nba_team_ratings_refresh_2026_10_21_r1_exact_team_identity_prior_recovery`

The release restores exact prior-season rating identity for `GS`/`GSW`, `WSH`/`WAS`,
`UTAH`/`UTA`, and `NO`/`NOP`; retains structured exact-game ESPN player evidence; removes only the
legacy generic injury-count confidence cap; and requires the coherent model probability to have
positive expected return at the exact selected price before any market can be Lean or Best Angle.

It adds no player-points formula, automatic score change, automatic fade, forced side, or new market
authority. The released professional market reader remains unchanged and remains the only validated
path that may alter the coherent score. Missing availability still lowers data quality and fails
closed. All complete-card locked snapshots retain exact stored precedence.

The r13 operational follow-up keeps the complete rolling-window health signal but isolates today's
snapshot readiness from defects that occur only on later dates in the seven-day window. Current-day
seed, rating, or line errors still block publication. A future-only thin quote group remains a
reported partial run and is retried normally, but it cannot suppress an otherwise complete current
slate. It also scopes prior-season completeness to the exact 30-club registry so a retained legacy
team row cannot trigger a redundant provider fetch forever. This changes no projection, probability,
side, grade, price, stake, lock, or tracking row.

## Strict same-input current-board audit

The read-only audit at `2026-10-21T15:08:53.723Z` used one shared exact-game injury resolver for the
legacy and candidate paths and the same 11-game / 33-market board:

- verified two-team reports: 11/11; exact reported players: 62;
- prior-season provider rows recovered: 30; fallback games: 4 to 0;
- score changes: 0; side changes: 0; probability changes: 0; selected-price changes: 0;
- actionables: 6 to 7; promotions: 2; demotions: 1; within-actionable changes: 1;
- negative-model-EV candidate actionables: 0; negative-model-EV promotions: 0.

Exact changes were MIL Moneyline Watchlist to Best Angle, MEM Moneyline Watchlist to Lean, CHA
Moneyline Lean to Best Angle, and HOU Moneyline at -365 Lean to Watchlist. The Houston demotion is
required because the 78.28% model probability is slightly below break-even at -365; a calibrated
confidence label cannot override the probability distribution that owns the prediction.

## Rejection and rollback

Reject before publication if any required test fails, if a locked payload changes, if the live board
differs from the reviewed result, or if the sole writer / `prediction_pipeline:nba` lease contract
changes. After publication, roll future unlocked output back to r12/r15/r6 plus refresh r10 if exact
identity, availability provenance, price coherence, or live release identity fails. Never rewrite or
reconstruct an existing locked card.
