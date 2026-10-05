# NFL cross-market winner coherence r28 result

Date: 2026-10-05

Scope: NFL Daily Edge joint score, Moneyline, Spread, Total, and downstream exact-price grades.

Writes during audit: zero.

## Decision

The predeclared r28 candidate passes the exact current-release replay and is eligible for the
owner-approved provisional production release. It fixes a cross-market authority error: Spread
evidence may still correct a Spread and rebuild the joint score, but it may replace the independent
Moneyline winner only when Moneyline-specific price movement and a source-qualified Moneyline split
gap corroborate that winner. Missing evidence cannot authorize a flip.

This is not a market fade or an independent-model lock. A Moneyline winner change remains possible
in either direction when the frozen evidence requirements qualify. Total market reading is
byte-for-byte unchanged. Expected scores remain continuous values rendered to tenths, and every
prediction still derives from one joint distribution.

## Exact r27 forward replay

The replay uses all 14 settled Week 4 games and all 42 immutable r27 T-60 records. The same stored
provider payload, paid projection, opening/current prices, splits, target exclusion, exact quotes,
and official scores are replayed through the production functions. No provider or database state is
written.

| Metric | r27 incumbent | r28 candidate |
| --- | ---: | ---: |
| Moneyline | 8-6 | 10-4 |
| Spread, excluding two pushes | 6-6 | 9-3 |
| Total | 9-5 | 9-5 |
| Team-score MAE | 5.6509 | 5.5307 |
| Margin MAE | 7.5731 | 5.7677 |
| Total MAE | 8.9331 | 8.9331 |
| Moneyline Brier | 0.23527 | 0.19789 |
| Spread Brier | 0.27677 | 0.21778 |

Four uncorroborated cross-market winner changes are rejected: JAX-CIN, ARI-NYG, GB-TB, and DEN-SF.
Three correct the incumbent and one harms it. The same four Spread directions change, with three
corrections and one push remaining a push. Total has zero side, probability, grade, or projected-
Total changes.

## Board and coherence

- Moneyline grades remain 5 Best Angles / 0 Leans / 0 Watchlists / 9 No Plays. The five settled
  actionables improve from 1-4 to 3-2.
- Spread grades remain 7 / 0 / 7 / 0. Excluding two pushes, the five settled actionables improve
  from 1-4 to 4-1.
- Total grades remain 6 / 4 / 0 / 4 and its 10 actionables remain 6-4.
- Actionable promotions: zero. Actionable demotions: zero. Every market and every actionable slot is
  retained, so the candidate does not flatten the board.
- Total invariance holds for all 14 games. Literal score/side contradictions are zero by construction
  because the final joint distribution is rebuilt before any side, probability, or grade is chosen.

These are release-pure forward diagnostics from a small cohort, not a promised future hit rate.

## Publication and rollback

The active family advances to member r26 / model r23 / calibration r22 / decision and grade r28,
with writer r53, fixture r37, and compact snapshot r29. The r25/r27/r36/r28 spread-grade family is
accepted only as an immutable-lock transition predecessor. Existing locks are never recomputed.

The release adds no provider request, database loop, writer, schedule, stake, member copy, label, or
layout. The shared `prediction_pipeline:nfl` lease remains authoritative. Roll back the complete r28
family if a game or market disappears, a prior unlocked release supersedes it, Total identity changes,
a score/side contradiction appears, or the live writer/reader loses transition continuity.
