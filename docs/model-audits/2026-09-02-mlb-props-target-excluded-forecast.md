# MLB props r39 target-excluded forecast candidate

Status: **GREEN local source-review candidate; not approved for publication.**

## Scope and release

- Candidate release: `mlb_props_2026_09_02_r39`
- Context release: `mlb_props_market_aware_context_2026_09_02_r2_target_excluded_forecast`
- Frozen incumbent: `mlb_props_2026_09_01_r38`
- Frozen snapshot: `1d1b9446-f245-414b-a1b7-44381a5ef2e6` at `2026-09-02T16:17:20.520Z`
- Replay budget: two SELECTs, zero provider calls, zero writes.

The evaluated sportsbook is removed from its own current consensus, opening/current movement,
verified split input, related-market movement, hitter anchors, pitcher anchors, weak-pitcher
control, and final outer posterior. A pitcher posterior is formed once; the board does not apply
the same target-excluded anchor twice. With no independent alternative, the existing independent
player distribution remains authoritative. The evaluated quote is used only downstream for its
exact fair-price/EV and grade economics.

The final forecast side is selected from complementary final probabilities for every true two-way
offer. The dedicated Home Run portfolio is a one-sided 1+ Home Run event contract, so it retains
the offered event and its calibrated probability instead of inventing an unavailable Under offer.
A changed two-way side may
be graded only when the exact complementary offer has the same sportsbook, line, and observation
timestamp. Otherwise the prediction remains, but the bet is non-actionable. Changed projections
come from the existing count-distribution inverse at the final probability. Existing category
priors, model weights, and contextual caps are unchanged; missing splits remain neutral.
For true two-way offers, an actionable grade additionally requires the final expected-count
projection to support the final posterior side. A distributionally valid mean/threshold mismatch
may remain visible as research context, but it is explicitly Watchlist/No Play and every validated
promotion path honors the same guard. The one-sided 1+ Home Run event remains exempt because it
does not claim a complementary Under forecast.

## Frozen evidence and replay coverage

The frozen board has 5,962 rows: 49 Best Angle, 123 Lean, 2,005 Watchlist, 2,082 No Play,
1,382 Research, and 321 Pending Data (172 actionable). Capture metadata has 3,490 observed
economic identities, of which 1,818 are retained and 1,672 omitted; 3,123 rows carry references
and 2,839 do not.

The full replay uses the canonical snapshot's normalized research object, exact per-book offers,
opening trails, incumbent independent probabilities, and deterministic identity function. It
measures 5,493 rows. The remaining 469 lack an eligible independent forecast and retain their
health behavior. It does not call a provider or infer a split.

Across 5,542 evaluated economic quotes, target-excluded comparator breadth is 2,011 / 2,480 /
807 / 244 for zero / one / two / three-plus alternatives. Minimum breadth per identity is
2,011 / 953 / 357 / 169. The evaluated-quote forecast-consensus reference count is exactly zero.
No verified splits exist in this capture, so splits contribute exactly zero.

Independent decimal projections can be reconstructed exactly for most retained hitter identities,
but not every one: compact research preserves only ten display logs while some dedicated fits used
larger transient samples. The retained validation is exact for every Doubles, Runs, Singles,
Triples, and Stolen Bases identity and for the large majority of other categories. The largest
category-specific reconstruction misses are 0.105604 Hits, 0.08 Batter Strikeouts, 0.16 Total
Bases, 0.118212 H+R+RBI, 0.032451 Home Runs, 0.03 Walks, and 0.02 RBI. Probability, side, and
grade replay use the stored independent probabilities and are not affected by this projection-only
qualification uncertainty. Of the 5,128 projected changes, 4,428 are exact from retained inputs or
the final distribution inverse. The remaining 700 are explicitly marked reconstruction estimates;
they are not presented as exact production decimals before a natural r39 write.

## Full frozen replay

The candidate changes 5,374 probabilities and 5,128 decimal projections across 5,493 measurable
rows. Mean absolute changes are 0.025749476 probability and 0.072052993 stat units; maxima are
0.428153 probability and 3.571773376 stat units. It crosses 205 forecast sides. Ninety crossings
lack an exact same-book/same-line/same-timestamp complementary row and are non-actionable.

Grades move from 49/123/2,005/2,082 to 45/92/1,880/2,242 for Best Angle/Lean/Watchlist/No Play.
Actionable rows move 172 to 137 through 7 promotions and 42 demotions. Research (1,382), Pending
Data (321), all 1,703 health rows, and the empty locked cohort are unchanged. No quota or synthetic
replacement is used.

| Category | Rows | Measured | Action r38→r39 | Projection changes | Probability changes | Side changes | Promotions / demotions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pitcher strikeouts | 52 | 50 | 3→3 | 50 | 50 | 2 | 0 / 0 |
| Pitcher outs | 55 | 50 | 1→1 | 39 | 38 | 2 | 0 / 0 |
| Pitcher hits allowed | 52 | 52 | 0→0 | 52 | 52 | 1 | 0 / 0 |
| Pitcher walks | 48 | 48 | 0→0 | 48 | 48 | 2 | 0 / 0 |
| Pitcher earned runs | 54 | 54 | 0→0 | 54 | 52 | 2 | 0 / 0 |
| Batter strikeouts | 262 | 237 | 11→11 | 237 | 237 | 35 | 0 / 0 |
| Batter hits | 566 | 518 | 8→6 | 518 | 504 | 21 | 2 / 4 |
| Batter total bases | 554 | 481 | 0→0 | 481 | 471 | 37 | 0 / 0 |
| Batter home runs | 292 | 286 | 5→3 | 208 | 275 | 0 | 0 / 2 |
| Batter RBIs | 566 | 501 | 1→1 | 501 | 499 | 14 | 1 / 1 |
| Batter runs scored | 566 | 491 | 22→17 | 491 | 488 | 12 | 0 / 5 |
| Batter hits+runs+RBIs | 554 | 503 | 4→1 | 503 | 492 | 58 | 0 / 3 |
| Batter singles | 566 | 505 | 60→37 | 505 | 502 | 15 | 0 / 23 |
| Batter doubles | 566 | 550 | 30→31 | 274 | 506 | 0 | 4 / 3 |
| Batter triples | 273 | 268 | 0→0 | 268 | 267 | 0 | 0 / 0 |
| Batter walks | 519 | 489 | 27→26 | 489 | 489 | 4 | 0 / 1 |
| Batter stolen bases | 417 | 410 | 0→0 | 410 | 404 | 0 | 0 / 0 |

Promotions exercise existing exact-price paths only: two Hits Under, four Doubles Under, and one
RBI value. Demotions are caused by an opposite final posterior, negative exact-price economics,
the existing capped Home Run portfolio rank, or the established projection/side integrity rule.
Twenty-seven actionable
rows have no independent comparator; their exact
evaluated price remains EV-only and missing comparator evidence is neutral. Home Run promotion
eligibility applies that same neutral-missing rule, while preserving the existing three-primary
plus two-complement portfolio caps and every exact-price threshold.

## Qualification disposition

The structural source change closes the evaluated-offer self-validation and duplicate-pitcher-
anchor pathways, and the replay exercises both promotions and demotions. No category with an
incumbent action becomes flat. The Home Run category remains populated at three actions through
its existing one-sided exact-price portfolio; missing independent comparators are neutral, not
manufactured support. Every true two-way flip still requires the exact complementary offer.

The replay reports 748 expected-count-versus-numeric-line disagreements. The final decimal remains
the exact inverse of the existing discrete count distribution, so these can be statistically
coherent even when a simple mean-versus-line sign test differs. The candidate no longer permits
any such true two-way row to carry an actionable grade: the hard audit count is zero. This preserves
the required distribution rather than inventing a linear display offset.

This checkpoint is **GREEN for local source review**: release-pure behavior, target exclusion,
two-way complementary-price safety, promotion and demotion paths, category coverage, health, and
locks pass. The 700 projection-only reconstruction estimates mean their exact decimal production
values must be verified from the first natural r39 writer rather than asserted from compact r38
evidence. The candidate stays local and unpushed; no registry edit or production publication is
requested before root review and fresh-main integration.

## Authoritative operation and telemetry

There is no shadow-board or manual model-activation path in this candidate. Once the release is
accepted and published, the ordinary leased MLB props refresh constructs and validates r39, then
publishes it as the canonical/member release. Comparator eligibility is internal: a retained,
target-excluded alternative enters the existing forecast calculation; absent alternatives select
the existing independent player distribution automatically. The evaluated offer is used only for
exact-price EV and grade economics.

Every natural refresh emits structured `MLB_PROPS_FORECAST_TELEMETRY` with the runtime and snapshot
release identity, authoritative/dry-run/last-known-good disposition, forecast-row count,
target-excluded-reference count, independent-fallback count, action count, locked-row count, and
actionable projection/side contradiction count. An invalid refresh is not published; the prior canonical and
member snapshots remain last-known-good and the ordinary next cycle retries. Member-snapshot
publication failure likewise preserves the prior member snapshot and retries naturally. No extra
provider call, table, writer, cron, lease, or snapshot payload is introduced.
