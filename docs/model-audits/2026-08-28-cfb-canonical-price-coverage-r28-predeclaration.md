# CFB canonical sportsbook-price coverage r28 predeclaration

Date: 2026-08-28

Status: predeclared production candidate. No production provider, cron, writer, or database call is authorized by this document.

## Launch defect

The natural 38-game r8 wave contains 114 public market slots but only 27 complete exact-price evaluations. Eighty-seven markets are unavailable, including 84 with `named_target_quote_unavailable`. Twenty-three games have no stored named-book evidence at all. The existing SharpAPI fallback spends up to 192 requests constructing local event slugs and bucket suffixes from BALLDONTLIE team names. That is not SharpAPI's canonical event-discovery contract and makes legitimate events vulnerable to alias and bucket misses.

The reader compounds the operational defect when a football Spread or Total has an explicit `market_data_unavailable` prediction status: it falls through to raw `Projected margin` or `Projected total` copy. Those values are score-distribution context, not a line-specific market prediction.

## Frozen candidate

1. Query SharpAPI `/events` once per unique Eastern/UTC slate date with `league=ncaaf`, `live=false`, and a bounded 200-row page.
2. Match a discovered event to a scheduled game only when the canonical event ID is present, home and away identities each match exactly under the existing normalization rules, and start time is within 15 minutes. Zero matches remains unpublished; more than one match or event reuse fails the entire writer before append.
3. Fetch `/odds` only for the single canonical event ID, with `market=main`, `is_live=false`, bounded offset pagination, and the existing 192-request all-run ceiling.
4. Preserve all existing sportsbook trust, target eligibility, exact-pair completeness, same-line comparison, paired-alternate, timestamp, T-60, tracking, and grade-policy rules. Do not synthesize a quote or use Playbook consensus as a sportsbook price.
5. Keep Moneyline, Spread, and Total availability market-scoped. Missing Moneyline cannot suppress complete Spread or Total evidence.
6. For an explicit unavailable NFL/CFB Spread or Total market prediction, render the existing unavailable label. Preserve the expected score and independent winner forecast in their existing Quick Read surfaces.

## Release and evaluation contract

The independent and market-informed PMFs, probability calibration, grade thresholds, stakes, and tracking rules do not change. The exact-price decision, tuple, evidence, member, writer, fixture, provider, and shared presentation releases must advance because canonical discovery can recover real evaluated tuples. The complete stored r8 wave remains the atomic fallback until one complete r9 wave is available.

Predeployment evidence must report the stored 38-game/114-market baseline, exact evaluation/unavailability counts, and prove zero changes to existing exact tuples under identical input rows. Postdeployment acceptance requires an untouched natural writer cycle, the complete r9 release, exact before/after grades and availability, request count, recovered provider provenance, zero ambiguous or cross-game matches, and signed-in desktop/mobile QA.

The candidate must be rejected if it flattens the evaluated grade ladder, changes an existing exact tuple without new provider evidence, exceeds bounded calls, creates a second writer, weakens strict identity, fabricates prices, mixes release waves, or reintroduces Toss-Up outside MLB first inning.
