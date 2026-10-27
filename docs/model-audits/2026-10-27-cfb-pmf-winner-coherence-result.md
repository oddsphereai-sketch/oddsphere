# CFB PMF winner-coherence repair — result

Date: 2026-10-27

Base SHA: `bc6a2fe2dda61c79ccb5aecc4aafbcf55d0bc996`

Status: qualified for future-unlocked production publication; locked payloads remain authoritative

## Result

The candidate closes the narrow contradiction that exposed Delaware as the published Moneyline
winner while the same authoritative PMF projected Western Kentucky to score more points. It does
not reactivate the rejected r2 final-winner coordinator. The complete professional reader remains
authoritative, followed by one bounded invariant that applies only when:

- expected-margin direction and PMF winner-probability direction disagree;
- the expected margin is inside the existing 0.5-point near-tie tolerance; and
- the same PMF can be minimally tilted within each total bucket until winner probability,
  one-decimal expected score, and representative score share one direction.

The operation preserves total-by-margin probability mass, total expectation, the single-PMF
decision path, and exact-price grading. A `1e-9` winner-direction separation prevents a floating-
point pseudo-cross from letting the compact winner field and decision engine disagree.

The frozen r2 coordinator remains diagnostic-only. Its diagnostic crossing boundary now compares
the learned combination with the actual incumbent PMF probability instead of a sigmoid proxy of
the expected margin. That semantic has its own boundary release and cannot write the forecast.

## Release-pure stored-lock audit

The SELECT-only audit evaluated every settled, nonsuperseded Moneyline lock available from the
current full-product compatibility release family:

| Measure | Existing reader | Candidate invariant |
| --- | ---: | ---: |
| Settled current-family games | 174 | 174 |
| Moneyline wins | 118 | 119 |
| Moneyline losses | 56 | 55 |
| Mean/probability contradictions | 1 | 1 resolved |
| Corrections | — | 1 |
| Harms | — | 0 |

The sole historical contradiction was Gardner-Webb at UT Martin on 2026-10-17. The incumbent PMF
published Gardner-Webb at 50.423% while its mean favored UT Martin by 0.443 points; UT Martin won.
This is a small sample and is evidence for an invariant, not a claim of a broad accuracy lift. Full
historical PMFs are intentionally not duplicated in compact locked records, so unavailable PMFs
were not reconstructed and no locked score, probability, grade, or evidence field was changed.

## Same-input current-board rehearsal

The sole writer ran twice in live-provider, zero-write mode over the same 100-game board: once with
the invariant disabled and once enabled. The local environment did not contain the Playbook secret,
so that optional request returned 401; exact stored Playbook split continuity remained present and
all BALLDONTLIE prices were refreshed. Both runs made zero database writes.

Board counts were identical:

| Board measure | Existing | Candidate |
| --- | ---: | ---: |
| Proposed games | 100 | 100 |
| Published evaluations | 166 | 166 |
| Best Angles | 16 | 16 |
| Leans | 30 | 30 |
| Watchlists | 101 | 101 |
| No Plays | 19 | 19 |
| Held markets | 134 | 134 |
| Capture failures | 0 | 0 |

Delaware at Western Kentucky was the exposed change:

| Field | Existing | Candidate |
| --- | --- | --- |
| Moneyline side | Delaware | Western Kentucky |
| Moneyline probability | 50.492% Delaware | 50.00000005% Western Kentucky |
| Moneyline grade | No Play | No Play |
| Expected score | DEL 27.196, WKU 27.445 | DEL 27.101, WKU 27.540 |
| Total decision | Under 57.5 Lean | Under 57.5 Lean |
| Spread | Held: comparator coverage | Held: comparator coverage |

The PMF total remained 54.641 points apart from floating-point rounding. The candidate therefore
fixes the product contradiction without manufacturing an actionable bet or flattening the board.

## Safety and rollout

- Current prediction/model/distribution/probability/score/calibration, decision, tuple, production
  reader, fixture, snapshot, snapshot-reader, outcome-contract, tracking, and sole-writer releases
  advance together.
- The evidence schema and member envelope remain unchanged because their shape did not change.
- The r53/r40 compatibility family is an explicit same-schema predecessor. Transition tests prove
  exact r53 locked-payload precedence while unlocked rows advance to r54.
- The sole `prediction_pipeline:cfb` lease and one authoritative writer remain unchanged.
- The rollback comparator is read-only and rejected whenever `apply=true`.
- Rollback is the r53 decision / r40 production reader / r138 writer family. Never rewrite or
  reinterpret a stored lock during rollback.

## Verification

- `scripts/operator/audit-cfb-pmf-winner-coherence.ts`: 174 settled current-family locks, 1
  correction, 0 harms, zero writes.
- `scripts/test-cfb-final-winner-coordinator.ts`: PMF mass, total-bucket preservation, minimum
  coherent tilt, score/winner identity, and actual-PMF diagnostic boundary pass.
- `scripts/test-cfb-v1-production.ts`: one writer, exact r53 lock precedence, r54 unlocked
  transition, and source authority contracts pass.
- `npm run test:cfb-v1-production`: pass.
- TypeScript `--noEmit --incremental false`: pass.
