# DraftKings split restoration verification — October 31, 2026

Starting base: `88576d3cd169aa49b433080a6a5704a9aa058f6b`.
Owner asked to verify a provider email reporting DraftKings restoration around
4:50 p.m. Eastern on October 30 across NFL, NCAAF, NBA, NHL and NCAAB.

One authenticated read per sport at 13:50 UTC returned HTTP 200 and
`meta.books = [circa, draftkings, betmgm]`. The deployed parser accepted all
DraftKings rows with zero normalization rejections:

| Feed | DraftKings events | Two-sided market pairs |
| --- | ---: | ---: |
| NFL | 14 | 41 |
| NCAAF | 47 | 141 |
| NBA | 7 | 21 |
| NHL | 10 | 30 |
| NCAAB | 7 | 15 |

The NFL slate includes one started/locked event; current pregame market
availability is distinct from that immutable historical card. NCAAB has only
one supplied Total pair; absent markets are not invented. BetMGM currently
supplies tickets only, and is not treated as a complete money/ticket pair.
Circa appears in the catalog but has no NCAAB rows in this receipt. Per-book
source timestamps, rather than the response's older global `meta.as_of`, remain
authoritative. Raw receipts and bounded SELECT-only audit outputs are retained
under `/tmp/oddsphere-dk-restoration-*` without credentials.

Production durable feeds and `market_split_observations_v2` already contain
restored DraftKings evidence for all five sports. No Owls DraftKings rows were
found with source timestamps from October 26 at 12:00 UTC through October 30
at 20:50 UTC. This confirms the sampled stored source gap; it does not
independently establish the provider's exact outage/restoration minute. Existing
legacy locked records are retained exactly, without relabeling or backfilling.

The source wiring works without an endpoint or key change. NFL's actual member
path uses its durable source overlay, selecting fresh DraftKings when Circa is
past the existing source-failover window. NBA/CFB can retain fresh preferred
Circa, and NHL can use the existing DraftKings fallback. All named books remain
separate in canonical history; Public Consensus is not relabeled as DraftKings.

## Confirmed CBB display gap and bounded repair

The CBB board had zero named-book panels despite seven exact-matched captured
DraftKings games. Its dedicated reader displayed consensus and price history,
but did not attach restored canonical named-book rows. A same-board rehearsal
of the existing source selector found 15 available panels.

Reader r2 consumes the same already-batched canonical observations, with no new
provider call or database writer. It retains the complete same-source-timestamp
money/ticket pair, original time, exact canonical event/market/sides, source
identity and Circa→DraftKings→BetMGM priority. It applies the existing three-hour
named-book freshness window, rejects future receipts, mismatched/partial or
conflicting pairs, and converts stored fractional percentages to display percent.
Every already-locked or started public card retains exact object precedence.
Only `sportsbookSplits` and its availability presentation change; model inputs,
score, side, probability, quote, grade, stake and model/market marriage do not.
Model/calibration and writer releases remain unchanged; the authoritative reader
identifier advances in the same commit as the registry.

Verification gates: focused CBB source/percentage/chronology/priority/lock and
decision-neutrality tests, existing CBB provisional/writer/store tests, TypeScript,
lint, production build, frozen-production same-input replay, clean fresh-main
integration safety, protected PR checks and exact verified tree, then production
deployment and actual reader execution against live stored evidence. Rollback
only reader r2 to r1; never mutate stored locks, observations or outage history.
