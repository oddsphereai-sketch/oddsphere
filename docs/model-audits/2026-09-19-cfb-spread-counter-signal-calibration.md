# CFB spread counter-signal calibration — 2026-09-19

## Decision

Promote the release-selected Spread calibration candidate. When the authoritative joint PMF's
selected Spread side is above 53% and at most 55%, publish the opposite side with the same
calibrated confidence. Moneyline, Total, the score PMF, expected scores, representative score,
provider inputs, stake policy, and UI copy are unchanged.

This is a side-calibration correction, not an abstention rule. The raw PMF probability for the
published side remains in `forecastProbability`; `calibratedProbability` and `modelProbability`
carry the versioned counter-signal probability. The prior `authoritative_pmf_identity` contract
remains callable for direct replay and rollback.

## Chronological evidence

The frozen tournament used 2023 for selection and 2024 and 2025 as repeated confirmations. The
selection grid included fixed market weights, model/market-gap flips, away-underdog line bands,
and confidence-band counter-signals. Selection chose the 53–55% Spread counter-signal before the
confirmation seasons were scored.

| Season | Cohort | Incumbent | Candidate | Net wins | Incumbent Brier / log loss | Candidate Brier / log loss |
|---|---:|---:|---:|---:|---:|---:|
| 2023 selection | 882 | 429–453 (48.64%) | 455–427 (51.59%) | +26 | .251485 / .696127 | .249232 / .691612 |
| 2024 confirmation | 965, 1 push | 487–478 (50.47%) | 491–474 (50.88%) | +4 | .251065 / .695284 | .250549 / .694248 |
| 2025 confirmation | 958 | 508–450 (53.03%) | 513–445 (53.55%) | +5 | .247629 / .688359 | .247086 / .687270 |

The Total candidate did not clear both confirmation seasons and is rejected. No CFB Total
production behavior changes in this release.

The official `sportsdataverse/cfbfastR-cfb-data` repository rewrites some parquet assets. Commit
`41e610025cedb5a3dcfdc5eec4b20f09177c562e` recovered 28 of 40 recorded source checksums; the
remaining betting, roster, and schedule files have compatible schemas but different contents or
encoding. This run therefore does not claim bit-for-bit reproduction of the archived model-build
report. The candidate comparison uses the same checksum-pinned current corpus for incumbent and
candidate, plus the exact production score and residual artifacts.

## Forward and board evidence

Across release-pure settled 2026 CFB Spread records, the incumbent is 66–77. The qualified band is
8–24; flipping only that band produces 82–61 overall. Among actionables, the incumbent is 16–20
and the calibrated side is 19–17. Most settled band evidence belongs to forecast release r18;
current r19 has only four settled Spreads and none in the band, so it is not represented as an
r19-only result.

The SELECT-only September 19 exact-price replay covered 69 games and 60 evaluable Spreads:

- 10 side and exact-quote changes;
- 29 actionables before and 29 after;
- one promotion and one demotion;
- unchanged grade counts: 0 Best Angles, 29 Leans, 20 Watchlists, 11 No Plays;
- no provider calls and no writes.

The demotion is NEV@MTSU: the corrected NEV side has public and same-book movement resistance.
The promotion is the calibrated M-OH@CIN side through the existing, previously approved
resistance-free large-Spread lane: probability at least 54%, target-excluded edge at least 3pp,
EV at least 3%, absolute line at most 24, and a real price between -500 and +500. The rule cannot
bypass resistance and does not create a stake.

## Runtime and safety contract

- The existing `/api/cron/cfb-forward-evidence` path remains the sole writer under
  `prediction_pipeline:cfb`.
- Immutable T-60 rows and old tracking records are never rewritten.
- The current evidence/member/snapshot publication family is versioned atomically and retains the
  immediately previous verified compact snapshot during transition.
- The cross-market validator recognizes only the explicit
  `authoritative_market_sharp_spread_counter_signal` family as an allowed PMF-side calibration;
  every probability, quote, EV, event-containment, and market-count check remains active.
- Current-board audit: `scripts/operator/audit-current-cfb-spread-counter-signal.ts`.
- Chronological audit: `scripts/operator/audit_cfb_market_mixture_accuracy.py`.

## Rollback

Restore the r31 identity decision/calibration family and the immediately previous r22/r34
evidence/member, r62 writer, r53 fixture, r12 compact snapshot, r20 tracking, and r19 market-grade
releases together. Preserve all immutable evidence and prediction records. Roll back if a natural
writer cycle changes Moneyline or Total, reduces total Spread actionability outside the documented
one-promotion/one-demotion replay, produces a mixed release wave, loses a named-book quote, or
fails the member snapshot/coherence checks.
