# NBA historical player-state sources and fixed replacement heads

November 20, 2026. Continuation from production base
`1c928498556b0d02b1b8a169a877114a73cacfb5`. Research only; no production imports,
model/grade/stake changes, provider schedule, database writes or locked repairs.

## Data actually acquired

The existing BALLDONTLIE subscription supplied both 2023-24 and 2024-25 seasons'
traditional and advanced player records, all 60 annual team contract sets, and
159 prior-season game samples. Bulk capture completed 1,777 requests with one
worker and at least 500ms between starts, stopping on rate limits. Ten additional
bounded identity searches preserve both the five empty full-name queries and
the five successful documented first/last-name filter queries. Earlier probes
are separately retained; this is not a claim that total source exploration used
only 1,777 requests. No purchase, subscription upgrade or AI inference occurred.

| Captured family | Rows | Source-game IDs |
| --- | ---: | ---: |
| 2023 traditional | 43,615 | 1,237 |
| 2023 advanced | 34,843 | 1,319 |
| 2024 traditional | 43,609 | 1,237 |
| 2024 advanced | 35,103 | 1,321 |

These are source counts, not an admitted training cohort. Advanced includes
postseason records; non-postseason games includes play-ins and the Cup final.
The official archive plan covers 2,462 games through each regular-season end,
including Cup finals 8258317 and 17195500. A regular-season target cohort must
exclude those two finals and later play-ins explicitly, without discarding
source evidence. Target-game results/participants can never enter its features.

Original NBA static PDFs yielded 1,138 injury reports covering 2,459 game
cutoffs. Every available report passes printed-date, URL-date, embedded PDF
creation, original HTTP modification, own receipt, raw byte-count and checksum
checks. All 2,459 selected source-availability clocks precede cutoff. One report
returned HTTP403 and stays unavailable. The plan intentionally selects an earlier
hour report; this does not prove it captured every later revision before T-60.
Old `05PM` filenames can mean printed 5:30pm; filenames alone are not clocks.

All 1,138 available reports parse across pages. Exact target date/orientation
matches find both submitted team sections for 2,415 targets. The other 44 have
missing sections, often because a team has no listed injury; they are **not**
silently converted to healthy or complete availability. Questionable, Doubtful,
Probable, Available, Out, original reasons and unsubmitted sections remain distinct.
The parser preserves PDF text order with geometry-owned columns: a multiline
reason can begin above its vertically centered player label. Sorting only by Y
misassigns that reason. Wrapped and page-continuation regressions cover this.

There are 2,462 successful original final gamebooks. Six initial network failures
succeeded on one bounded retry, with originals and separate retry receipts kept.
Gamebooks contain exact minutes, box scores and play-by-play. They are potential
evidence for **earlier completed games only**, never target-game active lists,
starters, DNP reasons or actual minutes.

The official NBA movement feed provides 10,150 dated events since 2015, including
1,917 from July 2023 through June 2025. It was fetched in 2026, is mutable, and
its transaction dates do not contain an intraday publication clock. It is not
an original T-60 receipt. Same-day moves cannot receive invented execution times;
contract expirations and same-day ordering still need an explicit adapter.

## Membership and identity work

The original NBA-authored October 23, 2023 opening-roster PDF contains all 30 teams
and 525 members. It preserves inactive/two-way lists as membership, not permanent
OUT designations. PDF geometry plus independently verified NBA-native names
separate two combined adjacent-column cells. The introduction's NEW YORK is not
a team header. An actual source typo, `Chis Livingston`, remains unresolved.

The NBA historical player index supplies 5,200 native identities. A cross-provider
bridge uses a unique draft-year/round/pick plus surname, or unique full-name,
college and country facts. Optional Jr/Sr spelling is normalized, while II/III/IV
remain identity evidence; Gary Payton II cannot join his father. Ambiguous
biographical or reverse-ID matches are rejected. Current team, jersey, active
status, salary and performance never participate in this identity bridge.

The latest real join maps 707 of 719 paid-source historical identities and fully
resolves 24 opening teams. Seven roster names remain unresolved across six teams:
Nate Williams, Chis Livingston, Charlie Brown Jr., Azuolas Tubelis, Ishmail
Wainright, Charles Bediako and Sir'Jabari Rice. No fuzzy identity was invented.
Historical BDL nested `player.team_id` is current 2026; row-level `team.id` owns
historical stat membership. Annual contracts include trades/dead salary and are
not full effective rosters. Using either shortcut would contaminate this ledger.

Three images of the NBA's October 21, 2024 full opening-roster release were recovered
from an archived mirror that links the original NBA Communications post. They
were visually inspected and retained, alongside successful local OCR output.
The low-resolution OCR is incomplete/inaccurate, and the original post was not
retrievable for byte/publication verification. The images are useful source
leads, **not** an admitted complete 2024 effective roster or verified timestamp.
Dated official team announcements provide further checks for GSW, SAS, CHI, WAS and SAC.

## Concrete replacement implementation

`nbaExpectedRotationResidual.ts` implements the October 29 predeclared six-feature,
zero-intercept margin/Total residual heads at alpha 1000. It accepts only a matching
qualified frozen player-state ledger. The gate runs before reading training
outcomes. Training must precede the 2023 selection boundary, use one portable
baseline release, respect feature/training cutoffs and final-availability clocks,
and contain unique native games. Selection/replication/current outcome rows cannot
be training inputs. Replay summation order, fitted head, training rows, ledger and
input snapshots have deterministic hashes. No threshold, cap, price input, feature
search, probability for questionable players or play-grade promotion is added.
The apply path rejects altered heads, mixed baseline releases and pre-training
cutoffs; a zero rotation shock preserves both baseline scores exactly.

Only analytical synthetic fixtures were fitted to test the solver. No historical
outcomes have been fitted. The current strict observation ledger still refuses
2026-fetched mutable statistics at 2023 cutoffs. Verified old primary-document
publication evidence is stored separately with its **actual 2026 fetchedAt**;
there is no backdated receipt, unsafe historical-admission shim or waiver of the
original 1,000 complete selection / 300 verified-change gates. Those data gates
remain closed pending effective membership, availability semantics, historical
player-impact/result-availability validation and earlier training-season evidence.
This release therefore makes no claim that the accuracy problem is fixed.

## Retention and validation

The private content-addressed manifest covers 15,649 artifacts / 494,024,121 bytes,
excluding the disposable Swift compiler cache. Manifest SHA256:
`f39aededbcf0a7cfac8846636ed52df716f4b91a9086f8456f49a52c4964d642`.
Original PDFs, compressed paid JSON, own HTTP receipts, failed attempts, probes,
normalizations and collector code stay outside Git under ignored
`ops-local/learning-lab/nba-historical-player-state-20261120`. This is a bounded
local research capture, not additional production memory, polling or a new writer.

Focused source, identity, chronology, rotation, retained-stat, frozen-evaluation
and fixed-head tests pass. A bounded TypeScript project for these sources/tests
and focused ESLint pass. The whole-repository TypeScript run hit its default
Node heap limit; it is not counted as a pass. Full model-change, full-app type/
build, fresh-main protected integration and actual live verification remain
mandatory for any later production activation. The draft must stay inactive.

Primary references: [BALLDONTLIE API](https://docs.balldontlie.io/),
[original NBA injury report](https://ak-static.cms.nba.com/referee/injury/Injury-Report_2023-10-24_05PM.pdf),
[original final gamebook](https://statsdmz.nba.com/pdfs/20231024/20231024_LALDEN_book.pdf),
[NBA movement feed](https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json),
[2023 NBA-authored roster PDF](https://bloximages.chicago2.vip.townnews.com/tucson.com/content/tncms/assets/v3/editorial/b/52/b52fd976-71ff-11ee-8fbf-d7479459d4aa/653708216e38d.pdf.pdf),
[official 2024 GSW announcement](https://www.nba.com/warriors/news/warriors-announce-2024-25-opening-night-roster-20241021),
[official 2024 SAS announcement](https://www.nba.com/spurs/news/spurs-announce-2024-25-opening-night-roster).
