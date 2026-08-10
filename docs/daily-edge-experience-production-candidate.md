# Daily Edge experience production candidate

## Product position

Daily Edge remains the primary OddSphere product. The experience should answer one question quickly—what does OddSphere make of this market?—then let a member inspect the price, public consensus, sharp-book activity, matchup evidence, recent results, and model trust without leaving the game reader.

Player Props, Tracking, My Bets, and Account remain separate products in the existing OddSphere application shell. The Daily Edge reader is not a Player Props clone.

## Information hierarchy

1. Sport and slate context.
2. Selected game and selected market.
3. Quick Read: pick, price, grade, probability, edge, and the clearest risk.
4. OddSphere Market Pulse: price movement first, then separate Public Consensus and Sharp Book Splits.
5. Market-relevant key stats with explicit team/player identity and directional advantage.
6. Optional deep analysis: case, market, matchup, recent trends, and model/trust.
7. Market-first slate board for scanning Moneyline, Totals, and First Inning/Spread.

## Responsive behavior contract

- Desktop and tablet keep the selected reader above the slate board; choosing a board card or market returns the reader to view.
- Phone widths follow the existing Daily Edge behavior: the inline reader is hidden, the slate board is primary, and tapping a card or market opens the selected read in a scroll-locked full-screen sheet.
- The phone sheet keeps close, previous/next game navigation, and all three prediction categories available without returning to the board.
- The same redesigned Quick Read, Market Intelligence, Key Stats, and optional deep analysis render in both surfaces; responsive layout changes must not change data meaning or availability.

## Conversion-focused advantages

- One decision layer before the research layer; no information dump is required to understand the read.
- Moneyline and Total receive the same first-class treatment as First Inning.
- Public consensus and sharp-book splits stay visibly separate and are resolved by OddSphere instead of being presented as unexplained percentages.
- The selected market has an observed price trail, current price, market probability, model probability, and an explicit market-support/conflict interpretation.
- Recent results are labeled as context, not claimed as proof.
- MLB First Inning separates team L5/L10 outcomes from named-starter L5/L10 opening-frame context; starter rows are explicitly team-runs-allowed in games started, not pitcher earned-run attribution.
- WNBA can place a sourced availability report beside a major market move, including status, reason, and report time, without silently changing the displayed model output or claiming causation from timing alone.
- MLB can attach the exact two team reports from Playbook after deterministic
  team normalization. It exposes player status and reason as context only;
  report data never changes a prediction, grade, or stake.
- The WNBA availability summary stays compact; player-level statuses remain one disclosure away so the report does not displace the market read.
- When the primary reader price and the named-book movement endpoint differ, both values and their separate source roles are stated instead of silently mixing them.
- Sports whose representative snapshot lacks formatted driver rows show core model output (projected score, total, margin, and market number) rather than an unfinished empty panel; those values are labeled as snapshot context, not invented drivers.
- All supplied key-stat rows remain available, while deeper cross-market and pitcher/matchup detail is one action away.
- Board cards can be focused by market and grade, and every market pill opens that exact market in the reader.
- Reader state is URL-addressable through `sport`, `game`, and `market` parameters.
- Private QA can request a stored representative slate with an explicit `date=YYYY-MM-DD` review link, allowing offseason NBA, NHL, and World Cup readers to receive visual approval without fabricating sample data. Normal model-pill switching replaces that historical date with the active model's explicit current slate date, so prefetched representative data cannot be reused and an available offseason model correctly shows “No games today” rather than appearing active with older games.
- Game and market changes update client state and the URL without reloading the slate; only sport changes request a different sport snapshot.

## Data truth contract

- The live reader and redesigned candidate share one market-priority and sport-readiness registry; the candidate does not maintain a parallel ranking or availability list.
- Available Daily Edge model paths are MLB, NBA, WNBA, NHL, and World Cup. NFL, CBB, CFB, and UCL remain planned until they have dedicated Daily Edge response adapters.
- The preview calls the authoritative Daily Edge read adapter through the same
  30-second warm response path used by the member board. It does not run a
  writer, refresh job, or prediction recomputation, and switching sports does
  not force a second uncached slate build.
- Local development can open the candidate directly. Production-mode and Vercel preview builds require the server-only `DAILY_EDGE_EXPERIENCE_PREVIEW_ENABLED=true` flag, and the route remains behind the normal member/beta session gate.
- A private staging deployment can set `DAILY_EDGE_EXPERIENCE_CANDIDATE_ENABLED=true` to render the candidate underneath the real `/lab/daily-edge` URL. The browser URL, member authentication, and surrounding product navigation remain unchanged; the switch defaults off and does not affect other products.
- Forecast boards publish on their scheduled cadence; the browser may check more frequently without implying a model rerun.
- Lock windows are checked every five minutes. Lineup and split feeds have their own refresh schedules.
- A first-published price is labeled `Published` only when its stored side matches the displayed pick side.
- Odds-price movement is compared only within one named sportsbook and selected side. When a total/spread number changes, every stop displays both the point line and price so the main line move is not hidden behind juice.
- If a continuous same-book trail cannot be verified, the reader shows the current endpoint for context and withholds a supporting/resisting directional claim.
- Locked MLB trails retain the sportsbook captured in the authoritative lock
  snapshot. The terminal lock price is never attached to an unrelated book's
  opener merely to keep a directional label visible.
- WNBA same-book trails terminate at the latest observation. A completed trail
  cannot loop back to its opener, and a separately locked display price remains
  labeled separately when it differs from the named-book movement endpoint.
- WNBA availability reports are fetched read-only from ESPN, cached for 15 minutes, and fail closed. An unavailable report is never interpreted as a healthy roster.
- MLB availability reports are fetched read-only from Playbook, cached for 15
  minutes, limited to a 2.5-second supplementary-context timeout, and attached
  only when both matchup teams and the report date match. Failure omits the
  report rather than blocking or crashing the reader.
- MLB and WNBA availability use a protected supplementary endpoint after the
  core reader renders. Their provider calls are not on the sport-switch
  critical path, and an in-flight request is aborted when the member changes
  sports or leaves the reader.
- The former “How OddSphere resolves the market” card is intentionally removed.
  It repeated Market Pulse plus the two split panels without adding another
  decision. The underlying split, movement, data-quality, and market-verdict
  data remain available in their existing reader sections.
- Missing First Inning projection data is labeled `Not available`; it is never replaced with a fabricated value.
- Empty sports retain the OddSphere shell and sport switch, while clearly stating that no slate is published.
- Soccer presentation tokens such as `home` and `away` are converted to the actual team label in the candidate UI only; the underlying stored prediction remains unchanged.

## Launch gates

- [ ] Founder approves desktop and mobile visual review for MLB Moneyline, Total, and First Inning.
- [ ] On phone widths, card-body and individual market-pill taps open the sheet on the intended game and market; close, Escape, previous/next, rotation, and body-scroll restoration are verified.
- [ ] Founder approves WNBA Moneyline, Total, and Spread review.
- [ ] NBA is reviewed again when a real current slate exists.
- [ ] Every board market pill opens the corresponding game and market and updates the URL.
- [ ] Open, Published, Prior Observed, Current, and Locked labels are verified against stored side-aware data.
- [x] WNBA movement trails retain sportsbook identity and show same-book line-plus-price stops; the current WNBA slate has no cross-book trails.
- [x] NY/LV Moneyline, Total, and Spread were checked against FanDuel same-book history, including the material line-number moves.
- [ ] Immediately before cutover, republish every member-fast Daily Edge
  response snapshot with the release-candidate DTO. Reject the release if a
  directional market read is present but its stored snapshot lacks the named
  same-book trail that supported it. This prevents an older fast-path snapshot
  from dropping new movement evidence after otherwise-correct code deploys.
- [x] Public Consensus and Sharp Book Splits are checked for source separation, timestamps, both sides, and unavailable states on representative MLB and WNBA readers.
- [x] All key stats supplied by the current reader DTO remain reachable: every
  selected-market row renders immediately and the Matchup deep view gathers
  and deduplicates rows across all three markets.
- [ ] Team logos, team colors, starter names, and sport-specific market labels are visually checked on representative games.
- [ ] Loading, no-data, stale-data, and locked-game states are reviewed.
- [x] Recent-history reads use a one-hour server cache keyed by sport, slate date, and sorted slate teams rather than an uncached per-view query.
- [x] Named MLB starter First Inning context uses prior completed starts and inning-score records, with honest sample counts and unavailable states.
- [x] WNBA availability context is tied to the exact ESPN matchup and preserves status, reason, position, and report timestamp.
- [x] The current MLB report covers both exact teams for all 15 slate games;
  the provider returned a date-stamped 30-team report and the UI path fails
  closed on stale dates, timeouts, and unmatched teams.
- [ ] Staging confirms one slate request per initial visit or sport change, with zero slate requests for game/market switching.
- [ ] Staging load test records p50/p95 response time, database query count, error rate, and memory use at expected peak concurrency.
- [ ] Production monitoring and rollback thresholds are defined before exposure reaches all members.
- [x] Focused Daily Edge regression tests pass (presentation checks plus 5/5 sport response contracts).
- [x] `npm run readiness:daily-edge-experience` passes the response contract for every member-available sport, using current MLB/WNBA slates and stored representative World Cup/NBA/NHL slates. Visual review remains a separate gate.
- [ ] Repository-wide TypeScript and `next build` checks pass from a clean release commit. They currently pass in the working tree; the clean intentional release commit remains a promotion gate.
- [ ] Production remains unchanged until the private preview is explicitly promoted.

## Deliberate follow-ups, not launch claims

Additional fields such as pitch mix, K-BB%, xFIP/SIERA, platoon hitting,
bullpen workload, richer park/weather detail, and sport-wide official
injury/news coverage should only be surfaced after a coverage audit confirms
that each field is available, fresh, and consistently attributable. MLB and
WNBA availability are private-candidate pilots from different named sources;
they are not a claim that NBA, NHL, or World Cup have equivalent coverage. The
UI should not imply that a field exists merely because a provider could
theoretically supply it.
