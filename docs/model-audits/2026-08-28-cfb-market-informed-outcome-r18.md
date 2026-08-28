# CFB market-informed outcome forecast r18 result

Date: 2026-08-28

Status: qualified integration input; not published by this branch

## Frozen evidence

The predeclared r18 contract passed its current-board coherence gates on a
SELECT-only replay of 208 immutable production evidence rows. The replay made
zero provider calls and zero writes.

- Slate: 8 games / 24 markets.
- Exact-price decisions: 21 evaluated and 3 unavailable, all three belonging
  to the SJSU-USC market gap that is repaired in the separate ingestion lane.
- Existing grade counts remained byte-identical: 1 Best Angle, 4 Lean,
  6 Watchlist, 10 evaluated No Play, and 3 unavailable.
- Promotions/demotions: 0 / 0.
- Independent team-score standard deviation: 7.2589 points.
- Market-informed primary team-score standard deviation: 9.6685 points.
- Primary margin standard deviation: 12.8230 points.
- Primary total standard deviation: 5.1586 points.

Every current PMF passed mass, expected-score, expected-margin, expected-total,
winner-probability and reachable representative-score identity checks. All of
those outputs were recomputed from the same joint PMF.

## Current primary outcome replay

| Matchup | Expected score | Expected margin | Total | Home win | Representative |
| --- | ---: | ---: | ---: | ---: | ---: |
| UNC at TCU | UNC 19.1 - TCU 27.7 | TCU +8.6 | 46.9 | 70.9% | UNC 19 - TCU 28 |
| SJSU at USC | SJSU 12.2 - USC 50.7 | USC +38.5 | 62.9 | 99.5% | SJSU 12 - USC 51 |
| NC State at Virginia | NCSU 23.8 - UVA 27.8 | UVA +4.0 | 51.7 | 60.6% | NCSU 24 - UVA 28 |
| Jacksonville State at NDSU | JXST 19.9 - NDSU 26.9 | NDSU +7.0 | 46.8 | 67.2% | JXST 20 - NDSU 27 |
| Sacramento State at EMU | SAC 22.1 - EMU 31.6 | EMU +9.5 | 53.6 | 72.9% | SAC 22 - EMU 32 |
| Hawaii at Stanford | HAW 22.4 - STAN 26.4 | STAN +4.0 | 48.7 | 60.5% | HAW 22 - STAN 26 |
| New Mexico State at Florida State | NMSU 11.7 - FSU 43.8 | FSU +32.1 | 55.5 | 98.8% | NMSU 12 - FSU 44 |
| Memphis at UNLV | MEM 26.0 - UNLV 30.5 | UNLV +4.5 | 56.6 | 61.5% | MEM 26 - UNLV 31 |

The SJSU-USC row above used the evidence-time Playbook fallback anchor
(-38.5 / 61.5). The integration lane has since recovered a target BetMGM
-39 / 60.5 tuple whose Spread and Total lines are separately corroborated by
at least two exact-line conventional non-target books. The resolver now marks
that path `exact_target_book`; the integration must rebuild the row from that
exact anchor before publication.

## SharpAPI split audit

A bounded read-only probe confirmed that SharpAPI does currently serve NCAAF
splits. One league request returned 11 complete events across moneyline,
spread and total, all sourced from DraftKings at that capture. Strict identity
matching found 0 of the eight Saturday slate games at the probe timestamp;
the returned rows were Friday events. Accordingly, the integration must not
fabricate current-game Sharp coverage or relabel Playbook consensus as Sharp.
The strict client may attach a row only after exact team/date identity succeeds.

## Decision

Qualified for integration as the two-axis member outcome contract:

1. Primary score, projected winner and outcome probability come from the
   coherent market-informed r18 joint PMF.
2. The independent football-only score remains visible as secondary model
   evidence.
3. Exact-price market probability, fair probability, EV and Bet grade remain
   separate and unchanged.

This branch intentionally does not edit the writer, member adapter, reader,
release registry, tracking or production flags. Those shared surfaces belong
to the coordinated launch integration branch.
