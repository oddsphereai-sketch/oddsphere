# UCL multibook, full-pregame interpretation and coherent score presentation

## Scope and authority

Daniel requested spot checks of the nine November 4 forecasts and then explicitly
directed repair of the single-book/limited-path influence and contradictory card/
reader scores. This continues his owner-directed product-correctness authorization
with forward outcome evaluation. No historical outcomes are used to select this
repair. No win-rate improvement is claimed.

Starting main: `1c2dd053ac133f7fb226818d60411ea75b191614`.
Candidate: model R21, grade R24, coherent outcome R14, projected score R12,
member lifecycle R23. Elo R2, split capture R4, quote recovery R4, provider budgets,
cadence, writer, `prediction_pipeline:soccer` lease, T-60 and tracking are unchanged.

## What the spot check actually found

The latest stored publication read at 08:27 ET was generated at 08:03 ET. All nine
exact Over2.5 quote pairs favored Over; therefore an all-Over slate does not alone
prove a defect. Liverpool–Fenerbahce was reasonably close: market Over70.38% versus
model69.19%, market BTTSYes63.79% versus model66.72%, with actual Yes strengthening.
Madrid–AEK was materially different: market BTTSYes58.10% versus model72.28%; its
latest informative Yes weakening was present, but only the intraday starting point
was used for net score influence. Como–Lens had market Over59.67%/Yes61.71% versus
model69.57%/70.66%. These differences are model opinions, not market confirmation.

The score calculation selected one rank-first physical book per market. Other
valid books were largely opposition/grading metadata. It also reset comparison
history to the ET day, discarding genuine earlier pregame movement. The original
implementation did account for a reversal through its final endpoint; adding a
second reversal multiplier would double-count it. A complete roundtrip cannot
become a new opposite-direction edge merely because the last leg reversed.

Arsenal's card used an existing compatible decimal illustration2.5–0.4 while its
reader used unconditional means2.1466–0.7067. The compatible illustrative score3–0
was not the unconditional most likely score2–0. A further presentation edge case
allowed decimals such as2.3–0.4 to pass an Over check although they round to2–0.

## Repair

Each valid physical book with a complete earlier same-fixture/market/clock pair
contributes a source opinion. Identical economic trajectories form one family;
provider aliases, unchanged polling and copied paths cannot multiply confidence.
Missing historical evidence is excluded, never counted as a flat vote.

For MR/BTTS, normalized mean log probabilities form before/current opinions.
For native Totals, mean log inferred scoring intensity does the same; every pool
probability is explicitly in inferred official2.5 units, while real selected native
quote lines and settlement shares remain separately intact. The same families are
used at both endpoints. These are correlated source opinions, not independent
likelihoods. The independent statistical model is never an opinion in this pool
and there is no fixed model/book blend.

The existing shared minimum-information profiles are fitted to the pooled before
and current opinions against the same independent score law. Their density ratio
is applied once. Missing/incompatible support remains an explicit conflict. Exact
flat, pure-vig and roundtrip paths retain the original law; small changes remain
continuous. Every score, MR, Total, BTTS and Double Chance probability comes from
the one resulting distribution.

History starts at the first complete observed pregame pair, never a calendar reset
or a claimed true sportsbook opening. Operational opener flags do not by themselves
invalidate genuine complete stored pairs. Current executable quote attestation
remains stricter and unchanged. All source clocks, latest reactions, retraces,
gaps, family membership and opposition remain visible. Information overlap with
the independent model's current statistical inputs is explicitly unknown; this
repair does not claim news, betting limits or causes that were never observed.

New snapshots store one coherent score presentation used by every card/reader
headline. Its illustration is clearly distinct from unconditional expected goals
and carries the actual exact-score probability. Presentation interpolation must
agree with the selected directions both as decimals and when rounded to integer
goals. It changes no model probability. A null compatible scenario remains null;
incompatible marginal leaders cannot justify inventing a score. Individual team
scoring probabilities are now exact final-law marginals, rather than a Poisson
approximation reconstructed from means after joint-market transformation.

Only genuinely stored locks with a nonnull timestamp bypass fresh UCL mapping;
fresh elapsed EPL-adapter DTOs still receive UCL identity/assets before downstream
lock reconstruction. Stored legacy locks keep their exact prior reader branch;
new locks freeze the new field and can never receive an incoming replacement.

## Same-input board impact

The paired JSON records all nine current fixtures, complete original stored quote
clocks, source opinions and before/after outputs. It uses437 pregame training rows
and11338 stored quote rows, without provider requests, writes or outcome labels.
It is a same-input functional comparison, not a claimed future live distribution.

| Market | R20 | R21 |
| --- | --- | --- |
| Match Result |9 Watchlist|9 Watchlist|
| Total |3 Lean,6 Watchlist|4 Lean,4 Watchlist,1 No Play|
| BTTS |1 Best,5 Lean,3 Watchlist|8 Lean,1 Watchlist|

Actionables9→12: three Watchlist→Lean promotions, no actionable→nonactionable
demotions. Separately, Liverpool BTTS Best→Lean and Arsenal Total Watchlist→No Play
are reported tier demotions. Grade floors, value/movement lanes and price ranges
are unchanged. The existing paired-vig confidence lane qualifies two nonpositive
EV Leans, with their exact EV still stored and zero unqualified actionables.
Coverage remains36/36 selected and90/90 outcome prices, zero held/regressed quotes.

There are zero side changes: all nine remain Over and eight remain BTTSYes. This
repair is not selected to manufacture variety. Madrid BTTSYes72.28→70.82% and
Arsenal BTTSNo54.39→62.13% illustrate genuine evidence changes. Arsenal's Total is
only50.44% Over and becomes No Play. Its compatible3–0 illustration has10.92%
exact-score probability; the unconditional means remain2.1171–0.5839.

## Verification and publication contract

Focused tests cover genuine multibook effects, identical-path duplication,
missing-baseline neutrality, opposing opinions, full-history versus intraday
recovery, original quote identities/clocks, native whole/quarter contracts,
flat/vig/roundtrip neutrality, support conflicts and continuous changes. Builder
and DB regressions prove one stored presentation, exact law marginals, actual
capture→writer→lock→reader roundtrip, incoming replacement rejection, legacy field
absence and elapsed-kickoff UCL identity mapping.

Independent reviews identified and corrected the single-family Total unit mismatch,
elapsed raw-DTO bypass and misleading Mode label. No remaining reviewed blockers
were found. Full model-change verification, focused UCL tests, final build,
TypeScript, focused lint, fresh-main integration/protected PR and post-merge
release/writer/coverage/reader/immutable-lock proof are required before success.
No extra refresh is authorized by this document; normal scheduled publication
must apply the release unless the owner specifically approves another cycle.

Evidence: `2026-11-04-ucl-multibook-full-pregame-coherence-comparison.json`.
