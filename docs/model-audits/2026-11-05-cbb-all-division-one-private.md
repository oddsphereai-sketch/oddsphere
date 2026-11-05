# CBB all-Division-I coverage: owner-approved publication review

Status: **owner-approved for November 5 and future publication; deployment verification pending**. The owner stopped changes to the
November 4 board and directed this repair toward November 5 Eastern and later.
At review time, no production forecast, grade, lock, tracking row, or board had been written by this work. On November 5 the owner explicitly instructed: “finish the review and get it live for November 5 and future slates,” preserving November 4 locks and requiring actual predictions rather than empty cards. That authorizes the scoped publication below; required integration, protected-PR and live verification still apply.

The dedicated branch is `codex/cbb-all-d1-opponent-coverage-20261104`, originally
based on main `a3dc79f9d8ce4aba812b5f9b8328d4a93328ec8c`. The shared primary
checkout was not edited. The separate contextual-market-reader work must be
integrated from a fresh main and reviewed before either overlapping change is
published.

## Repair and source coverage

The prior historical normalizer required both teams to have provider conference
IDs. The publisher also required a quoted wager before admitting a new game and
a non-Held priced evaluation before publishing it. Consequently a legitimate
D1/lower-division game could have a schedule entry without a real prediction.

The candidate uses the official 2026–27 NCAA MBB census: 365 programs, including
reclassifying institutions. Provider conference flags are not membership proof.
West Florida, BDL732, is a current D1 program despite its missing provider
conference. Centenary (LA), BDL369, is not a current D1 member despite its provider
conference. All 365 NCAA org IDs and exact institutional names map bijectively to
BDL IDs/names in the frozen source fixture. The default 362-team ESPN catalog is
retained only as an explicitly incomplete test fixture, never as membership
authority.

Frozen source fixtures are in
`scripts/fixtures/cbb-cross-division-20261105/`. The source-capture work used nine
bounded BDL fixture/history reads, ten bounded box-score reads, and 95 free ESPN
scoreboard reads. No provider credentials are stored in these fixtures. An
additional read retrieved only the existing current-season training snapshot:
139 games, updated November 4 09:02:33 UTC. It made no provider request or
production write.

The historical capture contains 237 actual cross-division games and 474 team box
rows. Strict final-score, regulation/OT, possession, four-factor, paired-school,
venue and official-time checks accept 229 games involving 59 lower institutions.
The complete incumbent R4 preseason state reproduces exactly from the existing
22,777-game normalized history and both prior verified venue patches. The lower
prior is then fitted against the appropriate 2024 and 2025 D1 end-season states.
That is legitimate preseason parameter estimation for 2026; it is not evidence
of what a forecast would have known before those historical games.

The frozen November 5 ET capture contains 65 eligible games: 43 D1/D1 games and
22 D1/lower-division games. All 65 produce complete private statistical forecasts
and member DTOs. The private publisher fixture produces 65 forecast cards and
zero schedule-only cards, with no market prices fabricated. It uses the existing
writer, existing calls, existing cadence, and existing sport-scoped lease. The
board preview reuses `EdgeBoard`; no production page or card redesign was made.

West Florida's missing program prior uses actual published adjusted offensive
efficiency, defensive efficiency and tempo from the captured Bart Torvik 2027
JSON. The scale translation is fitted on 364 exact incumbent school pairs and
does not replace incumbent ratings. The actual source observation clock is
November 5 04:03:53 UTC, not an invented offseason timestamp. Its bridge residual
variance is not an entrant-specific calibrated uncertainty estimate; no ad hoc
ridge-based uncertainty shrink is applied.

Primary sources:

- NCAA census: https://web3.ncaa.org/directory/api/directory/memberList?type=12&division=I&sportCode=MBB
- Published program statistics: https://barttorvik.com/2027_team_results.json
- Exact paired event receipts retain their ESPN scoreboard URLs and observation clocks.

## Prediction, wager and tracking boundaries

One lower-opponent posterior supplies both projected scores, margin, total and
winner probability. Current cross results update only that opponent's posterior;
they are stored separately from D1/D1 training and are bound in the forecast
receipt as exact current-history rows plus posterior mean. The D1-trained
nonlinear score correction and numerical market-reader adjustment are not
transferred to the cross domain. Actual quotes, splits and paths remain display
evidence through the existing reader.

A complete game forecast can publish without odds. Its explicit winner and
probability are frozen separately from sportsbook wager rows. No spread line,
total line, odds, EV, stake or betting recommendation is invented. The new
cross/newcomer forecast-only board holds all wager decisions, including when raw
quotes exist; it nulls selection, decision line, price, probability and EV while
retaining the actual observed quote. Only its separately frozen model winner can
enter W/L tracking at null odds and null units. Spread and Total records require
an actual qualified wager decision. A quoted Hold cannot leak into unit tracking.

Existing incumbent D1 forecasts and grading mathematics remain unchanged for
identical inputs without newcomer D1 training rows. Tests establish exact
numerical parity on all 43 November 5 incumbent matchups using both no current
history and the actual 139-game current receipt. This is a conditional parity
claim: once actual newcomer D1 results enter opponent-adjusted training, their
program-specific prior can change other D1 ratings under R5. The release is
versioned accordingly; unconditional R4 parity is not claimed.

No new cross/Newcomer actionable promotion has been qualified. No existing priced
incumbent grade policy is demoted or promoted by this patch. The private
forecast-only preview deliberately loads no consumer price feed and cannot be
used as a live actionable-board count comparison. A future live proposal still
requires a same-input priced board comparison and explicit promotion/demotion
report. Do not manufacture a compensating play quota.

## Locks and future ingestion

Expanded eligibility and score paths begin at the **November 5 Eastern slate**,
not the UTC date. November 4 games shortly after UTC midnight cannot enter this
new path. Existing locked member payloads return before any candidate, adapter
or model recomputation. The new reader behavior requires the explicitly stored
`gameForecast` release; it cannot retrospectively infer or relabel an older lock.

No new forecast may be created inside the existing one-hour lock cutoff. An
unknown official school, missing official team ID, ambiguous duplicate event,
wrong orientation, or unconfirmed kickoff cannot be repaired by guessing. The
seeder may fill a missing abbreviation only from the uniquely bound official
event's actual code. Baptist (FL)'s BAP abbreviation is captured that way; no
logo URL is invented where the source has none.

New current-season training receipts enforce NCAA D1/D1 versus cross partition
membership, disjoint IDs, and no duplicate games. Legacy receipt compatibility
and all existing locked snapshots are preserved. Frozen-winner tracking checks
the canonical team IDs and display names, stored probability, score uncertainty
law, original lock clock and idempotent existing tracking row.

## Honest limits and release readiness

All 229 fitted historical cross games were D1-home wins. Six November 5 lower
opponents have no accepted school-specific history and therefore use the actual
lower-division population prior with between-school uncertainty. That is not
school-specific statistics, nor a proven tail or upset calibration. The remaining
school samples are sparse. Population selection and hyperparameter uncertainty
are not fully estimated. Four later lower-home fixtures extrapolate outside this
historical venue domain; their receipts explicitly disclose that domain. The
newcomer source is early-season current strength and is also provisional.

The existing forecast-only solution is reproducible and source-backed; these
limits cannot be turned into a claim that every opponent has equally rich data
or that a new win rate has been proven. No accuracy improvement, guaranteed
winner, or qualified cross-domain betting edge is asserted.

Functional verification includes actual-source prior reconstruction and hashes,
365 exact memberships and published-statistic rows, 65 coherent forecasts, 43
incumbent numerical parity cases, exact future lock precedence, wrong-school /
wrong-time / missing-ID / duplicate-event negatives, cross input-key binding,
quoted-Hold isolation, null-price winner settlement, legacy tracking, and current
training partition rejection. The focused tests, TypeScript, changed-file lint
and full model-change gate are run from this private worktree. These checks are
functional proof, not clearance to deploy. Browser visual review of the local
HTML was not completed: browser policy rejected file-protocol navigation; no
alternate server or browser workaround was attempted.

Before merge: complete the real card/reader review; reconcile the overlapping market-reader chat;
resolve/integrate fresh main; rerun affected checks; commit a clean intentional
candidate; pass integration safety and protected PR checks; preserve the owner-approved forecast-only scope; and verify the normal writer, lock sweep,
release/data/reader coverage and unchanged old locks after deployment. No extra
refresh/provider approval is carried forward from earlier one-cycle approvals.

The release registry lists the publication identifiers. Do not report them as live until the actual deployment and normal writer are verified.

## November 5 current-input publication comparison

At 12:06:33 UTC, the frozen source comparison used the actual 149-game current
training receipt, the 43 existing stored input keys, original executable target
quotes, professional references, native path tapes, source problems and split
contexts. Each bundle was passed unchanged to the incumbent R18 and candidate
R19 paths. All 43 original independent input keys matched. Across 129 priced
market axes, both outputs had 68 Leans and 61 Watchlists: 0 promotions, 0
demotions, 0 side changes, 0 score changes. This is a same-input functional
comparison, not a claim of improved winning accuracy. The new 22 cross forecasts
add no unqualified betting actionables.

The official current November 5 scoreboard contains 65 events and the actual
provider capture supplies those 65 model fixtures. Canonical storage also has
an orphan Grambling–Jarvis midnight entry that neither current source supplies;
normal source coverage excludes it without deleting any canonical/locked row.
An actual later Texas Southern fixture with an unconfirmed official tip tests
the same publication boundary: it remains an internal data finding until a
complete forecast can be published, rather than creating an empty public card.

The prepublication lock baseline contains 148 existing frozen CBB member
records, including all 10 November 4 locks. Their complete sorted-payload SHA256
values are saved privately for exact post-deployment comparison. The read made
zero paid provider requests or production writes. Existing normal collection,
lease, schedules and lock cutoffs remain unchanged.
