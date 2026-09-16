# NFL injury pagination and Player Props recovery result

Date: 2026-09-16

## Root cause and repair

The Week 2 BALLDONTLIE injury catalog required five pages, while the shared NFL availability collector allowed only four. The collector correctly refused to return a truncated response, but that made all 16 games appear to have unavailable injury evidence and caused the dependent Player Props stage to abort the entire slate.

The repair raises the bounded weekly injury ceiling to eight pages and uses that constant in the collector, NFL writer telemetry, and Player Props context budget. The Player Props reader now advances with the shared Tuesday-Eastern NFL week selector. The shared-evidence adapter excludes only an individually incomplete game and records the exact reason; complete games continue through the existing atomic snapshot reconciliation. Identity disagreement still fails closed, and a slate with zero eligible games still aborts and preserves the last coherent snapshot.

No forecast equation, probability calibration, grade threshold, side policy, stake, lock, settlement, or tracking rule changed. The release bump exists because restored injury inputs can legitimately change an unlocked grade and the release boundary must remain auditable.

## Read-only current-slate evidence

At the current Week 2 input capture, the repaired NFL Daily Edge writer collected 16 games and completed all 48 market evaluations with zero held games. Candidate counts are **1 Best Angle / 2 Leans / 11 Watchlists / 34 No Plays**. The same current-input run under the four-page failure state was **1 / 1 / 8 / 38**, so the count-level recovery is one additional Lean, three additional Watchlists, and four fewer No Plays. No demotion rule exists or was introduced; the movement is restored data availability rather than quota promotion. `sharpapi_splits_unavailable` remains a truthful independent health finding and does not block the slate.

At `2026-09-16T15:51:43.611Z`, a direct no-write NFL Player Props replay collected all 16 games and 22,406 observations. All 16 games had injury and main-market context, with zero excluded games and zero context health holds. It produced 10,085 exact offers, 443 feature rows, 347 score-eligible feature rows, and 1,260 completed or operationally classified member outcomes:

- 11 Best Angles
- 33 Leans
- 161 Watchlists
- 920 No Plays
- 135 Held operational exceptions reserved by the existing contract for timestamped role/player-identity ambiguity

The 44 actionable rows and every Held classification arise from the pre-existing Player Props runtime rules. The repair creates no new tier rule and does not convert missing game evidence into a normal model evaluation. Optional Sharp props pagination still reports its existing bounded-truncation health diagnostic; BALLDONTLIE supplies the primary catalog.

## UI and MLB sharp-book findings

NFL and MLB Player Props now use one American-odds range utility and the same Any odds, Common range, Plus money, and custom minimum/maximum behavior. Filtering is client-side over the already published exact price and cannot alter tracking or publication.

A same-day MLB sharp-book audit found complete public consensus coverage for all 15 games, but current named-book handle/ticket splits from Circa and DraftKings for only CWS at CLE. Exact-event history probes for the other games returned no rows. BetMGM returned ticket percentages but null handle percentages. Production already polls the source on the established 15-minute refresh and includes bounded history recovery, so verified named-book rows will populate when supplied. Consensus percentages and sportsbook prices are not relabeled as sharp-book splits.

## Release set and rollback

Daily Edge advances to model/calibration `r13`, decision/grade `r19`, member `r16`, collector `r7`, writer `r30`, fixture `r22`, and compact snapshot `r14`, all stamped `injury_pagination`. Player Props advances to model/calibration `r8`, decision `r11`, runtime `r12`, board `r15`, member `r18`, writer `r21`, tracking `r11`, and inference context `r4`.

Rollback is the preceding complete September 16 sharp-contract Daily Edge family and the preceding September 7/3 Player Props family. Do not rewrite locked or settled records. Production success additionally requires a natural leased writer cycle, current Week 2 release coherence, a nonempty member reader, and responsive NFL/MLB props filters.
