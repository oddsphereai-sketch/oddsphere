# Market opposition repair — bounded production scope

Owner request: repair NFL, CFB and NBA market reading in the actual production
paths. Starting remote main: 95b9e7f35afa99ea6997ea091b30d22e859c00b5.
Own branch/worktree: codex/market-opposition-repair-20261031 at
/private/tmp/oddsphere-market-opposition-repair-20261031. Shared checkout untouched.

First implementation is NBA's confirmed reader-to-grade disconnect, not a new
score model or a claim that all three sports are repaired. NFL's reflection/
fallback and CFB's distinct calibrated reader require their own path-specific
changes and cannot inherit basketball authority merely from a shared idea.

Current NBA model/marriage/grade: r24/r25/r15. One existing prediction_pipeline:nba
writer, cadence, provider budget and locked precedence remain authoritative.
No new provider request, independent timer/writer, SQL, fit or outcome-driven
model selection. Old locked snapshots retain byte-exact precedence. NFL and
CFB live releases are unchanged by this NBA stage.

Observed TOR–ORL Oct30, external401909281: the stored r24 model predicted TOR by
8.7433 and left both ML−210 and Spread−5.5−110 at Best Angle. A book_disagreement
read remained unavailable despite stored named-book opposition. This is a
reader/grade plumbing case, not evidence of bookmaker intent or proof that an
ORL flip would have been correct. The original lock is not regraded or rewritten.

Repair contract: preserve the full incumbent reader, score, probability, pick,
price selector and economic grade calculation. Separately carry fresh stable
target-excluded named-book opposition to the grade owner, even when a mixed
market cannot qualify a forecast correction. An otherwise eligible Best Angle
with this opposition becomes an actionable Lean at its SAME probability and
price. No Lean, Watchlist, No Market or Held is promoted or demoted; no new
probability/confidence is manufactured. Supporting-only/missing/ambiguous
observations do not create promotions or erase opposition.

Use existing NBA chronology, persistence and meaningful-move definitions.
Spread/Total number movement with opposite-sign no-vig-price movement is
explicitly conflicting/unknown, not assumed to have the raw-number economic
direction. Missing or stale evidence is not an opposing observation. ML and
Spread remain distinct: cover resistance cannot by itself identify a losing
outright favorite. Public handle or named-book handle does not identify bettors.

Qualification is finite: actual stored TOR–ORL source/grade reproduction, stale/
future/excluded/price-compensated/missing/supporting/reversal negatives,
same-input current-board comparison through the production pipeline, unchanged
forecast/price/actionable invariants, both lock-writer and lock-reader tests,
focused/full checks and independent invalidation review. Required board impact:
zero actionable promotions, zero actionable demotions, zero net actionable
change; report Best Angle-to-Lean transitions separately. This is an uncertainty
classification repair, not a demonstrated accuracy gain. Reject any unexpected
forecast, quote, actionable or locked-record change.

Before publication: version affected NBA model/marriage/grade and the new
posture contract, update release registry, fresh-main integration/overlap proof,
protected PR checks, remote/local tree parity. Verify live releases, the sole
writer/lease, coverage, member/tracking coherence and next lock cycle before
calling this stage live. No claim of complete market coverage follows.

Provider-attestation correction before publication: legacy trails merge sources
by sportsbook and discard provider/run lineage. New posture evidence instead
uses the same pair/trail computation on distinct provider/book/event/run lanes,
requiring complete unique pairs and no contradictory provider lanes for a book.
The incumbent mixed-provider forecast path is NOT silently changed by this
grade-only stage. r1/r2 endpoint-only audit receipts do not prove this contract;
they remain unchanged and superseded. r3 reuses the frozen17 game records,
reads complete named-book chronology with stored provider/run IDs before each
original cutoff, and uses the exact production attested-trail builder.
This bounded recovery permits40 SELECTs/16MiB/3,000 rows per game, no new
provider requests, outcomes or DB writes. It neither changes the original
records nor reclassifies the seven open records as historical locks.

## Actual retained-input result (r3)

Provider-attested production-builder comparison:17 unique games/51 markets,
10 locked games and7 unlocked. All incumbent grades reproduce exactly from
the stored grade inputs. Source recovery used25 SELECTs/4,155,846 raw bytes.
Earlier r1/r2 used35 SELECTs/591,795 bytes combined and are superseded, not
rewritten. Total successful DB calls in these three executions=60; raw
response bytes=4,747,641. Paid-provider calls, fits, outcome labels, DB writes,
prediction updates and lock mutations=0.

The30 locked-market historical hypotheticals change Best Angles7→3 and
Leans4→8. TOR–ORL ML/Spread, CHI–BOS Spread and IND–MIA Spread are the four
transitions. They are NOT corrections/replacements of those actual locks.
The21 unlocked markets retain2 Best Angles/3 Leans with zero grade change at
their original retained cutoffs. Both strata have zero actionable promotions,
zero actionable demotions and identical all-actionable counts, picks, prices,
probabilities and effective confidence. No accuracy/ROI gain is inferred from
this classification-only comparison. It is not a whole-writer raw-input replay.

TOR's attested Circa Spread movement remains opposition. Pinnacle's Spread
number/endpoint-price changes are explicitly conflicting rather than blindly
counted as a second independent agreeing vote; its ML price lane opposes TOR.
The model may remain a favorite while cover evidence resists it. This is not
a rule to follow/fade every favorite or to flip to the eventual winner.

Private receipt root: /private/tmp/oddsphere-nba-opposition-evidence-ISrlzE.
Source r3 SHA256685b5a6011eb5c1dbf6e5fbe624e2e6dcaa603c9fb7f7c04969b5dc8475923d1.
Comparison r3 SHA2568e18dfb5b12ce33747e50a88b998547c05e33285f21127e1fa56c8b8209b94d4.
The runtime operator's URLSearchParams type spelling was corrected after its
first execution; that does not change the returned receipt into an execution
of later code. r3 is the provider-attested execution; r1/r2 are not qualification.

## Verification and remaining boundary

TypeScript, focused lint (one pre-existing unused _quickRead warning), targeted
reader/grade/production-assembly tests and lock-reader/writer lifecycle suites
pass. The full model-change suite passes with the new288 paired-grade cases
included. The tests additionally cover mirrored home-underdog/away-favorite
roles, compensated prices, provider/run/event/duplicate/unknown-provider
negatives, a posture-bearing unlocked recomputation losing to an exact legacy
lock, and unchanged scores/picks/probabilities/quotes/effective confidence in
the production candidate→intelligence→grade→member-signal path. PostgreSQL
proof remains explicitly skipped because MARKET_BRAIN_POSTGRES_URL is unset.

A bounded independent reviewer found no remaining specific invalidator in this
first-stage uncertainty path after the provider fix. This is NOT endorsement
of full forecast repair. The larger requested score-response/Spread-crossing/
ML-winner-authority work is still unresolved. A half-point change and mixed
ML quotes do not uniquely identify a corrected score, cover probability or
upset probability; no new calibrated mapping was invented here.

Remote main recheck remains95b9e7f3. GitHub connector protection lookup returns
403 (integration lacks administrative visibility); branch-protection and
strict up-to-date enforcement therefore cannot yet be confirmed for merging.
No bypass is authorized. Existing open research/governance PRs touching the
release registry must rebase/reconcile before either merges. Do not claim this
candidate, let alone the complete reader, is live or launch-ready from local
tests. No change to NFL/CFB or broader NBA forecast authority is in this branch.

Local checkpoint547899b3 is clean and unpublished. Final code reproduced all51
r3 posture outputs from the frozen source with zero network calls/writes and
without rewriting receipts. Full model-change suite r2, TypeScript and focused
reader/grade/production/lock tests pass. Source receipts remain as originally
executed; the separate51-case check proves posture parity under the final code.

Clean-commit integration safety FAILED because another task's
codex/all-market-data-health-20261031 has overlapping uncommitted release-registry
and model-safety documentation. Its soccer implementation is separate, but both
sets of documentation must be preserved. No other task's work was committed,
cleared, reset or copied over. The owner was asked for coordination permission
with "Investigate Green Bay no-play grades". Until overlap is reconciled and
latest-main/integration checks rerun, do not push/merge/publish this candidate.
This is an additional publication boundary, not the reason the larger forecast
repair is incomplete. No PR, deployment or production writer invocation occurred.

## October 31 follow-up: side neutrality and false confirmation

The owner additionally rejected automatic favorite following. The complete
reader→candidate→score/probability path now has360 reflected home/away cases
across independent margins, posted Spreads and two movement axes, plus360
controls that change only which current ML price is shorter. Mirrored cases
reverse the margin, team scores, ML/Spread probabilities and sides, preserve
Total, and retain source-posture symmetry. Quote-only controls preserve every
forecast and side. Both favorite and underdog ML/Spread selections occur.
These are implementation invariants, not evidence of predictive accuracy or
an endorsement of the incumbent's numerical score-response thresholds.

Fixed another specific signal defect for new posture-bearing snapshots:
positive model value or an actionable grade no longer fabricates sharp
confirmation. Actual supporting-only posture can confirm; opposition resists;
empty, conflicting or wrong-market/wrong-pick posture remains neutral/mixed.
Direction and economics remain separate: observed confirmation can exist on
a Watchlist, and a Best Angle need not have observed sharp confirmation.
Legacy no-posture compatibility behavior and exact locked-card precedence are
unchanged. Focused production-assembly, direction/value and locked-reader
tests pass. A bounded independent invalidation review found no specific
semantic or lock regression in this delta, without endorsing full forecasts.

Production main advanced to506315ba (#893). Merge checkpointa8e02dc0 preserves
the entire soccer/MLB health repair and both shared release/safety entries.
Integration safety passed at that clean checkpoint. The earlier403 API
protection visibility gap was resolved read-only through the existing signed-in
GitHub browser: main rule82075762 requires PRs, current-main-ancestor from
GitHub Actions and strict up-to-date branches, prohibits bypass, and disallows
force pushes/deletions. No setting was changed or saved.

The retained raw17-game source was also inspected for extending attested lanes
into existing forecast permission. All original stored Spread/Total decisions
had zero applied score corrections. Ordinary valid movements commonly remain
below incumbent2/5-point authority; some endpoint number/price directions are
conflicting, and one two-point Pinnacle Spread trail has only0.5346 persistence.
This inspection made no source, receipt, forecast, lock or database change.
It does not justify relaxing those numerical rules, choosing a correction
amplitude or forcing Toronto to flip. Full source-specific conditional forecast
response remains unresolved and is NOT implemented by this first-stage branch.

## Full-forecast work: bounded real-source cohort capture

Draft PR895 remains a prerequisite, not launch approval. The next experiment
must use actual decision-time named-book observations rather than substituting
the old public-consensus proxy or changing the2/5-point rules by intuition.
A SELECT-only metadata inventory found71 unique locked NBA ML game records
from October20–29 across eight capture-era releases (13,275 response bytes,
one successful request, zero outcomes/provider calls/writes). They are not
pooled and advertised as current-r24 performance. The independent head and
capture clocks must be checked per row before any estimator receives authority.

Capture phase is frozen before outcome retrieval: at most128 locked games,
160 SELECT requests,64MiB raw response data,3,000 named-book price rows/game,
one original stored ML snapshot per game, and no provider requests, outcomes,
fits, production writes, refreshes or lock changes. Recover full provider/run
chronology only before the original reader/lock cutoff. Reject ambiguous,
late or duplicate captures; expose ineligible rows rather than silently filling
them. Use exclusive-write private receipts and SHA256 manifests. No new live
model path, shadow payload, cron, writer or database schema is authorized.

Before fitting: freeze eligible membership, source hashes, features, estimator
recipe, chronological train/calibration/confirmation boundaries and pass/fail
criteria. Same-cohort results must report both scores and proper ML/Spread/
Total probabilities plus exact-line decisions and board counts, stratified by
capture release. Real source-specific behavior cannot inherit qualification
merely because a consensus-only model looked better on score error. Do not
repeatedly open a holdout or force known Toronto outcomes. No fitted candidate
is activated solely by this capture plan.

Capture result:71/71 pregame clocks validate;15 games have current-provider
attested trails. Source SHA256
6f96d23ce033076034d9911fc2c4cbbaca36ee8de98d5e94050fc28cb719fddc;
locked-inputs SHA256
f3cad8ecb36d8cb68f7cc7b2d8466f728b6e8d8f03a538733d769e9cb6181172.
Private root /private/tmp/oddsphere-nba-forecast-J3aNUx. Capture used75 SELECTs /
7,065,169 raw bytes; the metadata inventory used one request /13,275 bytes.
A12-row older-source sample used2,084 bytes and showed legacy_unattributed
with null provider-event/run. A final bounded inventory over all56 games
without attested rows found zero already-stored non-null event/run rows
(one SELECT /2 bytes). V51 explicitly prohibits inventing that lineage.
No outcome, fit, paid-provider request, prediction or lock write occurred.

The next conditional-distribution kernel is implemented ONLY under
scripts/operator/nba/nbaAttestedForecastDistribution.ts, not imported by any
writer/member/runtime model. It maps exact number+juice into an equivalent
location under a frozen residual CDF, keeps one independent component and
source-specific components, and derives ML/Spread from one margin CDF. A
single source and arbitrarily small observations can affect that distribution;
no two-book vote or2/5-point permission gate is embedded. Future source logits,
fusion, movement response, scales and age response must be learned/sealed,
not presented as human-authored calibrated beliefs. The product copula is
explicit; unlearned cross-axis correlation/full path response is not claimed.

The pure prototype returns a representative median-based score because a
skewed mixture's expected margin can disagree with the majority win/cover
probability. Expected means are audit-only; no0.25-point crossing is invented.
Synthetic tests cover that counterexample, direct ML and Spread crossing,
continuous small-signal response, missing dimensions retaining exact prior,
source/future/duplicate negatives and home/away reflection. These are NOT
fitted coefficients or a predictive result; productionQualified is false,
and no production artifact or shadow snapshot is emitted. This is a concrete
forecast implementation substrate, not launch readiness. The original
grade/signal prerequisite remains draft PR895, unmerged.

## Scenario-to-consequence ledger (not a resolved-scenario count)

An observed label is not a completed decision response. NFL/CFB ownership is
in the coordinated Rebuild chat; this table describes NBA only. Source health
and future/outcome contamination are validity constraints, not numerical
sharp-signal voting quotas. No table row grants itself prediction authority.

| Observable family | Incumbent forecast consequence | First-stage repair | Offline distribution / remaining gap |
| --- | --- | --- | --- |
| Named ML moves against a pick | No direct ML score authority | Real opposition can lower Best to Lean | Direct ML may move one shared margin CDF; unfit |
| Sub-two-point Spread change | No score response | Meaningful observed opposition survives mixed-reader failure | Continuous source-level/price response; unfit |
| Number and juice compensate | Raw-number forecast may still qualify | Conflict is not claimed as two agreeing votes | Equivalent location uses both number and juice; unfit |
| Favorite wins but may not cover | Narrow Spread read may flip cover; ML indirect | ML/Spread opposition kept separate | ML/Spread use one CDF, not one side label; synthetic proof only |
| Public/named handle pressure with a held line | Some reverse-flow labels; no general response | No new split-only score authority | Flow-volume and non-movement interactions NOT implemented |
| Named leader, retail follower, book disagreement | Qualifier uses breadth/disagreement | Provider/run/book lanes preserve disagreement | Full lead/lag and independent-source information NOT implemented |
| Reversal, partial/full buyback, recent onset | Broad categorical veto/persistence rules | No false stable-opposition claim after detected reversal | Kernel uses endpoints/age; full path response NOT implemented |
| Independent disagreement/uncertainty | Independent score owns default outside gates | Model value no longer called sharp confirmation | Learned source reliability/fusion/scales NOT fitted |
| Missing splits or only one real book | Prices can still qualify subject to old gates | Valid price posture does not require splits | One source may affect a marginal; missing dimension retains prior |
| Exact price changes without new direction | Grade/economics only | Confirmation is independent of grade | Final exact-quote grading/board integration NOT implemented |
| Favorite/underdog and home/away roles | Existing side laws |720 neutrality controls pass | Synthetic reflected CDF/score controls pass; no accuracy claim |
| Locked public record | Stored payload must win | Writer/reader immutability tests pass | No kernel writer or production artifact exists |

The independent reviewer proposed a development experiment, not a deployment
exception: keep older observations explicitly legacy_unattributed_book_level,
require unambiguous exact canonical-market/capture pairs, use the same36h
capture-time window in both cohorts, tie most parameters globally and reserve
all15 attested games for a single descriptive transport check. A pass cannot
be called current-r24 performance (12 attested games are r22; only3 are r24).
No arbitrary80/30/60 sample quorum, new95%-every-metric threshold, production
shadow or automatic live approval was adopted. Features/recipe/splits must be
frozen before labels, with adverse proper-score/ML/Spread/Total results a
rejection, not an invitation to retune the same confirmation data.

Git-only inspection of release-introduction main trees finds the same five-file
score/feature/roster blob fingerprint for r17/r18/r20/r21/r22/r24
(3d8a08ea4a16b2722d8a974bc51d4a4882732ec5ed442c762e37162c76caba24).
R11/r15 omit the roster layer and have a different fingerprint. This is a
reconstructed code-tree comparison, NOT a fingerprint stored in those locks,
not proof of identical raw inputs, and not permission to pool capture eras
and advertise them as current-model results. Outcome labels remain unread.
