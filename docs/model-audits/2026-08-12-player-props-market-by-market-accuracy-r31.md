# MLB player props market-by-market accuracy release r31

Date: 2026-08-12

## Scope and ownership

- Sport: MLB player props.
- Active predecessor: `mlb_props_2026_08_12_r30`.
- Candidate: `mlb_props_2026_08_12_r31`.
- Authoritative writer remains `/api/cron/mlb-player-props-refresh` through
  `refreshMlbPropsBoard` and the existing sport-scoped `prediction_pipeline`
  lease. No writer, cron, refresh path, provider call, or lock policy was added.
- Probability behavior changes only for promoted Doubles Under and Batter
  Strikeouts Over rows. The Home Runs probability model remains unchanged; its
  losing actionable Over promotion is removed and the model read remains a
  visible non-actionable Watchlist.

## Frozen evidence and chronology

The audit collapsed 44,929 immutable public-display T-60 tracking rows into
43,244 player/game/market/line observations. It joined 629 official MLB player
game-log identities and 40,669 exact locked-snapshot context rows. Context
included lineup/order, home/away, opponent rates, pitch arsenal, batter versus
pitch-type matchup, direct matchup, park, and weather. All official logs were
strictly earlier than the slate date.

- Discovery: through 2026-07-23.
- Validation: 2026-07-24 through 2026-07-31.
- Holdout: 2026-08-01 through 2026-08-11.
- Final uncertainty checks used date-block bootstrap samples.

Sixteen settled markets had enough rows to enter the tournament: batter
doubles, hits, H+R+RBI, home runs, RBI, runs, singles, stolen bases,
strikeouts, total bases, walks, and pitcher earned runs, hits allowed, outs,
strikeouts, and walks. Batter triples, first home run, and pitcher record-a-win
did not have defensible chronological settled coverage and remain non-promoted.

For each covered market the tournament compared the sportsbook probability,
the current probability, recent-form survival/Poisson blends, independent
regularized context models, and market-plus regularized context models. No
blanket rich-context probability model cleared the production gate against
both the current model and sportsbook baseline. Those probability challengers
remain rejected; this release uses only the two action-selection sleeves below.

## Promoted accuracy sleeves

### Batter Doubles Under 0.5

The production formula is the auditable `survival_w80_p2_m0.25` finalist:

1. Use up to 80 prior-only official doubles outcomes.
2. Shrink empirical Under survival with two neutral prior games.
3. Blend 75% empirical probability with 25% target-market probability.
4. Require final Under probability at least 54%, at least one percentage point
   above the market, nonnegative locked-price EV, a playable price, full
   existing data/lineup/freshness gates, and the best offer per player/game/line.

It was 66-14 (82.5%, +0.649 units, +0.8% flat one-unit ROI) on validation and
142-32 (81.6%, +0.390 units, +0.2% ROI) on holdout. The ROI is thin because the
median holdout price was -450; the reason for promotion is the user's stated
accuracy-first objective and the stable win rate, not an ROI claim. The
date-block bootstrap probability of a hit rate above 50% was 100%; profitability
was 52.18%.

### Batter Strikeouts Over 0.5

1. Use up to 80 prior-only official batter strikeout outcomes.
2. Shrink empirical Over survival with 20 neutral prior games.
3. Blend 50% empirical probability with 50% target-market probability.
4. Require exactly a 0.5 line, final Over probability at least 60%, at least one
   percentage point above the market, nonnegative locked-price EV, a playable
   price, full existing data/lineup/freshness gates, and the best offer per
   player/game/line.

It was 12-6 (66.7%, +0.828 units, +4.6% ROI) on validation and 27-14 (65.9%,
+0.970 units, +2.4% ROI) on holdout. Date-block bootstrap support was 91.8% for
a hit rate above 50% and 52.88% for profitability. This is an accuracy sleeve,
not a broad replacement for the batter-strikeout probability head.

## Home Runs correction

The existing Home Runs probability head beat the sportsbook probability on the
August holdout (Brier 0.104581 versus 0.105410; log loss 0.361067 versus
0.364509) and remains active. Adding lineup, recent HR rate, pitch-matchup,
direct-matchup, park, and weather fields through a strongly regularized residual
fit was worse (Brier 0.105416; log loss 0.364641), so that context model was
rejected.

The old actionable HR Over selector was separately harmful: 7-49 (-18.1% ROI)
on validation and 8-67 (-29.9% ROI) on holdout. Its threshold-search replacement
also failed the holdout (0-8). R31 therefore removes actionable HR Over
promotion while preserving the probability, card, model-pick label, research,
and Watchlist visibility.

## Paired board impact

The 2026-08-12 no-write live rebuild was publishable with 5,872 rows, zero
validation errors, 30,313,864 JSON bytes, and 1,517,628 gzip bytes. Against the
stored r30 board, provider refresh churn was separated from rows carrying the
new immutable reason codes.

- Intended promotions: 10 Doubles Unders and 2 Batter Strikeouts Overs.
- Intended demotions: 6 Home Run Overs.
- Intended net actionable change: +6.
- The broad stored-versus-refreshed comparison retained 121 actionables,
  promoted 22, demoted 11, and netted +11; changes outside the 12 promoted and
  six demoted model rows were lineup/research/provider refresh differences.

No missing-data, stale-price, lineup, research, best-price, publication, or
locking gate is bypassed. Stakes remain 0.25 units.

## Verification and rollback

- `npm run test:mlb-props-engine`: 378 passed, 0 failed.
- `npm run verify:model-change`: passed.
- No-write current-slate rebuild: publishable, zero validation errors.
- Rollback release: `mlb_props_2026_08_12_r30`.

Rollback if the member reader shows a mixed release, the board changes outside
the documented sleeves, snapshot size/publication fails, locked rows mutate, or
the first prospective locks disagree with the r31 reason-code attribution.
