# NFL player-props historical feature foundation r2

Date: 2026-08-20

## Decision

Accept `nfl_player_props_historical_features_2016_2025_2026_08_20_r1` as a local,
checksum-pinned projection-research substrate. It remains `modelingReady: false` and cannot create
probabilities, prices, grades, stakes, tracking rows, or a member product.

- Schema: `nfl_player_props_historical_schema_2026_08_20_r1`
- Source cache: `nfl_real_model_source_cache_2016_2025_2026_08_19_r1`
- Shared contract: `lib/services/football/nflPlayerPropsHistoricalContract.json`
- Contract gate: `lib/services/football/nflPlayerPropsHistoricalContract.ts`
- Authoritative local builder: `scripts/operator/build_nfl_player_props_history.py`

## Built evidence

The real 2016–2025 regular-season build produced:

- 138,860 player-team-game rows;
- all 2,639 regular-season games;
- 3,104 unique GSIS player identities;
- 109 model-feature columns and 143 total columns;
- 60,881 participant labels;
- 99.217% play-by-play outcome-player coverage on the matching weekly roster;
- zero duplicate row identities and zero duplicate player-weeks;
- 2.158% mean null rate across model features, principally first-history rows;
- one checksum-pinned ignored parquet with SHA-256
  `ffcba9cf42247eecef02ba3bf58e9e17e583ee52ec5ce8e848c321796dba5c19`.

Rows cover rostered QB, RB, FB, WR, and TE players. Outcome labels are passing attempts,
completions and yards; rushing attempts and yards; targets, receptions and receiving yards;
offensive snaps/share; participation; and player opportunity shares.

## Leakage boundary

Every model-feature column is computed from completed history only:

- player lag-one, rolling-three, rolling-five, exponentially weighted, and current-season averages
  are shifted before calculation;
- player pass-attempt, rush-attempt, target, snap, and participation shares are shifted;
- team play volume and opportunity features are shifted by one completed team game;
- opponent allowed features are shifted by one completed defensive team game;
- current-game outcomes, snaps, participation, and shares are outcome-only columns and absent from
  the manifest's `modelFeatureColumns`;
- regular season is isolated from preseason and postseason.

Changing a future outcome cannot alter that row's prior feature vector. Focused synthetic tests,
actual duplicate audits, the shared manifest gate, and TypeScript compilation pass.

## Known limitations

This release does not claim true decision-time feature availability. nflverse weekly roster and
injury records do not include reliable source-publication timestamps. They are retained as
`unstampedContextColumns`, excluded from the model-feature list, and stamped with
`CURRENT_WEEK_ROSTER_AND_INJURY_CONTEXT_LACKS_SOURCE_TIMESTAMPS`.

The player population is a weekly roster proxy, not a historical sportsbook-offer population.
Nonparticipants remain visible so a later availability/role stage can be modeled rather than
conditioning silently on players who happened to play. Injury-report coverage is the fraction of
all roster candidates listed on a report, not missing-data coverage; it is therefore expected to
be low.

Historical exact prop lines, offered prices, observation times, and closes are absent. This data
can support baseline outcome-distribution research, but cannot establish calibration at sportsbook
thresholds, closing-line value, expected value, or profitability.

## Next gate

The next release may fit baseline components in a chronological tournament:

1. participation/role probability;
2. team pass/rush opportunity;
3. player attempt/carry/target allocation;
4. conditional completions and yardage;
5. a joint simulated outcome distribution.

It must compare simple empirical, Poisson/negative-binomial, beta-binomial, and regularized
tree/linear candidates using expanding weekly folds. The 2025 season must remain an untouched
evaluation period during architecture selection. Results must include MAE, CRPS or distributional
loss, interval coverage, tail calibration, and player/game-clustered uncertainty. No market edge
or grade evaluation is permitted until timestamped historical or forward-shadow prices exist.

## Board impact and rollback

Board impact is zero. No production code path, provider schedule, database, route, reader, grade,
stake, or tracking record changed. Rollback removes the isolated contract, builder, tests, ignored
artifact, audit entry, and registry lines.
