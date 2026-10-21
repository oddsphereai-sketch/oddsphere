# NBA player props product candidate result

Date: 2026-10-21

Status: **private candidate complete; public activation remains disabled**

## What exists now

- A real OddSphere-native NBA Props board and reader at the private preview
  route `/dev/nba-props-preview`.
- One canonical main line per game/player/market. Alternate sportsbook offers
  appear only in the reader's exact-price ladder.
- Market-specific role, production, and matchup evidence. Panels omit missing
  values instead of inventing substitutes.
- Target-book-excluded market confirmation and genuine sportsbook quotes.
- A bounded refresh planner that reuses `prediction_pipeline:nba`, plus a pure
  disabled lifecycle implementation that freezes at T-60 and preserves prior
  locked payloads byte-for-byte.
- Internal-only immutable tracking contracts. No public tracking was added.
- NBA remains absent from member navigation and no provider is called from a
  member request.

## Current provider proof

The 2026-10-21 live provider probe found:

- 11 scheduled games;
- 28,147 normalized observations;
- nine sportsbooks;
- all eight foundation markets;
- 4,132 complete two-way market buckets; and
- zero invalid freshness rows.

This proves current market availability. It does not by itself qualify the
model, grades, writer, or public route.

## Forecast and grade evidence

The immutable historical input SHA-256 remains
`b8e20c78dabed1f461e8eb9e26c85c61316ba801ac94cf776969c45544d93da8`.
On the untouched chronological confirmation block, the coherent actionable
surface (chosen-side probability at least 50%) produced:

| Market | Record | Hit rate | Units | ROI |
| --- | ---: | ---: | ---: | ---: |
| Points | 34-24 | 58.6% | +3.21 | +5.5% |
| Assists | 14-7 | 66.7% | +3.75 | +17.9% |
| Points + rebounds + assists | 16-7 | 69.6% | +6.54 | +28.5% |
| Combined | 64-38 | 62.7% | +13.51 | +13.2% |

This is retrospective confirmation, not a forward guarantee. Rebounds,
threes, points + rebounds, points + assists, and rebounds + assists remain
forecast-visible but cannot receive Lean or Best Angle until their own grade
policy qualifies.

The private three-game visual slate contains 48 canonical reads: three Best
Angles, eight Leans, ten Watchlists, and 27 No Plays. Actionables are five
Overs and six Unders across Points, Assists, and PRA, so the design is neither
flat nor side-skewed. A grade/probability contradiction found during product
integration was repaired: a sub-50% chosen-side forecast stays visible as a
Watchlist rather than being mislabeled actionable.

## Visual and safety verification

- Desktop board: passed.
- 390x844 mobile board: passed.
- Mobile full-height reader: passed.
- Header and league navigation wrapping: passed.
- Runtime browser errors/warnings: none.
- Product preview contract: passed.
- Disabled cadence and locked-record immutability: passed.
- Provider/source/cost foundation: passed.
- Market-specific reader contract: passed.
- Private tracking contract: passed.
- TypeScript and focused lint: passed.
- Repository-wide `verify:model-change`: passed.
- Production Webpack build (109 routes): passed.

## Remaining public-release gates

1. Build the forward current-slate feature job from official stats,
   availability, and injury inputs.
2. Serialize the qualified fitted model/calibration artifacts rather than
   fitting inside a request or refresh.
3. Add the candidate to the existing NBA refresh owner under the existing
   shared lease; do not create another timer or writer.
4. Store a compact last-known-good member snapshot and load reader evidence on
   demand so a full NBA slate does not inflate page payloads.
5. Capture forward T-180/T-60/T-15/lock prices and validate movement, CLV,
   settlement, board counts, and grade calibration by release.
6. Qualify the remaining five market grade surfaces or keep them forecast-only
   at launch.
7. Complete current-main integration safety, protected PR checks, owner
   approval, and post-deploy live proof.

Until those gates pass together, enabling NBA in the public league pill would
misrepresent a private validated candidate as a production system. This branch
therefore improves the product and makes it reviewable without exposing a
half-wired model to members.
