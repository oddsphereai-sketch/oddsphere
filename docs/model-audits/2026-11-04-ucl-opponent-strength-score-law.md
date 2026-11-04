# UCL opponent-strength scoring and joint market-path repair

Starting base: `23f140f8b7aaa89258e569f015dcd8c183767734`.
Publication integration base: `2217d2c77abf1212192d9a3b77bf1892961d8ab0`;
both newer CBB documentation sections and all CBB code remain intact.
Owner authorization: November 4, repair the identified independent scoring and
market interaction defects before today's games; no forced No/Under picks.
Scope: UCL only, unlocked forecasts and future locks. No historical outcome
optimization, shadow activation, stake change, new writer/cadence or UI change.

## Why the repair is needed

The nine November 3 independent forecasts were already all Over 2.5/BTTS Yes.
The final reader flipped neither market. BTTS was1–8 (the three Leans0–3),
Over2.5 was5–4, and four of those Overs had a clean sheet. Seven fixtures
locked under R18/R21; two under R16/R19, so the cohort is not called R19
performance. Every frozen tuple remains unchanged.

The previous independent rates were sparse home/away goal ratios, not a
joint opponent-adjusted fit. The Elo projection preserved the original Total
and BTTS marginals explicitly. The reader projected separately modified
independent marginals, so another market could not revise a directly frozen
BTTS view. The statistical Elo source also separated AEK Athens/AEK,
LASK Linz/LASK and Viking FK/Viking into different club records.

## Independent architecture

R20 uses time-decayed regularized Poisson scoring estimates:

`home rate × attack(home) × defense(away)` and
`away rate × attack(away) × defense(home)`.

Attack/defense are shared club parameters; home/away intercepts retain venue
effects. Coordinate maximization accounts for the actual opposing parameters.
Proper Gamma mode-one priors identify parameter scales. The prior exposure is
the existing four matches times the cohort scoring rate, not four goals or a
new tuned constant. Existing365-day half-life and35%xG blend are unchanged.
The fit deduplicates exact match IDs, rejects conflicting labels, excludes
future/nonfinal rows and reports convergence. The actual437-row input fits in
43iterations (~48ms in the independent review). This is an implementation in
the opponent attack/defense Poisson modeling tradition, not a claim to have
reproduced the complete Dixon–Coles estimator or its historical returns.
Primary research: [Dixon and Coles1997](https://eprints.lancs.ac.uk/id/eprint/19492/).

The existing correlated local/public Elo opinion is not counted as a second
independent likelihood. It supplies the same decisive-result opinion as before;
the active score-shape function solves a Poisson goal allocation for its
conditional decisive-win probability at the fitted total. No original BTTS
marginal is imposed. The fitted scoring model owns the total level; Elo owns
separation. At a fixed total, Poisson Over2.5 is essentially unchanged while
BTTS can move substantially. The pre-existing finite0..8 grid causes small tail
and expected-total drift; the focused test and current board expose it rather
than claiming exact mean preservation. The old marginal-preserving function
is retained only for explicit legacy audit compatibility.

Canonical input R2 chooses an intact canonical rating lineage from raw R1,
never averages/adds ratings or game counts, and preserves generatedAt/source
identity provenance. A migrated cache's remaining TTL/stale interval is measured
from that original time. The next ordinary weekly source rebuild uses canonical
club names at the event level. Public/local Elo scales never mix across teams.

## Joint market interpretation

Both source endpoint profiles are minimum-KL fits against the SAME original
independent PMF, the SAME support and one COMMON feasible axis subset:

`final PMF ∝ independent PMF × current-source profile / baseline-source profile`.

The ratio is evaluated in log space; original zero cells are preserved and
lost-support/infeasible profiles are explicit conflicts, not clipped invented
evidence. Current source probabilities are intermediate profile constraints,
not final forecast targets. A single MR/BTTS axis reduces to the previous
region/odds likelihood-ratio identity. Multi-axis changes affect the same joint
law, so one axis can change another's outcome probability continuously.
The baseline is still the actual same-book path, never a zero or synthetic
history. Every path retains its physical book, actual contract and source clock.

Native whole/half/quarter Total odds use the existing push-aware Poisson
inversion to infer a total mean for each endpoint. The profiles use the same
`home+away` feature at both endpoints, avoiding a synthetic innovation merely
because the offered line changes. Those inferred means are not actual quoted
probabilities, and a flexible profile need not reproduce its original native
settlement share exactly. Profile residuals refer to fitted mean/partition
constraints. Finite-grid multi-axis dual changes need not equal the former
simple `mean ratio^(goals)` transformation.

Flat source axes retain endpoint context without freezing the original
forecast marginal. A nearly flat axis approaches the flat result continuously;
there is no exactly-flat-versus-tiny-tick model switch. All-flat, pure-vig,
no-history and complete round-trip paths preserve the exact original PMF.
Those cases report profile state `not_required`; they do not claim profile
fits that never ran. Each refresh starts again from its independent PMF, so
the same price move cannot compound on the previous final forecast.

This relative update deliberately does not solve a purely static absolute
model/book disagreement. Nor does a more frequent source poll prove outcome
reliability, or correlated MR/Total/BTTS data become independent corroboration.
No accuracy improvement or exhaustive future-scenario coverage is claimed.

## Publication defect discovered during verification

The normal12:17UTC November4 writer failed with
`positive-EV actionable coverage35/36`, then blocked fixture seeding and quote
journaling. The member board therefore remained at11:47 despite working lock
sweeps. That old universal gate conflicted with the already-authorized R21/R22
confidence Lean lane within an actual paired-book vig envelope.

R20's publication gate invokes the SAME grade function for current nonpositive
EV Leans and requires the current release, not-held tuple, identical evaluated
and current price, selected joint-PMF probability, correct exact EV and bound
market receipt. Total must still be official2.5. Negative-EV Best, unsupported
Double Chance and unqualified/malformed confidence Leans remain hard failures.
Actual negative EV stays negative in tracking; telemetry separately counts
nonpositive-EV actionables, qualified confidence Leans and invalid actionables.
Existing locked tuples retain their own release's authority and are not
reinterpreted by the current qualification function.

## Same-input prospective board comparison

Statistical source: four bounded BDL requests,117 current-season matches,
63 completed matches/126 team-stat rows; no production writes. Joined usable
training437 rows. Market source: existing immutable quote observations through
the actual11:47:47UTC member publication, with original stored-capture clocks.
No additional odds/history-provider requests and no historical accuracy tuning.
The same stored source families feed both old and new complete builders.
This is a functional comparison, not a claim that stored fallback paths are
identical to every live native provider response.

| Market | Before actionables | After actionables |
| --- | ---: | ---: |
| Match Result | 0 | 0 |
| Total | 3 | 3 |
| BTTS | 6 | 8 |
| All three | 9 | 11 |

Four promotions/two demotions, net+2; two side changes. No thresholds were
widened. All36selected prices and90side prices are present; no holds, price
regressions or publication errors. One actual negative-EV confidence Lean
qualifies under the existing policy rather than blocking the whole slate.

Independent examples: Madrid–AEK1.76–1.68→2.35–1.51; Arsenal–Slavia2.23–1.07→
2.17–0.75. The final common-law picks change Leipzig→Manchester City and
Arsenal-game BTTS Yes→No. All nine Totals remain Over2.5: the change contains
no forced Under quota. BTTS remains Yes on eight games, No on one, and the
No is Watchlist under the unchanged confidence/price requirements.

The decimal card's established minimum presentation adjustment can differ
from its PMF mean to align visible directions; both actual expected goals and
all pick probabilities remain in the shared score receipt. No card-only
numerical patch is used to generate the probability or side.

Detailed before/after27market tuples, prices, counts and actual publication
coverage are in the paired JSON artifact. Future results must be separated by
R20/R23 and locked timestamp; yesterday's outcomes are not a tuning set.

## Required verification / rollback

Focused tests cover opponent exposure, shared venue parameters, strict cutoff,
deduplication/conflicting labels, fit convergence, nonnegative normalized score
mass, strength-sensitive BTTS, public/local scale separation, canonical lineages
and source age, single-axis ratio limits, near-flat continuity, common feasible
subsets, zero-support/incompatible endpoints, repeated no-ratchet updates,
native Total provenance and grade symmetry. The existing UCL DB tests retain
writer immutability and exact legacy reader precedence. Publication tests
prove valid confidence lanes and reject altered probabilities, EV, source
direction, release, Best labels and current/evaluated price disagreement.

Publication additionally requires `npm run verify:model-change`, focused UCL
tests, production build/type/lint checks, independent review, latest-main overlap
safety, protected PR with exact head/tree, actual Vercel production commit and
normal scheduled writer/member/source/lock proof. No extra manual refresh is
installed. If normal cadence fails, diagnose the actual cause; do not restore
an old model silently or relabel a locked tuple.

Rollback is the complete preceding R19/R22/R12/R10/R21 family for future
unlocked rows through a protected PR, preserving all existing R20 locks exactly.
Hold on source identity errors, lost prices, incoherent PMF/side/score, profile
support failures masquerading as applied evidence, mixed-release publication,
unexpected grade flattening, writer overlap or lock mutation.
