# CBB private coherent market reader r5: scope and qualification

Owner explicitly requests continued market-reader integration, private only,
with Moneyline/Spread/Total consequences and one coherent final score. Base:
`7545f7438d41dedb6491e1c44191022b36aed05a`; isolated task branch only.
Incumbent is private `cbb_candidate_2026_10_28_r2_score_precision`.

No production route, cron, database writer, lease, shared inference registration,
live grade/stake, existing lock or other sport changes. Candidate identifier:
`cbb_candidate_2026_10_28_r5_coherent_market_reader`. This is not permission to
merge or activate. Keep r2 available for exact comparisons.

First inspect bounded Owls ncaab current odds/splits and history coverage and
game catalogs. Retain raw receipts and counts; never query canceled SharpAPI.
Initially cap discovery at eight provider requests. Expand historical capture
only after confirming coverage, pagination, timestamp semantics and exact
fixture identity, with an explicit bounded request budget. Unknown UTC archive
capture clocks are not silently treated as UTC. Book reputation is not proof
of leadership or sharp money. Missing splits are not invented.

Separate source/feature qualification from prediction authority. Evaluate
single coherent margin/Total outputs, deriving scores and all probabilities
once. All markets use the same game cut-off; exclude target book families from
reference-market inputs. Opposing signals, movement reversals, no-vig prices,
point-versus-juice moves, cross-market agreement and actual path missingness
are separate features, not a rigid automatic flip rule or fixed market blend.

Where historical market evidence is available, use chronological fitting,
selection and later evaluation grouped by game/date. The previously opened
2025 season remains retrospective; do not call it a pristine holdout. Do not
select settings on the final evaluation outcomes. Report each market's W/L/P,
net corrections/harms, Brier/log loss and score errors on exact paired cohorts,
plus coverage exclusions. Better scores alone cannot qualify worse picks.
Moneyline/Spread orientation must be independently verified; Total needs no
home-away inference. If rich chronology is unavailable, test the narrower
truthful information set and explicitly distinguish it from a full movement
reader. Never manufacture a historical reader to get a performance number.

Discovery result: old snapshot clocks are explicitly unknown; current ncaab
returns retail books but no Circa/Pinnacle or splits on the captured slate.
Therefore first test an honestly named opening-price reader, not full sharp
movement inference. Reuse the eight preselected Saturdays' existing BDL raw
opening capture. Independently corroborate fixture orientation against Owls'
exact named historical catalog; reject ambiguous/oppositely listed fixtures.
This is fixture-level corroboration, not exact selection-level book proof.
Keep that limitation explicit in all results; no live authority is granted.

Chronology: February 7/14 fit; February 21/28 select; March dates are later
retrospective evaluation. Reference quotes must have been opened by the same
target opening cutoff, exclude the target family, and be no more than 48 hours
old. No historical split or movement values are imputed. Joint residual heads
use no-vig Moneyline, Spread/Total line-plus-juice centers, disagreement,
dispersion, independent strength and interactions. Test ridge 10/100/1000 and
two depth-2 absolute-error tree heads (40/80 rounds, min leaf 50). Fit/select
one coherent margin/Total head, not three independently chosen winning picks.
Selection ranks aggregate W-L improvement with no individual-market loss,
then joint score MAE. Report rejected candidates, even if no candidate passes.

Historical catalog expansion: eight original UTC dates, full pagination,
at most 24 catalog calls. No new historical odds capture in this phase.

First-result continuation: score-error ridge heads lost picks on selection;
151 fitting games are below the existing tree trainer's 200-game minimum, so
the two trees are skipped without weakening that guard. Next test three joint
proper-log-loss residual heads (ridge 1/10/100, 500 fixed Adam iterations,
step 0.03). Their objective is the sum of exact conditional W/L log losses
across ML/Spread/Total; pushes carry no binary label. All probabilities come
from the same margin/Total and existing distribution, including integer-line
push and impossible basketball tie correction. No hand-set flip rule, fixed
market blend or target-book price feature is added. Selection and later dates
remain unchanged, with the selection set now explicitly reused research data.

Movement case replay: use the late catalog's actual exact fixtures with known
start times, without selecting by scores or performance. Retain opening plus
recent-window archived rows, maximum 60 sequential Owls requests and five
5,000-row pages per event. Keep partial pages as receipts but exclude incomplete
events. Only explicit recordedAtUtc at/before T-60 may enter the tape; never
convert unknown clocks. Reject inPlay=true, non-full-game markets, exchanges,
and ambiguous pairs. This small late-season set is a source/coherence case
replay, not a fitting cohort or a claimed general accuracy result.

Diagnostic continuation before later results: joint-log-loss heads gained two
Totals on selection but their margin changes harmed ML/Spread. Test component
ablations (margin-only and Total-only) for the same three frozen penalties,
without refitting or per-game outcome choices. This asks whether information
helps one dimension but harms the other. Rank eligible selection candidates by
net correct decisions then sum of conditional market log loss. An accepted
Total-only head still changes both team scores equally and leaves one coherent
margin/Total projection; it is not three unrelated predictions. Later March
results are not used to choose penalties or authority.

References: https://owlsinsight.com/docs (history clocks and exact sources),
https://www.jvlone.com/sportsdocs/GamblingBasketbal2013.pdf (market information),
https://arxiv.org/abs/1412.0248 (complementary predictive inputs).
