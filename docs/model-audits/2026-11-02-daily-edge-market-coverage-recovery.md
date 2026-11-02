# November 2 Daily Edge freshness and CBB coverage recovery

Starting main: `bf7235cfd0fee69774add4ba97379b7eb5f7c303`.

At 12:24–12:27 UTC, the source audit found 15/15 today's NBA games had complete
Circa/Pinnacle prices. The NBA partial warning concerned the 14 games on a later
slate, rather than today's game identity. NHL's daily/intraday updates were
successful and its four current games had all 12 markets priced and split panels.
NFL/CFB display captures and writer cycles were current. Extended graph and
interpretation spot checks are required separately before reporting overall health.

CBB's true member timestamp was 10:47 UTC, despite newer public-split snapshot
write times. A provider reversed the locked App State/Merrimack fixture; the
correct lock protection aborted the whole fixture seed and prevented every other
matchup refreshing. The repair preserves that exact locked fixture/member DTO,
reports its conflict and allows unrelated games through. No historical lock,
price, projection, probability, pick, grade or evidence is corrected or replaced.
The conflicted record does not receive a result from differently oriented source
scores. The job reports partial until the underlying source conflict is resolved.

Exact provider institution variants were rejected for many priced D1 matchups:
Michigan St, Boston U, UMass, MD Eastern, and others. One explicit mapping path now
resolves verified institution variants for both event and outcome names. It does
not use mascot, substring or ambiguous code joins. League, paired participants,
source times, same-book uniqueness, exact prices and complementary lines remain
required. Negative tests retain real distinctions such as Maryland versus UMES,
Tennessee versus ETSU, UNC versus NC State and Louisiana versus UL Monroe.

The former complete-three-market target-book prerequisite also hid available
Spread/Total markets when Moneyline was absent. Complete books keep exact prior
precedence; only when none exists does a coherent partial book publish its
supported markets. Missing markets remain Held. The independent forecast,
probability law, grade evaluator and stakes are unchanged. This is a coverage
promotion, not a claim of improved win rate. Tests prove a supported partial
Spread/Total can earn the existing actionable grade, absent ML stays Held,
duplicate markets fail, and a complete book beats a preferred partial book.

The same sole leased prediction pipeline continues to own all writes. No new
provider poller or Owl’s request is introduced. Bounded BDL current-odds pagination
is added to the existing writer when primary markets are missing, sharing its
existing 160-request ceiling. A checked two-day receipt used five requests.
An isolated frozen-receipt rehearsal intercepted every DB mutation and made no
paid provider request. It published 118 model cards compared with the stale
64-card board, preserved the exact existing lock, and recorded 87 Lean / 42 Best
Angle / 106 Watchlist / 119 No Play or held markets. The prior stale capture had
42 Lean / 18 Best Angle / 63 Watchlist / 69 No Play. Those clocks and coverage
sets differ, so this is an operational comparison, not a causal grading claim.
A same-receipt before/after comparison is recorded with the final validation.

The rolling schedule uses exact D1 conference membership from the captured
provider receipt. It includes D1/D1 and D1/non-D1 games, excludes only non-D1/non-D1,
without adding member copy or labels. Existing locks stay
visible. Missing logos do not veto a verified fixture or replace identity proof.

Required validation: focused provider identity, partial-market grade, seeder
isolation, writer immutability/reader precedence, all CBB/prediction-market tests,
TypeScript, lint, production build, verify:model-change, latest-main clean
integration safety, protected PR and live writer/reader/source verification.


The owner requested primary-source consistency and real missing moneylines.
A direct BDL audit returned 423 current odds rows in five bounded requests,
including actual Fanatics moneylines for all eight games missing them in Owl's.
Examples include -20000/+5000 and -100000/+15000; no synthetic price is inferred.
The fallback fills only a market type absent from every qualified primary quote.
It never replaces primary Spread/Total just to acquire a fallback ML, never
mixes the two sides of a pair across providers, and rejects wrong IDs, stale,
future, blocked, unknown-book or conflicting latest observations. Complete-book
selection remains preferred; if a preferred book lacks one market, that market
can independently use its own verified book. Target-excluded grading is unchanged.
Playbook's line feed is consensus context, not relabeled as a named sportsbook.
The Odds API was not configured in the local audit environment, so no claim is
made about its live CBB availability. The CBB reader retains observed paired
market prices even when missing model inputs require Held and no bet price.
The historical display capture no longer discards a canonical quote solely for
being steeper than -9900; original times, source book and lock boundaries remain.


Final same-input comparison at 13:00 UTC used identical frozen quote receipts
and identical independent forecasts for 117 upcoming D1 games / 351 markets.
Before: 22 Best Angle, 41 Lean, 61 Watchlist, 59 No Play, 168 Held.
After: 42 Best Angle, 87 Lean, 106 Watchlist, 113 No Play, 3 Held.
Actionable promotions: 68; actionable demotions: 2; net actionables 63→129.
All score forecasts were unchanged. Both demotions were UTSA/San Jose State
Spread/Total: corrected institution mapping recovered the preferred FanDuel
quote and a qualifying opposed professional reference that the old mapper missed.
The same existing grade evaluator handled the verified opposition; no new
blanket-demotion rule was introduced. Supported partial-market promotions,
professional corroboration/opposition, complete-book precedence and exact-source
fallback are covered by focused regressions. No win-rate improvement is claimed.

The final full-writer intercepted-write rehearsal published 118 games: all 117
upcoming D1/D1 games plus the exact preserved locked App State record. The other
D1 event was already final with no pregame snapshot and is not reconstructed.
D1/non-D1 prediction/grade coverage is not yet repaired. Neither the captured
Owl’s odds receipt nor BDL’s 423 current odds rows listed any of today’s 62
D1/non-D1 games; none of the 128 upcoming non-D1 opponents exists in the frozen
366-team prior. No new member labels or placeholder UI are introduced.

The remaining upcoming D1 input gap is St. Thomas–Minnesota (BDL 332), not
New Haven (BDL 249, which has a prior). Verified ESPN institution ID 2900 repairs
the shortened official venue name. That does not repair the separate missing
team rating in the frozen prior: the actual BDL history contains 34 2025 games,
but the prior has no team 332. Its three markets therefore remain incomplete
until the historical input recovery is validated; this release does not pretend
that source-name repair alone completes that forecast. The exact locked App
State record also retains its original incomplete grades unchanged.

Optional research-only CBB matchup tests could not run because the existing
external `/private/tmp/oddsphere-cbb-data/score-feature-development.json` fixture
was absent. Production CBB, locked reader/writer, source/identity, pricing,
graph suites and required model verification are validated separately.

Venue matching release `cbb_venue_identity_2026_11_02_r1_verified_external_ids`
uses the same paired-institution/date uniqueness checks plus the verified
St. Thomas external ID. Current-season training receipt r2 uses this same
matcher; existing valid r1 receipts remain readable. No historical receipt or
locked record is overwritten to fit a new meaning.
