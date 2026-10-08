# NFL player props external-method research synthesis

Date: 2026-10-08
Status: implementation input; no production behavior change

## Why this review exists

The released NFL player-props model has been researched mainly by testing variants of its
existing historical player/team feature set. That is necessary but incomplete. This review
starts from published NFL performance models, public source documentation, and tracking-based
research, then maps those methods to OddSphere's supported prop markets and live data contract.

There is no single accepted academic "sportsbook player-prop model." The strongest public work
models the components that create a prop result: participation, opportunity, play context,
player skill over expectation, matchup/defender effects, and the outcome distribution. The
appropriate OddSphere architecture is therefore a market-specific composition of validated
submodels, not one generic regression and not a market-implied projection.

## Primary sources and implementation consequences

| External work | Supported finding | OddSphere consequence |
| --- | --- | --- |
| NFL Next Gen Stats technology and data dictionary: <https://operations.nfl.com/game-operations-logistics/technology/performance-tracking-data-next-gen-stats> and <https://nflreadr.nflverse.com/articles/dictionary_nextgen_stats.html> | Tracking-derived CPOE, intended air yards, receiver cushion/separation, expected YAC, expected rushing yards, box-count exposure, time to throw, and time to line of scrimmage distinguish opportunity quality from execution. | Add shifted player skill-over-expectation features. Do not represent WR/CB or OL/DL matchup quality with a single unsupported grade. |
| nflfastR EP/WP/CP/xYAC/xPass model documentation: <https://opensourcefootball.com/posts/2020-09-28-nflfastr-ep-wp-and-cp-models/> | Pass probability, completion probability, and YAC are separate conditional problems driven by down, distance, field position, score/time state, air yards, location, pressure, and environment. Validation holds out seasons. | Forecast team play/pass budgets before QB attempts; forecast completions and yards conditionally; add leakage-safe neutral-state xPass/pass-over-expected, pace, pressure, air-yard, and xYAC histories. |
| ffopportunity expected-points model: <https://github.com/ffverse/ffopportunity> | Opportunity value and player results over expectation should be separated; its public implementation trains play-level boosted models on nflverse data. | Build volume/share first and efficiency second. Retain player-specific efficiency only with partial pooling and adequate opportunities. |
| FTN Data charting via nflverse: <https://nflreadr.nflverse.com/articles/dictionary_ftn_charting.html> | Public play-level charting from 2022 onward supplies defenders in the box, backfield count, motion, play action, screens, RPO, blitzers/pass rushers, catchable/contested/drop flags, quarterback movement, and read progression. | Add strictly shifted team, opponent, passer, rusher, and receiver context. This is the public bridge between ordinary play-by-play and unavailable full tracking assignments. Attribute the source to FTN Data via nflverse. |
| Route Identification in the NFL: <https://arxiv.org/abs/1908.02423> | Receiver deployment and route family can be learned from tracking trajectories rather than inferred from position labels. | Treat routes and alignment as the desired receiving-role source. Until a live/backfillable route feed exists, use target share, air-yard share, snaps, depth, and NGS separation only as partial proxies. |
| NFL Ghosts: <https://arxiv.org/abs/2406.17220> | Defender positioning is a conditional distribution problem; nearest-defender and tracking context explain YAC/coverage outcomes, while attribution remains difficult. | Do not ship a crude WR-versus-CB coefficient. Assignment-level coverage requires tracking/route data and partial pooling; current position-allowance features remain team/position context only. |
| NFL Big Data Bowl rushing work: <https://operations.nfl.com/media/4207/bdb_pash_powell.pdf>, <https://edge-operations.nfl.com/media/4206/bdb_davis.pdf>, and <https://operations.nfl.com/media/4204/bdb_ploenzke.pdf> | Rush value depends on the full spatial state, defenders in the box, blocker/defender geometry, runner direction/speed, and a heavy-tailed yardage distribution. Raw yards per carry is unstable. | Keep carries and yards as separate models. Use shifted expected yards, RYOE, box exposure, time to LOS, and offensive-line/pressure proxies; use a heavy-tailed conditional distribution for yards. |
| Princeton public-data projection study: <https://theses-dissertations.princeton.edu/entities/publication/d6981488-f30c-47ce-8f06-b6c3e98f2578> | Position-specific boosted models and quantile intervals can beat a published projection baseline, but much apparent gain comes from predicting whether a player plays; betting variables can dominate feature gain. | Separate participation from conditional performance, report played-only error, and evaluate quantiles. Exclude all prop-market variables from the independent model even if they improve a blended benchmark. |
| nflverse update/availability contract: <https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html> | PBP/player/team stats update after game days; NGS updates nightly; FTN charting, snap counts, and PFR advanced stats update during the week; depth charts and injuries update daily. Participation data from 2023 onward is delayed until after the postseason. | The first improvement does not require buying a commercial feed. A bounded, checksum-pinned research cache can test NGS, FTN, snap, pressure, depth, and injury data now. Production ingestion remains a later gated change through the existing writer, never a new per-card loop. |

## Prop-family architecture implied by the evidence

### Passing Attempts

1. Forecast team offensive plays from recent neutral-state pace, possession/play history, and
   opponent drive/play allowance.
2. Forecast team dropbacks from neutral-state xPass, pass over expectation, down/distance mix,
   score-state tendencies, pressure/sack environment, and verified weather/roof.
3. Allocate the passing workload to the expected quarterback using pregame availability/depth
   and prior snap/share history.

### Passing Completions and Passing Yards

1. Consume the same latent attempts forecast.
2. Estimate completion rate from shifted CPOE/expected completion, target depth, pressure,
   receiver drop/on-target context, and opponent pass-defense context.
3. Estimate yards per attempt as completed air yards plus expected/above-expected YAC, conditioned
   on pressure, play action/RPO, and opponent position allowance.
4. Enforce completions no greater than attempts and keep all three QB props coherent.

### Rushing Attempts and Rushing Yards

1. Forecast team rush budget separately from player carry share.
2. Allocate carries using recent snap share, carry share, depth/availability, quarterback scramble
   share, and vacated-workload redistribution.
3. Estimate yards per carry from expected rush yards, RYOE per attempt, box exposure, time to LOS,
   explosive rate, and opponent front/rush context.
4. Use a count distribution for attempts and a role/volume-conditioned heavy-tailed distribution
   for yards.

### Receptions and Receiving Yards

1. Forecast team targets from the passing workload.
2. Allocate targets using prior snap share, target share, air-yard share/WOPR, position/depth,
   availability, and vacated-workload redistribution.
3. Estimate catch rate from target depth, separation/cushion, expected completion, and opponent
   position context.
4. Estimate receiving yards from targets, catch probability, air-yard depth, and expected/YAC over
   expectation. Routes and coverage assignments remain an explicit missing-data layer, not an
   invented coefficient.

### Anytime Touchdown

The existing touchdown-specific model remains separate. A later candidate should use red-zone and
goal-line opportunity, team scoring opportunity, route/carry participation, and a hurdle/event
probability model. It must not be folded into the ordinary continuous/count tournament.

## Source-to-feature boundary

The market-free independent candidate may consume only information available before the prediction
timestamp. Historical postgame data is shifted by at least one completed game. Current injury and
depth evidence must carry a source timestamp at or before the replay lock. Prop lines, prop prices,
consensus, opening/current movement, and final outcomes are prohibited model features.

Market reading stays in a separately evaluated observer. It may later confirm, adjust, or flip a
forecast only if same-book/same-line, target-book-excluded, source-specific chronological evidence
passes its own market/position gate. Missing movement evidence is neutral.

## Immediate research plan

1. Cache and checksum the public NGS, FTN charting, and PFR advanced weekly sources without adding a production
   provider call.
2. Build shifted xPass/pace, pressure/play-design, and NGS skill-over-expectation features.
3. Test each feature family as an ablation against the exact released point heads.
4. Select on 2024, confirm on 2025, and open the 2026 Weeks 1-4 replay only after the candidate is
   frozen. Prior years train the model but are not presented as this season's product result.
5. Report all supported prop markets separately, including played-only error, directional accuracy
   at the locked representative line, calibration/distribution metrics, and clustered uncertainty.
6. Keep every accepted change in shadow mode until live inference can populate the same feature
   contract and the complete model-change safety gates pass.
