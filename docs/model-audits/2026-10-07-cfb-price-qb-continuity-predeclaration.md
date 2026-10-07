# CFB current-price and quarterback-context continuity predeclaration

## Scope

This change is limited to two confirmed current-slate defects:

1. A complete current DraftKings quote published in ESPN's scoreboard feed is not used when the paid BALLDONTLIE and SharpAPI named-book paths are missing the game. ODU at Appalachian State is the production acceptance case: Playbook and ESPN both publish the matchup and line, ESPN publishes complete paired Moneyline, Spread and Total prices, while the member snapshot has all three exact prices missing.
2. Once any nonempty BALLDONTLIE active-quarterback capture exists for a CFB team, the writer never refreshes it, including at T-60. A later roster/depth change therefore cannot silently replace old context. A failed or empty refresh must retain the last verified nonempty roster.

No synthetic price, consensus-as-book substitution, member copy, label, stale badge, layout, extra writer, lease, lock rule, tracking backfill, or unbounded per-game request loop is permitted.

## Candidate behavior

- Add a bounded ESPN current-odds fallback for FBS-involved games whose comparable current named-book board is incomplete.
- Require strict ESPN team identity and kickoff matching.
- Accept only coherent paired current DraftKings tuples. A partial or malformed market remains unavailable.
- Merge the fallback through the existing named-book continuity path so fresher paid-provider evidence silently supersedes it and provider omissions do not erase it.
- Refresh active-QB context at T-60 and when the retained capture is at least 24 hours old, prioritizing T-60 and oldest evidence within the existing 24-team bound.
- Retain the last nonempty active-QB capture when a new provider response is empty.

## Validation contract

- Unit fixtures must prove strict identity, paired-price validation, malformed/one-sided rejection, bounded requests, T-60 refresh, 24-hour refresh, and empty-response retention.
- A read-only current-board replay must report price coverage, prediction coverage, promotions, demotions, side changes, grade counts, and coherence failures.
- The ODU-APP acceptance case must contain real current paired prices after a natural production refresh.
- FCS-only games with no published provider quote must remain unavailable; the release must not manufacture prices to reduce the count.
- `npm run verify:model-change`, focused CFB tests, integration safety, protected PR checks, and live release verification are mandatory.

## Validation result

- The current member snapshot contains 89 games and 267 market surfaces. Ninety-three current prices
  are absent: 90 are FCS-only markets, while the three FBS-involved misses are Moneyline, Spread, and
  Total for ODU at Appalachian State.
- Bounded live-provider probes found no BALLDONTLIE book for ODU-APP and no SharpAPI publication, but
  ESPN's strict group-80 scoreboard match contains a complete current DraftKings pair for each market.
  ESPN group 80 published odds for all 46 returned FBS events; its group-81 FCS scoreboard published
  no odds for any of 50 returned events. The candidate therefore repairs a proved ingestion gap and
  does not pretend the other 90 currently unpublished market prices exist.
- The live-provider zero-write writer replay covers 88 upcoming games with zero capture failures.
  ODU-APP receives one verified DraftKings book containing all three prices. Its three exact-price
  decisions remain held by `target_excluded_same_line_consensus_insufficient`, so the same-input
  actionable impact is zero promotions, zero demotions, and zero flattening.
- Focused fixtures prove strict event identity, independent paired-market validation, malformed pair
  rejection, FCS-only request avoidance, T-60 and 24-hour quarterback refresh selection, and retention
  of the last nonempty roster after an empty response.
- The provider audit also confirms that Playbook's configured NCAAF injury request returns no usable
  report, BALLDONTLIE supplies active rosters rather than injuries, and the configured environment has
  no separate NCAAF injury-feed credential. The continuity repair is therefore intentionally limited
  to refreshing and retaining verified quarterback context; it does not manufacture a full injury feed.

## Release and rollback

The release family is evidence r35, collector r46, member r49, market reader r28, decision r40,
decision tuple r28, writer r100, fixture r75, outcome r65, compact snapshot r35, reader r20, tracking
r37, and active-quarterback context r3. Roll back the family together to the immediately preceding
October 6/October 4 authority without modifying an immutable T-60 row.
