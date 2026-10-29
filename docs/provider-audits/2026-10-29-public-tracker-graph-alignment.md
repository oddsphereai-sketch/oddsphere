# Public tracker and sportsbook graph alignment

Starting production base: `4987c8d1937396e02f51f3dfde10208143e4d17d`.

## Confirmed mismatch

CLE–ATL Spread's public odds map uses BetMGM ATL -1.5, -105 to -102.
The separately selected prediction-market reference used Circa ATL PK at
-110. The graph and map therefore represented different books and different
handicaps. Stabilizing the graph's independent source did not align those two
public surfaces.

The -105 to -102 change also preceded the Kalshi contract's first actual
quotes. Matching the sportsbook alone cannot turn the later common-window
curve into an earlier move. No source timestamps or quotes may be invented.

## Owner-selected behavior

- Default to the two-source comparison: both traces start at the earliest
  genuinely covered overlap and share the same right cutoff.
- Keep the real sportsbook opening/first-recorded price and original time
  outside the comparison plot. Never relocate it to the Kalshi start.
- A compact `Full movement` toggle reveals the earlier sportsbook price path
  at its actual timestamps. The main chart's existing dimensions and bounded
  mint/violet curve treatment are retained.
- Bind the sportsbook trace to the public map's exact selected source, side,
  terminal handicap and published timestamp. Extract the existing coherent
  group selection into one pure helper used by both surfaces; preserve its
  current/locked endpoint requirement and original tie-breaks.
- Separate changed point lines from exact-threshold American prices. Preserve
  the chosen source's full public `lineTrail`, including round trips, in the
  small line-history strip. Equal start/end values do not erase intermediate
  observations.
- Same-book, same-line auxiliary history can recover verified earlier source
  quotes and openings, rather than being clipped to our first local poll.
  The already published terminal quote/time remains the right boundary;
  stored prices win timestamp ties. Newer independent books/handicaps cannot
  replace that public tuple.
- Existing browser source pins cannot override an explicitly bound public
  tracker. Source/endpoint/reference changes bust the local display key so
  an old game's/source's response cannot linger under a new tracker.

## Boundaries

This is a public display repair, not an internal sharp-reader/model change.
No prediction input, release, forecast, probability, pick, grade, stake, splits,
provider request, schedule, lease, writer or stored locked record changes.
The existing locked archive/stored-book precedence runs before the new API
display mode; legacy frozen charts keep their exact original semantics.

## Verification

Focused cases cover the actual Hawks mismatch and pre-Kalshi price move,
identical public group selection, current-only records, equal-depth source
ties, wrong book/handicap rejection, published terminal precedence, round-trip
line movement, source-pin migration and immutable locked evidence. Check all
prediction-market suites, the 228 shared reader checks, TypeScript, ESLint,
production build, full `npm run verify:model-change`, real desktop/mobile
Compare/Full movement views, fresh-main integration safety and post-deploy
live behavior. Optional local PostgreSQL proof requires its configured URL.
