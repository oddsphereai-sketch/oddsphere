# MLB r41 sharp slate identity and reader price-history recovery

Date: 2026-08-14
Sport/markets: MLB Moneyline, full-game Total, First Inning reader movement;
SharpAPI split inputs for Moneyline/Total
Previous release: `mlb_daily_edge_decision_2026_08_13_r40`
New release: `mlb_daily_edge_decision_2026_08_14_r41`
Rule bundle: `mlb_daily_edge_rule_bundle_v40_2026_08_14`
Grade policy: `mlb_public_grade_policy_v31_sharp_slate_identity_2026_08_14`

## Incident evidence and root cause

The August 14 member reader showed broad Sharp Book split gaps and sparse
first/prior observed prices. Direct provider and storage audits established two
independent causes:

- SharpAPI `/splits` returned ten unique MLB matchup rows carrying an August 14
  event-id date, but only two matchup identities resolved to the August 14
  schedule and nine resolved to August 13. Date query parameters did not alter
  that payload. The upstream feed was in a partial slate rollover.
- MIL-LAD occurred on both slates. The old event-id date guard therefore
  accepted August 13 matchup percentages as August 14 evidence. Those false
  splits activated `total_sharpapi_money_over_tickets_support_lean_v1_2026_08_12`
  on the MIL-LAD Over.
- The legacy `line_history` table was empty for BAL-TB, ARI-ATL, and TEX-ATH
  and thin for STL-CHC, while canonical `market_price_observations_v2` already
  contained genuine both-side Moneyline histories for every game and genuine
  Total histories where more than one observation had actually occurred.

## Correction

The SharpAPI signal provider now validates the whole split payload against the
requested and previous schedules before using any row. It requires at least
70% current-slate matchup coverage and a strictly better current-slate fit.
Ambiguous, stale, and partial rollover payloads fail closed. The existing
per-row event-id date guard remains as a second check.

The Daily Edge route now has a reader-only fallback from
`market_price_observations_v2`. It fills a side only when legacy history lacks
a two-timestamp same-book trail, excludes blocked books, preserves genuine
single observations as single observations, and never complements or invents
prices. Its map is passed only to movement display construction. Pre-lock side
corrections and the authoritative writer continue to use legacy inputs.

No new timer, writer, provider call, or lease was added. The existing
sport-scoped `prediction_pipeline` lease remains authoritative.

## Board impact and validation interpretation

This is an input-identity incident correction, not a fitted demotion rule. The
paired incident-snapshot impact is one contaminated Total Lean removed and no
legitimate promotion added; Moneyline and First Inning action counts are
unchanged. Adding a replacement solely to preserve board count would violate
the missing-data and promotion-evidence requirements. All remaining SharpAPI
dependent sleeves fail closed until the provider payload coherently represents
the current slate. Playbook public consensus remains a separately labelled
source and is not relabelled as Sharp Book data.

Historical outcome backtesting cannot validate whether yesterday's data belongs
to today's game; schedule identity is the applicable test. Deterministic tests
cover stale, aligned, partial, repeating-matchup, malformed, blocked-book, and
single-observation behavior. The required model safety suite and live paired
reader checks are deployment gates.

## Rollback

Rollback code and runtime stamps to r40/v39/v30 only if r41 causes a reader
error, mixed current-slate release stamps, or writer incoherence. Do not restore
the contaminated split rows. The reader fallback is availability-only and can
be independently removed without changing predictions.
